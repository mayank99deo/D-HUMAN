import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { aiMode, AiUnavailableError } from "@/lib/ai/client";
import { estimateMeal, estimateTypicalDay } from "@/lib/ai/food";
import { mockDay, mockMeal } from "@/lib/ai/mock";
import type { Day, Meal } from "@/lib/ai/schemas";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import type { FoodLog, Profile } from "@/lib/db/schema";
import { MICROS, emptyMicros, targetsFor, type MicroKey, type Micros } from "@/lib/domain/nutrition";
import { localDate, personaFor } from "./profile";

export type MealKind = "breakfast" | "lunch" | "dinner" | "snack";

// A guess from the clock when the person doesn't say which meal it was.
export function mealFromClock(tz: string | null | undefined, at = new Date()): MealKind {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz || "Asia/Kolkata" }).format(at));
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 19 || hour < 2) return "dinner";
  return "snack";
}

export async function focusMarkers(userId: string): Promise<string[]> {
  const d = await db();
  const [latest] = await d
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(and(eq(schema.reports.userId, userId), eq(schema.reports.status, "ready")))
    .orderBy(desc(schema.reports.createdAt))
    .limit(1);
  if (!latest) return [];
  const rows = await d.select().from(schema.markers).where(eq(schema.markers.reportId, latest.id));
  return rows.filter((m) => m.status !== "in_range" && m.status !== "unknown").map((m) => `${m.name} (${m.status.replace("_", " ")})`);
}

export async function logMeal(
  userId: string,
  profile: Profile,
  input: { id?: string; image?: { mime: string; bytes: Buffer }; text?: string; source: "photo" | "voice" | "text"; meal?: MealKind },
): Promise<{ log: FoodLog } | { notFood: true }> {
  const mode = aiMode();
  if (mode === "off") throw new AiUnavailableError();
  const context = { language: profile.language, diet: profile.diet, focus: await focusMarkers(userId) };
  const { data, model }: { data: Meal; model: string } =
    mode === "mock" ? await mockMeal(input.text) : await estimateMeal({ image: input.image, text: input.text, context });
  if (!data.is_food || data.items.length === 0) return { notFood: true };

  const sum = (k: "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fibre_g") => data.items.reduce((t, i) => t + (i[k] || 0), 0);
  const row = {
    // The caller's id when given: it is also the meal's entry in the usage ledger.
    id: input.id ?? newId(),
    userId,
    localDate: localDate(profile.timezone),
    meal: input.meal ?? data.meal_guess ?? mealFromClock(profile.timezone),
    source: input.source,
    inputText: input.text ?? null,
    title: data.title,
    items: data.items,
    kcal: sum("kcal"),
    proteinG: sum("protein_g"),
    carbsG: sum("carbs_g"),
    fatG: sum("fat_g"),
    fibreG: sum("fibre_g"),
    micros: { ...data.micros, tip: data.tip },
    confidence: data.confidence,
    model,
  };
  const d = await db();
  const [log] = await d.insert(schema.foodLogs).values(row).returning();
  return { log };
}

export async function saveTypicalDay(userId: string, profile: Profile, description: string): Promise<Day> {
  const mode = aiMode();
  if (mode === "off") throw new AiUnavailableError();
  const context = { language: profile.language, diet: profile.diet, focus: await focusMarkers(userId) };
  const { data, model } = mode === "mock" ? await mockDay() : await estimateTypicalDay(description, context);
  const d = await db();
  await d
    .insert(schema.dietBaselines)
    .values({ userId, description, estimate: data, model })
    .onConflictDoUpdate({ target: schema.dietBaselines.userId, set: { description, estimate: data, model, updatedAt: new Date() } });
  return data;
}

export async function logsBetween(userId: string, from: string, to: string) {
  const d = await db();
  return d
    .select()
    .from(schema.foodLogs)
    .where(and(eq(schema.foodLogs.userId, userId), gte(schema.foodLogs.localDate, from), lte(schema.foodLogs.localDate, to)))
    .orderBy(schema.foodLogs.createdAt);
}

export async function deleteMeal(userId: string, id: string) {
  const d = await db();
  await d.delete(schema.foodLogs).where(and(eq(schema.foodLogs.userId, userId), eq(schema.foodLogs.id, id)));
}

