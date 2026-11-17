import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { aiMode, AiUnavailableError } from "@/lib/ai/client";
import { estimateMeal, estimateTypicalDay } from "@/lib/ai/food";
import { mockDay, mockMeal } from "@/lib/ai/mock";
import type { Day, Meal } from "@/lib/ai/schemas";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import type { FoodLog, Profile } from "@/lib/db/schema";
import { HISTORY_DAYS, type MealView } from "@/lib/domain/meals";
import { MICROS, emptyMicros, targetsFor, type MicroKey, type Micros } from "@/lib/domain/nutrition";
import { addDays } from "@/lib/domain/periods";
import { mealWords, settleReply, type SpokenId } from "@/lib/domain/speech";
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

export type MealInput = {
  id?: string;
  image?: { mime: string; bytes: Buffer };
  /** The words to read: the browser's English translation when there is one, else what the person said or typed. */
  text?: string;
  /** What the person said or typed, sent only when the browser translated it. */
  original?: string;
  /** The language chosen for speaking; counts only for meals logged by voice. */
  spoken?: SpokenId;
  source: "photo" | "voice" | "text";
  meal?: MealKind;
};

export async function logMeal(userId: string, profile: Profile, input: MealInput): Promise<{ log: FoodLog } | { notFood: true }> {
  const mode = aiMode();
  if (mode === "off") throw new AiUnavailableError();
  // The reply comes back in the language they spoke or wrote (lib/domain/speech.ts).
  const words = mealWords({
    text: input.text,
    original: input.original,
    spoken: input.source === "voice" ? input.spoken : null,
    appLanguage: profile.language,
  });
  const context = { language: profile.language, diet: profile.diet, focus: await focusMarkers(userId) };
  const { data, model }: { data: Meal; model: string } =
    mode === "mock" ? await mockMeal(words) : await estimateMeal({ image: input.image, words, voice: input.source === "voice", context });
  if (!data.is_food || data.items.length === 0) return { notFood: true };
  // The model follows the words actually used; its call is checked against them.
  const reply = settleReply(data.reply_language, words);
  console.info(`[food] reply ${reply.id} (expected ${words.reply.id}, model said ${data.reply_language ?? "nothing"})`);

  const sum = (k: "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fibre_g") => data.items.reduce((t, i) => t + (i[k] || 0), 0);
  const row = {
    // The caller's id when given: it is also the meal's entry in the usage ledger.
    id: input.id ?? newId(),
    userId,
    localDate: localDate(profile.timezone),
    meal: input.meal ?? data.meal_guess ?? mealFromClock(profile.timezone),
    source: input.source,
    // Their own words, so the log shows what they said, not the translation.
    inputText: words.said || null,
    title: data.title,
    items: data.items,
    kcal: sum("kcal"),
    proteinG: sum("protein_g"),
    carbsG: sum("carbs_g"),
    fatG: sum("fat_g"),
    fibreG: sum("fibre_g"),
    // lang: the reply language, kept with the tip (no column needed).
    micros: { ...data.micros, tip: data.tip, lang: reply.id },
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

/** A logged meal as the screens show it. */
export function mealView(l: FoodLog): MealView {
  return {
    id: l.id,
    meal: l.meal,
    title: l.title,
    source: l.source,
    kcal: l.kcal,
    proteinG: l.proteinG,
    confidence: l.confidence,
    tip: (l.micros as { tip?: string | null }).tip ?? null,
    items: (l.items as { name: string; portion: string }[]).map((i) => `${i.name}, ${i.portion}`),
    demo: l.model === "mock",
  };
}

const clockTime = (at: Date, tz: string | null | undefined) => {
  const f = (zone: string) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(at);
  try {
    return f(tz || "Asia/Kolkata");
  } catch {
    return f("Asia/Kolkata");
  }
};

export type HistoryDay = { date: string; meals: MealView[] };

/**
 * Meals from the days before today, back HISTORY_DAYS days, newest day first and each
 * day's meals in the order they were logged. Only days with meals are listed.
 */
export async function mealHistory(userId: string, tz: string | null | undefined, now = new Date()): Promise<{ today: string; days: HistoryDay[] }> {
  const today = localDate(tz, now);
  const logs = await logsBetween(userId, addDays(today, -HISTORY_DAYS), addDays(today, -1));
  const byDay = new Map<string, MealView[]>();
  for (const l of logs) byDay.set(l.localDate, [...(byDay.get(l.localDate) ?? []), { ...mealView(l), time: clockTime(l.createdAt, tz) }]);
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, meals]) => ({ date, meals }));
  return { today, days };
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
  /** Days in the window with at least two meals logged; three make the picture come from logs. */
  fullDays: number;
  perDay: Totals | null;
  gaps: { key: MicroKey | "protein" | "fibre"; label: string; pct: number }[];
  patterns: string[];
};

// What the person eats on an average day: from logs when there are at least
// three properly logged days in the window, else from their typical day.
// "Properly logged" means it looks like a day of eating: two meals or more, and at least
// PLAUSIBLE_SHARE of their energy target. Two cups of chai aren't a day's food, and the
// "gaps" they'd show aren't real, so they never earn a supplement (QA, 2026-11-17). A usual
// day that describes almost no food doesn't count either.
export const PLAUSIBLE_SHARE = 0.4;

export async function dietPicture(userId: string, profile: Profile, days = 14): Promise<DietPicture> {
  const today = localDate(profile.timezone);
  const from = localDate(profile.timezone, new Date(Date.now() - (days - 1) * 86400000));
  const persona = personaFor(profile);
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  const enough = (kcal: number) => kcal >= targets.kcal * PLAUSIBLE_SHARE;
  const logs = await logsBetween(userId, from, today);
  const byDay = new Map<string, FoodLog[]>();
  for (const l of logs) byDay.set(l.localDate, [...(byDay.get(l.localDate) ?? []), l]);
  const fullDays = [...byDay.values()].filter((meals) => meals.length >= 2 && enough(meals.reduce((t, m) => t + m.kcal, 0)));

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
      // Patterns still show on Fuel; the numbers only count when they describe a day's food.
      patterns = est.patterns;
      if (enough(t.kcal)) {
        perDay = { ...t, micros: est.micros };
        source = "typical_day";
      }
    }
  }

  const gaps: DietPicture["gaps"] = [];
  if (perDay) {
    const pct = (v: number, t: number) => Math.round((v / t) * 100);
    gaps.push({ key: "protein", label: "Protein", pct: pct(perDay.proteinG, targets.proteinG) });
    gaps.push({ key: "fibre", label: "Fibre", pct: pct(perDay.fibreG, targets.fibreG) });
    for (const { key, label } of MICROS) gaps.push({ key, label, pct: pct(perDay.micros[key], targets.micros[key]) });
    gaps.sort((a, b) => a.pct - b.pct);
  }
  return { source, days: source === "logs" ? fullDays.length : 0, fullDays: fullDays.length, perDay, gaps, patterns };
}

export function dietText(p: DietPicture): string | null {
  if (!p.perDay) return null;
  const from = p.source === "logs" ? `${p.days} logged days` : "their description of a typical day";
  const low = p.gaps.filter((g) => g.pct < 70).map((g) => `${g.label} ${g.pct}% of target`);
  return `From ${from}: about ${Math.round(p.perDay.kcal)} kcal and ${Math.round(p.perDay.proteinG)} g protein a day. ${
    low.length ? `Below 70% of target: ${low.join(", ")}.` : "No big gaps against targets."
  }${p.patterns.length ? ` Patterns: ${p.patterns.join(" ")}` : ""}`;
}
