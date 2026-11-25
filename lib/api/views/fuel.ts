import "server-only";
import type { FoodLog, Profile } from "@/lib/db/schema";
import { foodFactsFor } from "@/lib/domain/food-facts";
import { dayLabel, HISTORY_DAYS } from "@/lib/domain/meals";
import { MICROS, targetsFor } from "@/lib/domain/nutrition";
import { addDays } from "@/lib/domain/periods";
import type { Persona } from "@/lib/domain/persona";
import { logsBetween } from "@/lib/platform/food";
import { localDate } from "@/lib/platform/profile";
import type { FuelData, FuelView } from "@/lib/platform/views/fuel";
import { mealJson, planJson } from "./parts";

// The apps' Fuel, Past meals and meal facts (lib/api/schemas.ts FuelResponse, PastMealsResponse,
// FactsResponse). Fuel is shaped from the web page's own view (lib/platform/views/fuel.ts), so
// its rules can't drift. Past meals and the facts carry no health words or rules of their own:
// their pages stay as they are, and these shape the same loaders' output directly.

type Who = { profile: Profile; persona: Persona };

/** GET /api/fuel: Fuel's view as plain JSON, each meal with its time and language, the plan without words. */
export function fuelJson(v: FuelView, data: FuelData, tz: string | null | undefined) {
  return {
    day: data.today,
    totals: v.totals,
    targets: v.targets,
    micros: v.micros.map((m, i) => ({ key: MICROS[i].key, label: m.label, pct: "pct" in m ? m.pct : null, iu: "iu" in m ? m.iu : null })),
    meals: data.logs.map((l) => mealJson(l, tz)),
    usualDay: v.typical,
    gaps: v.gaps,
    gapSource: v.gapSource,
    stackReady: v.stackReady,
    plan: planJson(data.plan),
    aiOff: v.aiOff,
  };
}

/** GET /api/fuel/facts: the meal wait screen's facts, picked exactly as Fuel's page picks them. */
export function factsJson({ profile, persona }: Who) {
  const { facts, categories } = foodFactsFor({ age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg, sex: profile.sex, diet: profile.diet });
  return { facts, categories };
}

/** Past meals' logs: the same window as the web's mealHistory (lib/platform/food.ts), the HISTORY_DAYS days before today. */
export async function pastData(userId: string, tz: string | null | undefined, now = new Date()) {
  const today = localDate(tz, now);
  return { today, logs: await logsBetween(userId, addDays(today, -HISTORY_DAYS), addDays(today, -1)) };
}

/** GET /api/fuel/past: days with meals, newest first, each day's meals in the order they were logged, labelled as the web labels them. */
export function pastJson({ profile, persona }: Who, data: { today: string; logs: FoodLog[] }) {
  const byDay = new Map<string, FoodLog[]>();
  for (const l of data.logs) byDay.set(l.localDate, [...(byDay.get(l.localDate) ?? []), l]);
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  return {
    day: data.today,
    days: [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, logs]) => ({ date, label: dayLabel(date, data.today), meals: logs.map((l) => mealJson(l, profile.timezone)) })),
    target: { kcal: targets.kcal, proteinG: targets.proteinG },
  };
}
