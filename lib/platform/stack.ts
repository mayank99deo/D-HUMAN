import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { aiMode, AiUnavailableError } from "@/lib/ai/client";
import { mockStack } from "@/lib/ai/mock";
import { buildStack } from "@/lib/ai/stack";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { CONDITIONS, DIETS, GOALS, labelOf } from "@/lib/domain/options";
import { dietPicture, dietText } from "./food";
import { getProfile, localDate, personaFor } from "./profile";

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

// Builds a fresh stack from the latest report plus what they eat. Returns the new row's id.
export async function startStack(userId: string): Promise<{ id: string; job: Promise<void> } | null> {
  const mode = aiMode();
  if (mode === "off") throw new AiUnavailableError();
  const report = await latestReadyReport(userId);
  const profile = await getProfile(userId);
  if (!report || !profile) return null;

  const d = await db();
  const id = newId();
  await d.insert(schema.stacks).values({ id, userId, reportId: report.id, status: "building" });

  const job = (async () => {
    try {
      const persona = personaFor(profile);
      const markers = await d.select().from(schema.markers).where(eq(schema.markers.reportId, report.id));
      const table = markers
        .map((m) => `${m.name}${m.key ? ` [${m.key}]` : ""}: ${m.value ?? m.valueText ?? ""} ${m.unit ?? ""} (range ${m.refLow ?? "–"}–${m.refHigh ?? "–"}, ${m.status}${m.flag ? `, FLAG ${m.flag}` : ""})`)
        .join("\n");
      const person = [
        `${persona.firstName}, ${persona.age ?? "age unknown"}, ${profile.sex ?? "sex not given"}; ${persona.label}.`,
        `Goals: ${profile.goals.map((g) => labelOf(GOALS, g)).join(", ") || "not given"}. Diet: ${profile.diet ? labelOf(DIETS, profile.diet) : "not given"}.`,
        `Conditions: ${profile.conditions.map((c) => labelOf(CONDITIONS, c)).join(", ") || "none given"}. Medications: ${profile.medications || "none given"}.`,
        `Supplements already taking: ${profile.currentSupplements || "none given"}.`,
      ].join("\n");
      const diet = dietText(await dietPicture(userId, profile)) ?? "No food logged yet.";
      const { data, model } =
        mode === "mock"
          ? await mockStack()
          : await buildStack({ person, markers: table, diet, language: profile.language, today: localDate(profile.timezone) });
      await d.update(schema.stacks).set({ status: "ready", plan: data, model }).where(eq(schema.stacks.id, id));
    } catch (error) {
      console.error("[stack]", error);
      await d.update(schema.stacks).set({ status: "failed", error: "We couldn't build your stack this time. Try again in a minute." }).where(eq(schema.stacks.id, id));
    }
  })();
  return { id, job };
}
