import "server-only";
import { and, desc, eq, gt, inArray, lte, max, sql } from "drizzle-orm";
import { newId } from "@/lib/auth/crypto";
import { keyMode, paymentsOn } from "@/lib/billing/razorpay";
import { db, schema, type Db } from "@/lib/db";
import { PLAN, REFUSAL_MESSAGES, canBuy, refusalFor, type Counts, type Pass, type PlanView, type Refusal, type UseKind } from "@/lib/domain/plan";
import { json } from "./http";
import { localDate } from "./profile";

// Counts uses from the ledger (schema.usage) and applies the rules in lib/domain/plan.ts.

const u = schema.usage;
const pay = schema.payments;

/** The paid pass covering this moment, if any. */
export async function activePass(q: Db, userId: string, now = new Date()): Promise<Pass | null> {
  const [p] = await q
    .select({ startsAt: pay.startsAt, endsAt: pay.endsAt })
    .from(pay)
    .where(and(eq(pay.userId, userId), eq(pay.status, "paid"), eq(pay.mode, keyMode()), lte(pay.startsAt, now), gt(pay.endsAt, now)))
    .orderBy(desc(pay.endsAt))
    .limit(1);
  return p?.startsAt && p.endsAt ? { startsAt: p.startsAt, endsAt: p.endsAt } : null;
}

/** When the last paid pass ends, including one bought ahead that hasn't started. */
export async function coveredUntil(q: Db, userId: string): Promise<Date | null> {
  const [row] = await q
    .select({ end: max(pay.endsAt) })
    .from(pay)
    .where(and(eq(pay.userId, userId), eq(pay.status, "paid"), eq(pay.mode, keyMode())));
  return row?.end ?? null;
}

async function countsFor(q: Db, userId: string, pass: Pass | null, today: string): Promise<Counts> {
  const inPass = pass
    ? sql<number>`count(*) filter (where ${u.kind} = 'read' and ${u.createdAt} >= ${pass.startsAt.toISOString()}::timestamptz and ${u.createdAt} < ${pass.endsAt.toISOString()}::timestamptz)`
    : sql<number>`0`;
  const [c] = await q
    .select({
      readsTotal: sql<number>`count(*) filter (where ${u.kind} = 'read')`.mapWith(Number),
      readsInPass: inPass.mapWith(Number),
      mealsTotal: sql<number>`count(*) filter (where ${u.kind} = 'meal')`.mapWith(Number),
      mealsToday: sql<number>`count(*) filter (where ${u.kind} = 'meal' and ${u.localDate} = ${today}::date)`.mapWith(Number),
    })
    .from(u)
    .where(eq(u.userId, userId));
  return c ?? { readsTotal: 0, readsInPass: 0, mealsTotal: 0, mealsToday: 0 };
}

/**
 * Inside a transaction: counts under a per-person lock, then records the use, or
 * says why it isn't allowed. A use already recorded for the same thing (a read
 * retried after it went stale) counts once.
 */
export async function claimUseIn(tx: Db, userId: string, kind: UseKind, refId: string, today: string): Promise<Refusal | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`usage:${userId}`}))`);
  const [had] = await tx.select({ id: u.id }).from(u).where(and(eq(u.kind, kind), eq(u.refId, refId))).limit(1);
  if (had) return null;
  const pass = await activePass(tx, userId);
  const refusal = refusalFor(kind, pass, await countsFor(tx, userId, pass, today));
  if (refusal) return refusal;
  await tx
    .insert(u)
    .values({ id: newId(), userId, kind, refId, localDate: kind === "meal" ? today : null })
    .onConflictDoNothing();
  return null;
}

export async function claimMeal(userId: string, refId: string, today: string): Promise<Refusal | null> {
  const d = await db();
  return d.transaction((tx) => claimUseIn(tx, userId, "meal", refId, today));
}

/** What the browser gets when the plan doesn't allow one more use: 402 and the reason. */
export const planLimit = (refusal: Refusal) => json({ error: "plan_limit", refusal, message: REFUSAL_MESSAGES[refusal] }, 402);

/** A read or meal that failed doesn't count. */
export async function releaseUseIn(q: Db, kind: UseKind, refIds: string[]): Promise<void> {
  if (refIds.length) await q.delete(u).where(and(eq(u.kind, kind), inArray(u.refId, refIds)));
}

export async function releaseUse(kind: UseKind, refId: string): Promise<void> {
  await releaseUseIn(await db(), kind, [refId]);
}

export type { PlanView };

export function formatDay(at: Date, tz: string | null | undefined): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: tz || "Asia/Kolkata" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "Asia/Kolkata" }).format(at);
  }
}

/** Everything the screens show about a person's plan, with dates already in their time zone. */
export async function planView(userId: string, timezone: string | null | undefined): Promise<PlanView> {
  const d = await db();
  const now = new Date();
  const today = localDate(timezone, now);
  const [pass, until] = await Promise.all([activePass(d, userId, now), coveredUntil(d, userId)]);
  const c = await countsFor(d, userId, pass, today);
  const queued = pass && until && until > pass.endsAt ? until : null;
  return {
    pass: pass ? { until: formatDay(pass.endsAt, timezone) } : null,
    queuedUntil: queued ? formatDay(queued, timezone) : null,
    reads: pass ? { used: c.readsInPass, limit: PLAN.passReads, free: false } : { used: c.readsTotal, limit: PLAN.freeReads, free: true },
    meals: { today: c.mealsToday, perDay: PLAN.mealsPerDay, used: c.mealsTotal, freeLimit: pass ? null : PLAN.freeMeals },
    readBlock: refusalFor("read", pass, c),
    mealBlock: refusalFor("meal", pass, c),
    canBuy: canBuy(until && until > now ? { endsAt: until } : null, now),
    paymentsOn: paymentsOn(),
  };
}

/** Paid passes, newest first, for Settings. */
export async function paidPasses(userId: string, timezone: string | null | undefined) {
  const d = await db();
  const rows = await d
    .select()
    .from(pay)
    .where(and(eq(pay.userId, userId), eq(pay.status, "paid"), eq(pay.mode, keyMode())))
    .orderBy(desc(pay.paidAt))
    .limit(24);
  return rows.map((r) => ({
    id: r.id,
    paidOn: r.paidAt ? formatDay(r.paidAt, timezone) : "",
    amount: `₹${(r.amount / 100).toLocaleString("en-IN")}`,
    from: r.startsAt ? formatDay(r.startsAt, timezone) : "",
    until: r.endsAt ? formatDay(r.endsAt, timezone) : "",
    ref: r.paymentId ?? r.orderId,
  }));
}
