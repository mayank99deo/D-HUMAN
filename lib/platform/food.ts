import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { aiMode, AiUnavailableError } from "@/lib/ai/client";
import { estimateMeal, estimateUsualDay } from "@/lib/ai/food";
import { mockDay, mockMeal } from "@/lib/ai/mock";
import type { Meal, SavedDay } from "@/lib/ai/schemas";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import type { FoodLog, Profile } from "@/lib/db/schema";
import { HISTORY_DAYS, type MealView } from "@/lib/domain/meals";
import { MICROS, SHORT_OF_NEED, emptyMicros, inIuOnly, targetsFor, type Micros } from "@/lib/domain/nutrition";
import { sumMicros } from "@/lib/domain/food-sums";
import { averageUsualDay, basisLine, basisOf, resolveItem } from "@/lib/domain/meal-minerals";
import { addDays } from "@/lib/domain/periods";
import { mealWords, replyInScript, settleReply, type SpokenId } from "@/lib/domain/speech";
import type { Gap } from "@/lib/domain/supplements";
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

// ── One meal, however many times it's sent ────────────────────────────────
// iPhone's WebKit never resends a POST that died on an idle connection (Apple, forum thread
// 796906), and on some mobile networks an idle connection to Vercel's edge stops carrying the
// phone's bytes (Jio at bom1, community.vercel.com, 2026-11-11). So the browser resends a meal
// itself, with a key made once per try (components/platform/net.ts). The meal's id comes from
// that key and the person, so a resend lands on the same id: food_logs' primary key and the
// usage ledger's (kind, ref_id) index then make one meal and one use, whatever races.

/** A try's key from the browser: random, 16 to 64 URL-safe characters (crypto.randomUUID() is 36). */
export const MEAL_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The meal's id for a try's key: a UUID (version 8, RFC 9562) from SHA-256 of the person and
 * the key, so the same key from someone else can never name this person's meal, and the id
 * gives nothing back about the key.
 */
