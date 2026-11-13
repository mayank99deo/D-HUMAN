import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { aiMode } from "@/lib/ai/client";
import { translatePlan } from "@/lib/ai/stack";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { markerDef } from "@/lib/domain/markers";
import { asFlag, floorStack } from "@/lib/domain/safety";
import { planStack } from "@/lib/domain/supplements";
import { brandsFor } from "./brands";
import { dietPicture } from "./food";
import { getProfile } from "./profile";

/** Paid stacks per person per 24 hours, counted in the database so every server agrees. Failed ones count: they spent searches too. */
export const DAILY_STACKS = 5;
/** A stack still "building" after this long has died and no longer blocks a new one. */
export const STACK_STALE_AFTER_MS = 15 * 60_000;
/** Give up before the route's 300 s limit, so a slow stack ends as "failed", never stuck. */
const DEADLINE_MS = 280_000;
const DAY_MS = 24 * 60 * 60_000;

export const STACK_MESSAGES = {
  daily_limit: `You've built ${DAILY_STACKS} stacks in the last 24 hours, the most we allow for now. Try again tomorrow.`,
  failed: "We couldn't build your stack this time. Try again in a minute.",
  timeout: "Building your stack took too long, so we stopped. Try again in a minute.",
  stale: "This stack stopped partway. Try again.",
};

export async function latestReadyReport(userId: string) {
  const d = await db();
  const [r] = await d
    .select()
    .from(schema.reports)
    .where(and(eq(schema.reports.userId, userId), eq(schema.reports.status, "ready")))
    .orderBy(desc(schema.reports.createdAt))
    .limit(1);
  return r ?? null;
}

export async function latestStack(userId: string) {
  const d = await db();
  const [s] = await d.select().from(schema.stacks).where(eq(schema.stacks.userId, userId)).orderBy(desc(schema.stacks.createdAt)).limit(1);
  return s ?? null;
}

export const isStaleBuild = (createdAt: Date, now = Date.now()) => now - createdAt.getTime() > STACK_STALE_AFTER_MS;

/** Marks a stack that died while building as failed. True if it did. */
export async function settleStaleStack(id: string, userId: string): Promise<boolean> {
  const d = await db();
  const rows = await d
    .update(schema.stacks)
    .set({ status: "failed", error: STACK_MESSAGES.stale })
    .where(
      and(
        eq(schema.stacks.id, id),
        eq(schema.stacks.userId, userId),
        eq(schema.stacks.status, "building"),
        lt(schema.stacks.createdAt, new Date(Date.now() - STACK_STALE_AFTER_MS)),
      ),
    )
    .returning({ id: schema.stacks.id });
  return rows.length > 0;
}

export type StackStart =
  | { kind: "started"; id: string; job: Promise<void> }
  | { kind: "building"; id: string } // one is already on its way; the screen follows that one
  | { kind: "no_report" }
  | { kind: "daily_limit" };

// Builds a fresh stack from the latest report plus what they eat.
export async function startStack(userId: string): Promise<StackStart> {
  // The plan itself needs no AI; brands and translation are skipped when it's off.
  const mode = aiMode();
  const report = await latestReadyReport(userId);
  const profile = await getProfile(userId);
  if (!report || !profile) return { kind: "no_report" };

  const d = await db();
  const id = newId();
  // Under a per-person lock, so two quick taps start one stack and parallel ones can't pass the cap.
  const claim = await d.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stacks:${userId}`}))`);
    const recent = await tx
      .select({ id: schema.stacks.id, status: schema.stacks.status, createdAt: schema.stacks.createdAt })
      .from(schema.stacks)
      .where(and(eq(schema.stacks.userId, userId), gte(schema.stacks.createdAt, new Date(Date.now() - DAY_MS))))
      .orderBy(desc(schema.stacks.createdAt));
    const building = recent.find((s) => s.status === "building" && !isStaleBuild(s.createdAt));
    if (building) return { kind: "building", id: building.id } as const;
    if (recent.length >= DAILY_STACKS) return { kind: "daily_limit" } as const;
    await tx.insert(schema.stacks).values({ id, userId, reportId: report.id, status: "building" });
    return null;
  });
  if (claim) return claim;

  // Writes land only while the stack is still building (not already failed by the deadline).
  const finish = (values: Partial<typeof schema.stacks.$inferInsert>) =>
    d.update(schema.stacks).set(values).where(and(eq(schema.stacks.id, id), eq(schema.stacks.status, "building")));

  // The stack is worked out in code (lib/domain/supplements.ts). Claude only finds
  // brands, shared by everyone and cached monthly, and translates for Hindi and
  // Hinglish readers. The safety floor runs on the English plan before translation.
  const work = async () => {
    const markers = await d.select().from(schema.markers).where(eq(schema.markers.reportId, report.id));
    const picture = await dietPicture(userId, profile);
    const planned = planStack({
      markers: markers.map((m) => ({ key: m.key, name: markerDef(m.key)?.name ?? m.name, value: m.value, unit: m.unit, status: m.status, flag: m.flag })),
      gaps: picture.source === "none" ? [] : picture.gaps,
      diet: profile.diet,
      level: profile.level,
      conditions: profile.conditions,
      medications: profile.medications,
    });
    // Items keep their rule (typical prices for budgets) and come in priority order.
    const items = await Promise.all(planned.items.map(async (item) => ({ ...item, brands: await brandsFor(item.rule, profile.diet) })));
    const english = floorStack(
      { items, skip: planned.skip, food_first: planned.food_first, see_doctor: planned.see_doctor },
      markers.map((m) => ({ key: m.key, name: markerDef(m.key)?.name ?? m.name, status: m.status, flag: asFlag(m.flag) })),
    );
    if (english.items.length !== items.length) console.info(`[stack] ${id}: safety floor removed ${items.length - english.items.length} item(s)`);
    const translated = mode === "live" ? await translatePlan(english, profile.language) : { plan: english, model: null };
    await finish({ status: "ready", plan: translated.plan, model: translated.model ? `rules+${translated.model}` : "rules" });
  };

  const job = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), DEADLINE_MS)));
    try {
      if ((await Promise.race([work(), deadline])) === "timeout") await finish({ status: "failed", error: STACK_MESSAGES.timeout });
    } catch (error) {
      console.error("[stack]", error);
      await finish({ status: "failed", error: STACK_MESSAGES.failed }).catch((e) => console.error("[stack] Couldn't mark the stack failed; it will be settled as stale.", e));
    } finally {
      clearTimeout(timer);
    }
  })();
  return { kind: "started", id, job };
}
