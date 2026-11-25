import "server-only";
import { eq } from "drizzle-orm";
import { aiMode } from "@/lib/ai/client";
import type { SavedDay } from "@/lib/ai/schemas";
import { askGate } from "@/lib/ask/types";
import { isOwnerEmail } from "@/lib/auth/owners";
import { db, schema } from "@/lib/db";
import type { FoodLog, Profile, Report } from "@/lib/db/schema";
import { foodFactsFor } from "@/lib/domain/food-facts";
import { MICROS, inIuOnly, targetsFor } from "@/lib/domain/nutrition";
import type { Persona } from "@/lib/domain/persona";
import { dietPictureFrom, logsBetween, mealView, totalsOf, type DietPicture } from "../food";
import { currentPlanDetail, type PlanDetail } from "../plan-state";
import { localDate } from "../profile";
import { latestReadyReport, latestStack } from "../stack";

// Fuel, worked out once for both the web's /fuel page and the apps' GET /api/fuel, so the two
// can't drift (the mobile repo's docs/API.md §3.2). fuelData loads; fuelView is the page's own
// derivations, moved here unchanged, as a pure function of the person and the data (it reads
// no clock, no database and no settings). The page renders fuelView's result; the apps' answer
// is shaped from the same result in lib/api/views/fuel.ts, which the web never imports.

type Member = { user: { id: string; email: string }; profile: Profile; persona: Persona };

export type FuelData = {
  today: string;
  /** Today's meals, in the order they were logged. */
  logs: FoodLog[];
  picture: DietPicture;
  base: typeof schema.dietBaselines.$inferSelect | null;
  plan: PlanDetail;
  report: Report | null;
  stack: typeof schema.stacks.$inferSelect | null;
  /** What the server's settings say: AI off, Ask open to this person, a founder (the support line). */
  flags: { aiOff: boolean; ask: boolean; founder: boolean };
};

/**
 * What Fuel reads, in one parallel batch: the diet picture's 14 days of meals (today's are
 * among them), the saved usual day, the plan, the newest read report and the newest stack.
 */
export async function fuelData({ user, profile }: Pick<Member, "user" | "profile">, now = new Date()): Promise<FuelData> {
  const today = localDate(profile.timezone, now);
  // dietPicture's window (lib/platform/food.ts): 14 days, today included.
  const from = localDate(profile.timezone, new Date(now.getTime() - 13 * 86400000));
  const d = await db();
  const [window, [base], plan, report, stack] = await Promise.all([
    logsBetween(user.id, from, today),
    d.select().from(schema.dietBaselines).where(eq(schema.dietBaselines.userId, user.id)).limit(1),
    currentPlanDetail(user.id, profile.timezone),
    latestReadyReport(user.id),
    latestStack(user.id),
  ]);
  return {
    today,
    logs: window.filter((l) => l.localDate === today),
    picture: dietPictureFrom(profile, window, base ?? null),
    base: base ?? null,
    plan,
    report,
    stack,
    flags: {
      aiOff: aiMode() === "off",
      ask: askGate({ email: user.email, onboardedAt: profile.onboardedAt, birthYear: profile.birthYear }) === "ok",
      // Mayank, 2026-11-22: the grey support line under a failed send is for founders only.
      founder: isOwnerEmail(user.email),
    },
  };
}

/** Fuel's props, in the order the page passes them to FuelLogger. */
export function fuelView({ profile, persona }: Pick<Member, "profile" | "persona">, data: FuelData) {
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  const totals = totalsOf(data.logs);
  const { picture, base } = data;
  // No report and no stack, but their food is now enough to build one from meals.
  const stackReady = !data.report && !data.stack && picture.source !== "none";
  // Facts for the waiting screen, picked by age, height and weight bands, diet and sex. No AI involved.
  const { facts, categories } = foodFactsFor({ age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg, sex: profile.sex, diet: profile.diet });
  return {
    aiOff: data.flags.aiOff,
    targets: { kcal: targets.kcal, proteinG: targets.proteinG, carbsG: targets.carbsG, fatG: targets.fatG, fibreG: targets.fibreG, basis: targets.basis, estimated: targets.estimated },
    totals: { kcal: totals.kcal, proteinG: totals.proteinG, carbsG: totals.carbsG, fatG: totals.fatG, fibreG: totals.fibreG },
    // Vitamin D in IU, never as a share: most of it comes from sun, not food (inIuOnly).
    micros: MICROS.map((m) =>
      inIuOnly(m.key) ? { label: m.label, iu: Math.round(totals.micros[m.key]) } : { label: m.label, pct: Math.round((totals.micros[m.key] / targets.micros[m.key]) * 100) },
    ),
    logs: data.logs.map(mealView),
    typical: base ? { description: base.description, patterns: (base.estimate as SavedDay).patterns, short: picture.usualDayShort } : null,
    gaps: picture.source === "none" ? [] : picture.gaps.filter((g) => !inIuOnly(g.key)).slice(0, 4).map((g) => ({ label: g.label, pct: g.pct })),
    gapSource: picture.source,
    language: profile.language,
    facts,
    categories,
    plan: data.plan.view,
    stackReady,
    ask: data.flags.ask,
    founder: data.flags.founder,
  };
}

export type FuelView = ReturnType<typeof fuelView>;