export function mealIdFor(userId: string, key: string): string {
  const b = createHash("sha256").update(`meal\u0000${userId}\u0000${key}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The route gives up after 120 s (maxDuration in app/api/food/route.ts); a claim older than this with no meal has no live owner. */
export const MEAL_CLAIM_STALE_MS = 130_000;
/** How long a resend waits for the try it repeats before saying it's still being read. */
export const MEAL_WAIT_MS = 55_000;

export type Waited = { log: FoodLog } | { state: "released" | "stale" | "busy" };

/**
 * A resend whose try is already claimed (claimMealTry said `held`) waits here for that try to
 * end: its meal (logged), its use handed back (it failed: this request may try again), the claim
 * gone stale (its request died), or this wait running out (busy). Reads only.
 */
export async function waitForMeal(
  userId: string,
  id: string,
  { waitMs = MEAL_WAIT_MS, staleMs = MEAL_CLAIM_STALE_MS, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<Waited> {
  const d = await db();
  const until = Date.now() + waitMs;
  let pause = 200;
  for (;;) {
    // The meal first, then the use: a try that ends writes its meal (and keeps the use) or
    // deletes its use (and writes no meal), so reading in this order can't miss a logged meal.
    const [log] = await d.select().from(schema.foodLogs).where(and(eq(schema.foodLogs.id, id), eq(schema.foodLogs.userId, userId))).limit(1);
    if (log) return { log };
    const [use] = await d
      .select({ at: schema.usage.createdAt })
      .from(schema.usage)
      .where(and(eq(schema.usage.kind, "meal"), eq(schema.usage.refId, id), eq(schema.usage.userId, userId)))
      .limit(1);
    if (!use) return { state: "released" };
    if (Date.now() - use.at.getTime() > staleMs) return { state: "stale" };
    if (Date.now() + pause > until) return { state: "busy" };
    await sleep(pause);
    pause = Math.min(1_000, Math.round(pause * 1.5));
  }
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
  /** The apps only: when a meal queued offline was eaten. It sets the meal's day, and its slot when none is given. */
  eatenAt?: Date;
  /** The apps only: when a gallery photo taken today was taken. Its clock sets the slot when none is given (Mayank, 2026-11-26). */
  photoAt?: Date;
  /** The apps only: what a Latin-letter pick heard in Devanagari, kept when the words were romanized on arrival. */
  inputRaw?: string;
};

/** The day a meal counts on: the day it was eaten, in the person's time zone. */
export const mealDay = (tz: string | null | undefined, input: Pick<MealInput, "eatenAt">, now = new Date()) => localDate(tz, input.eatenAt ?? now);

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
  const { data: raw, model }: { data: Meal; model: string } =
    mode === "mock" ? await mockMeal(words) : await estimateMeal({ image: input.image, words, voice: input.source === "voice", context });
  if (!raw.is_food || raw.items.length === 0) return { notFood: true };
  // The model follows the words actually used (or, for हिंदी and Hinglish, the pick); its call is
  // checked against them, and a reply kept in Latin letters loses any Devanagari it was written in.
  const reply = settleReply(raw.reply_language, words);
  const data = replyInScript(raw, reply);
  const refitted =
    data.title !== raw.title ||
    data.tip !== raw.tip ||
    data.items.some((item, i) => item.name !== raw.items[i].name || item.portion !== raw.items[i].portion);
  console.info(`[food] reply ${reply.id} (expected ${words.reply.id}, model said ${raw.reply_language ?? "nothing"}${refitted ? ", put in Latin letters" : ""})`);

  // Minerals worked out in code from each ingredient's code and raw grams (lib/domain/meal-minerals.ts).
  const items = data.items.map(resolveItem);
  const basis = basisOf(items);
  console.info(basisLine(basis));
  const sum = (k: "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fibre_g") => items.reduce((t, i) => t + (i[k] || 0), 0);
  const row = {
    // The caller's id when given: it is also the meal's entry in the usage ledger.
    id: input.id ?? newId(),
    userId,
    localDate: mealDay(profile.timezone, input),
    // Said, else a gallery photo's own time, else the model's guess, else the clock when it was eaten.
    meal: input.meal ?? (input.photoAt ? mealFromClock(profile.timezone, input.photoAt) : undefined) ?? data.meal_guess ?? mealFromClock(profile.timezone, input.eatenAt),
    source: input.source,
    // Their own words, so the log shows what they said, not the translation.
    inputText: words.said || null,
    title: data.title,
    items,
    kcal: sum("kcal"),
    proteinG: sum("protein_g"),
    carbsG: sum("carbs_g"),
    fatG: sum("fat_g"),
    fibreG: sum("fibre_g"),
    // lang: the reply language, kept with the tip (no column needed); basis: how the minerals were
    // worked out. Added up from the items, not taken from the model (lib/domain/food-sums.ts).
    micros: { ...sumMicros(items), tip: data.tip, lang: reply.id, basis },
    confidence: data.confidence,
    model,
    ...(input.eatenAt ? { eatenAt: input.eatenAt } : {}),
    ...(input.inputRaw ? { inputRaw: input.inputRaw } : {}),
  };
  const d = await db();
  const [log] = await d.insert(schema.foodLogs).values(row).onConflictDoNothing({ target: schema.foodLogs.id }).returning();
  if (log) return { log };
  // A resend of the same try got here first (a stale claim taken over while its first request
  // still ran): that meal stands, and this one is the same meal.
  const [first] = await d.select().from(schema.foodLogs).where(and(eq(schema.foodLogs.id, row.id), eq(schema.foodLogs.userId, userId))).limit(1);
  if (!first) throw new Error("[food] a meal with this id belongs to someone else");
  return { log: first };
}

/** A usual day saved with the same words this recently is the same save, sent again (net.ts resends once). */
export const USUAL_DAY_REPEAT_MS = 3 * 60_000;

export async function saveTypicalDay(userId: string, profile: Profile, description: string): Promise<SavedDay> {
  const mode = aiMode();
  if (mode === "off") throw new AiUnavailableError();
  const d = await db();
  const [focus, [saved]] = await Promise.all([
    focusMarkers(userId),
    d
      .select({ description: schema.dietBaselines.description, estimate: schema.dietBaselines.estimate, updatedAt: schema.dietBaselines.updatedAt })
      .from(schema.dietBaselines)
      .where(eq(schema.dietBaselines.userId, userId))
      .limit(1),
  ]);
  // The browser resends a save whose answer it never got. When the first one landed, its three
  // estimates are already saved: hand them back rather than paying for three more.
  if (saved && saved.description === description && Date.now() - saved.updatedAt.getTime() < USUAL_DAY_REPEAT_MS) {
    console.info("[typical-day] same words saved moments ago: returning that save");
    return saved.estimate as SavedDay;
  }
  const context = { language: profile.language, diet: profile.diet, focus };
  const { data, model } =
    mode === "mock" ? await mockDay().then((r) => ({ data: averageUsualDay([r.data]), model: r.model })) : await estimateUsualDay(description, context);
  if (data.basis) console.info(basisLine(data.basis));
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
    // In the order they were eaten: a meal queued offline on a phone sits where it was eaten, not where it arrived.
    .orderBy(sql`coalesce(${schema.foodLogs.eatenAt}, ${schema.foodLogs.createdAt})`);
}

/** When a meal was eaten: a queued meal's own time, else when it was logged. */
export const eatenAtOf = (l: Pick<FoodLog, "eatenAt" | "createdAt">) => l.eatenAt ?? l.createdAt;

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

/** "8:40 am" on the person's clock. */
export const clockTime = (at: Date, tz: string | null | undefined) => {
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
  for (const l of logs) byDay.set(l.localDate, [...(byDay.get(l.localDate) ?? []), { ...mealView(l), time: clockTime(eatenAtOf(l), tz) }]);
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, meals]) => ({ date, meals }));
  return { today, days };
}

export async function deleteMeal(userId: string, id: string) {
  const d = await db();
  await d.transaction(async (tx) => {
    const gone = await tx
      .delete(schema.foodLogs)
      .where(and(eq(schema.foodLogs.userId, userId), eq(schema.foodLogs.id, id)))
      .returning({ id: schema.foodLogs.id });
    // A deleted meal still counts (lib/domain/plan.ts), but its use moves off the meal's id. Left
    // under it, the try's key sent again would find a claim with no meal: a wait that ends in
    // "still reading", then (once stale) the meal logged again for free (takeTry in
    // app/api/food/route.ts). Only a meal that was there: a try still being read keeps its claim.
    if (gone.length)
      await tx
        .update(schema.usage)
        .set({ refId: newId() })
        .where(and(eq(schema.usage.kind, "meal"), eq(schema.usage.refId, id), eq(schema.usage.userId, userId)));
  });
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
  /** Lowest first. Vitamin D also carries its IU from food, which the screens show instead of the share (inIuOnly). */
  gaps: Gap[];
  patterns: string[];
  /** A usual day is saved but describes less than USUAL_DAY_SHARE of the energy target, so it isn't used (only checked when logs aren't enough). */
  usualDayShort: boolean;
};

// What the person eats on an average day: from logs when there are at least
// three properly logged days in the window, else from their typical day.
//
// A logged day counts only with two meals or more and LOGGED_DAY_SHARE of their energy
// target (Mayank, 2026-11-17; it was 40%). Partly logged days read as gaps that aren't
// there: in the AI efficiency lead's measurements, days logged at 65% of energy showed
// magnesium short on 91% of days, against 13% when judged at full energy. Two cups of chai
// a day (QA, 2026-11-17) are the extreme case.
export const LOGGED_DAY_SHARE = 0.75;
// A usual day describes a whole day by design, but a short one ("dal chawal, roti sabzi,
// chai") came to 34–41% of energy and sat on the old 40% line, earning a stack in 1 of 5
// estimates. It counts from 60% (Mayank, 2026-11-17).
export const USUAL_DAY_SHARE = 0.6;

export async function dietPicture(userId: string, profile: Profile, days = 14): Promise<DietPicture> {
  const today = localDate(profile.timezone);
  const from = localDate(profile.timezone, new Date(Date.now() - (days - 1) * 86400000));
  const d = await db();
  // The usual day only counts when the logs fall short, but fetching it alongside them costs no extra wait.
  const [logs, [base]] = await Promise.all([
    logsBetween(userId, from, today),
    d.select({ estimate: schema.dietBaselines.estimate }).from(schema.dietBaselines).where(eq(schema.dietBaselines.userId, userId)).limit(1),
  ]);
  return dietPictureFrom(profile, logs, base ?? null);
}

/** A logged meal, as much of it as the diet picture reads. */
export type PictureLog = Pick<FoodLog, "localDate" | "kcal" | "proteinG" | "carbsG" | "fatG" | "fibreG" | "micros">;

/**
 * dietPicture's pure core, from the logs of the window and the saved usual day (or null).
 * Ask's loader feeds it from its own parallel batch (lib/platform/ask.ts).
 */
export function dietPictureFrom(profile: Profile, logs: PictureLog[], baseline: { estimate: unknown } | null): DietPicture {
  const persona = personaFor(profile);
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  const reaches = (kcal: number, share: number) => kcal >= targets.kcal * share;
  const byDay = new Map<string, PictureLog[]>();
  for (const l of logs) byDay.set(l.localDate, [...(byDay.get(l.localDate) ?? []), l]);
  const fullDays = [...byDay.values()].filter((meals) => meals.length >= 2 && reaches(meals.reduce((t, m) => t + m.kcal, 0), LOGGED_DAY_SHARE));

  let perDay: Totals | null = null;
  let source: DietPicture["source"] = "none";
  let patterns: string[] = [];
  let usualDayShort = false;
  if (fullDays.length >= 3) {
    const total = totalsOf(fullDays.flat());
    const n = fullDays.length;
    perDay = {
      kcal: total.kcal / n, proteinG: total.proteinG / n, carbsG: total.carbsG / n, fatG: total.fatG / n, fibreG: total.fibreG / n,
      micros: Object.fromEntries(MICROS.map(({ key }) => [key, total.micros[key] / n])) as Micros,
    };
    source = "logs";
  } else {
    if (baseline) {
      const est = baseline.estimate as SavedDay;
      const t = totalsOf(est.meals.map((m) => ({ kcal: m.kcal, proteinG: m.protein_g, carbsG: m.carbs_g, fatG: m.fat_g, fibreG: m.fibre_g, micros: {} })));
      // Patterns still show on Fuel; the numbers only count when they describe a day's food.
      patterns = est.patterns;
      if (reaches(t.kcal, USUAL_DAY_SHARE)) {
        perDay = { ...t, micros: est.micros };
        source = "typical_day";
      } else {
        usualDayShort = true;
      }
    }
  }

  const gaps: DietPicture["gaps"] = [];
  if (perDay) {
    const pct = (v: number, t: number) => Math.round((v / t) * 100);
    gaps.push({ key: "protein", label: "Protein", pct: pct(perDay.proteinG, targets.proteinG) });
    gaps.push({ key: "fibre", label: "Fibre", pct: pct(perDay.fibreG, targets.fibreG) });
    for (const { key, label } of MICROS) {
      const amount = perDay.micros[key];
      gaps.push({ key, label, pct: pct(amount, targets.micros[key]), ...(inIuOnly(key) ? { iu: Math.round(amount) } : {}) });
    }
    gaps.sort((a, b) => a.pct - b.pct);
  }
  return { source, days: source === "logs" ? fullDays.length : 0, fullDays: fullDays.length, perDay, gaps, patterns, usualDayShort };
}

export function dietText(p: DietPicture): string | null {
  if (!p.perDay) return null;
  const from = p.source === "logs" ? `${p.days} logged days` : "their description of a typical day";
  // Vitamin D isn't a food gap: most comes from sun, so food can't show a shortfall.
  const low = p.gaps.filter((g) => g.pct < SHORT_OF_NEED && !inIuOnly(g.key)).map((g) => `${g.label} ${g.pct}% of target`);
  const vitaminD = `Vitamin D from food: about ${Math.round(p.perDay.micros.vitamin_d_iu)} IU a day; most comes from sun, so food alone can't show a shortfall.`;
  return `From ${from}: about ${Math.round(p.perDay.kcal)} kcal and ${Math.round(p.perDay.proteinG)} g protein a day. ${
    low.length ? `Below ${SHORT_OF_NEED}% of target: ${low.join(", ")}.` : "No big gaps against targets."
  } ${vitaminD}${p.patterns.length ? ` Patterns: ${p.patterns.join(" ")}` : ""}`;
}