export type Totals = { kcal: number; proteinG: number; carbsG: number; fatG: number; fibreG: number; micros: Micros };

export function totalsOf(logs: Pick<FoodLog, "kcal" | "proteinG" | "carbsG" | "fatG" | "fibreG" | "micros">[]): Totals {
  const t: Totals = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0, micros: emptyMicros() };
  for (const l of logs) {
    t.kcal += l.kcal;
    t.proteinG += l.proteinG;
    t.carbsG += l.carbsG;
    t.fatG += l.fatG;
    t.fibreG += l.fibreG;
    const m = l.micros as Partial<Micros>;
    for (const { key } of MICROS) t.micros[key] += Number(m?.[key] ?? 0);
  }
  return t;
}

export type DietPicture = {
  source: "logs" | "typical_day" | "none";
  days: number;
  perDay: Totals | null;
  gaps: { key: MicroKey | "protein" | "fibre"; label: string; pct: number }[];
  patterns: string[];
};

// What the person eats on an average day: from logs when there are at least
// three properly logged days in the window, else from their typical day.
export async function dietPicture(userId: string, profile: Profile, days = 14): Promise<DietPicture> {
  const today = localDate(profile.timezone);
  const from = localDate(profile.timezone, new Date(Date.now() - (days - 1) * 86400000));
  const logs = await logsBetween(userId, from, today);
  const byDay = new Map<string, FoodLog[]>();
  for (const l of logs) byDay.set(l.localDate, [...(byDay.get(l.localDate) ?? []), l]);
  const fullDays = [...byDay.values()].filter((meals) => meals.length >= 2);

  let perDay: Totals | null = null;
  let source: DietPicture["source"] = "none";
  let patterns: string[] = [];
  if (fullDays.length >= 3) {
    const total = totalsOf(fullDays.flat());
    const n = fullDays.length;
    perDay = {
      kcal: total.kcal / n, proteinG: total.proteinG / n, carbsG: total.carbsG / n, fatG: total.fatG / n, fibreG: total.fibreG / n,
      micros: Object.fromEntries(MICROS.map(({ key }) => [key, total.micros[key] / n])) as Micros,
    };
    source = "logs";
  } else {
    const d = await db();
    const [base] = await d.select().from(schema.dietBaselines).where(eq(schema.dietBaselines.userId, userId)).limit(1);
    if (base) {
      const est = base.estimate as Day;
      const t = totalsOf(est.meals.map((m) => ({ kcal: m.kcal, proteinG: m.protein_g, carbsG: m.carbs_g, fatG: m.fat_g, fibreG: m.fibre_g, micros: {} })));
      perDay = { ...t, micros: est.micros };
      source = "typical_day";
      patterns = est.patterns;
    }
  }

  const gaps: DietPicture["gaps"] = [];
  if (perDay) {
    const persona = personaFor(profile);
    const targets = targetsFor({
      sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
      level: profile.level, archetype: persona.archetype, goals: profile.goals,
    });
    const pct = (v: number, t: number) => Math.round((v / t) * 100);
    gaps.push({ key: "protein", label: "Protein", pct: pct(perDay.proteinG, targets.proteinG) });
    gaps.push({ key: "fibre", label: "Fibre", pct: pct(perDay.fibreG, targets.fibreG) });
    for (const { key, label } of MICROS) gaps.push({ key, label, pct: pct(perDay.micros[key], targets.micros[key]) });
    gaps.sort((a, b) => a.pct - b.pct);
  }
  return { source, days: source === "logs" ? fullDays.length : 0, perDay, gaps, patterns };
}

export function dietText(p: DietPicture): string | null {
  if (!p.perDay) return null;
  const from = p.source === "logs" ? `${p.days} logged days` : "their description of a typical day";
  const low = p.gaps.filter((g) => g.pct < 70).map((g) => `${g.label} ${g.pct}% of target`);
  return `From ${from}: about ${Math.round(p.perDay.kcal)} kcal and ${Math.round(p.perDay.proteinG)} g protein a day. ${
    low.length ? `Below 70% of target: ${low.join(", ")}.` : "No big gaps against targets."
  }${p.patterns.length ? ` Patterns: ${p.patterns.join(" ")}` : ""}`;
}
