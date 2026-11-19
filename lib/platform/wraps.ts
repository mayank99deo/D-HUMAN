import "server-only";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { aiMode, AiUnavailableError } from "@/lib/ai/client";
import { mockWrap } from "@/lib/ai/mock";
import type { WrapStory } from "@/lib/ai/schemas";
import { writeWrap } from "@/lib/ai/wrap";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import type { FoodLog, Profile } from "@/lib/db/schema";
import { markerDef } from "@/lib/domain/markers";
import { MICROS, inIuOnly, targetsFor, type Targets } from "@/lib/domain/nutrition";
import { GOALS, labelOf } from "@/lib/domain/options";
import { logsBetween, totalsOf } from "./food";
import { localDate, personaFor } from "./profile";

export { periodLabel, periodRange } from "@/lib/domain/periods";
import { addDays, periodLabel, type Period } from "@/lib/domain/periods";
export type { Period };

// A wrap's numbers come from one pure function (wrapStatsFrom), so the Wraps screen and
// the weekly email (lib/email/jobs.ts) can't disagree: the screen feeds it one person's
// logs, the email job feeds it many people's logs from one grouped query.

/** As much of a logged meal as a wrap's numbers need: no items, no words they said. */
export type WrapLog = Pick<FoodLog, "localDate" | "meal" | "source" | "title" | "kcal" | "proteinG" | "carbsG" | "fatG" | "fibreG" | "micros" | "createdAt">;

/** A day counts as "protein aim reached" at this share of the target, in the wrap and the email alike. */
export const PROTEIN_REACHED_SHARE = 0.9;

/** One calendar day of a period, for the weekly email's seven squares. */
export type WrapDay = { date: string; meals: number; proteinG: number; logged: boolean; proteinReached: boolean };

/** The targets a wrap measures against: the same ones the app shows. */
export function wrapTargets(profile: Profile): Targets {
  const persona = personaFor(profile);
  return targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
}

/** The day a report counts on in a wrap: when the blood was taken, else the day it was uploaded. */
export const reportDay = (r: { collectedOn: string | null; createdAt: Date }, tz: string | null | undefined) =>
  r.collectedOn ?? localDate(tz, r.createdAt);

const inRange = (day: string, start: string, end: string) => day >= start && day <= end;

/** "18:10": the median clock time, in their own zone, at which a food was logged. */
function usualTime(times: readonly Date[], tz: string | null | undefined): string | null {
  if (!times.length) return null;
  const minutesOf = (at: Date, zone: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).formatToParts(at);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return n("hour") * 60 + n("minute");
  };
  let minutes: number[];
  try {
    minutes = times.map((t) => minutesOf(t, tz || "Asia/Kolkata"));
  } catch {
    minutes = times.map((t) => minutesOf(t, "Asia/Kolkata"));
  }
  minutes.sort((a, b) => a - b);
  const m = minutes[Math.floor((minutes.length - 1) / 2)];
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The value seen most often; on a tie, the one seen first. */
function commonest(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > counts.get(best)!) best = v;
  return best;
}

/** Every day from start to end, with what was logged and whether the protein aim was reached. */
export function wrapDays(logs: readonly WrapLog[], proteinTargetG: number, start: string, end: string): WrapDay[] {
  const out: WrapDay[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const day = logs.filter((l) => l.localDate === date);
    const proteinG = day.reduce((t, l) => t + l.proteinG, 0);
    out.push({ date, meals: day.length, proteinG, logged: day.length > 0, proteinReached: day.length > 0 && proteinG >= proteinTargetG * PROTEIN_REACHED_SHARE });
  }
  return out;
}

/**
 * A wrap's numbers, from logs and targets alone (no database). Logs outside start..end
 * are left out. Each top food carries the meal slot it was logged as and when it is
 * usually logged, so the wrap never guesses a slot from the food (a peanut-butter toast
 * logged as a snack at 18:10 was called "your go-to breakfast" before, 2026-11-13).
 */
export function wrapStatsFrom(input: {
  start: string;
  end: string;
  logs: readonly WrapLog[];
  targets: Pick<Targets, "kcal" | "proteinG" | "fibreG" | "micros">;
  timezone: string | null | undefined;
  reportsInPeriod: number;
  markersMoved?: { marker: string; from: number; to: number; unit: string | null }[];
}) {
  const { start, end, targets } = input;
  const logs = input.logs.filter((l) => inRange(l.localDate, start, end));

  const byDay = new Map<string, WrapLog[]>();
  for (const l of logs) byDay.set(l.localDate, [...(byDay.get(l.localDate) ?? []), l]);
  const days = [...byDay.keys()].sort();
  const dayTotals = days.map((day) => ({ day, ...totalsOf(byDay.get(day)!) }));

  let streak = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && addDays(days[i - 1], 1) === days[i] ? run + 1 : 1;
    streak = Math.max(streak, run);
  }

  const n = dayTotals.length || 1;
  const avg = (k: "kcal" | "proteinG" | "fibreG") => Math.round(dayTotals.reduce((t, x) => t + x[k], 0) / n);
  const proteinDays = dayTotals.filter((x) => x.proteinG >= targets.proteinG * PROTEIN_REACHED_SHARE).length;
  const foods = new Map<string, { times: number; meals: string[]; at: Date[] }>();
  for (const l of logs) {
    const f = foods.get(l.title) ?? { times: 0, meals: [], at: [] };
    f.times += 1;
    f.meals.push(l.meal);
    f.at.push(l.createdAt);
    foods.set(l.title, f);
  }
  const topFoods = [...foods.entries()]
    .sort((a, b) => b[1].times - a[1].times)
    .slice(0, 3)
    .map(([title, f]) => ({ title, times: f.times, meal: commonest(f.meals), usualTime: usualTime(f.at, input.timezone) }));
  const bestProtein = [...dayTotals].sort((a, b) => b.proteinG - a.proteinG)[0];
  // Vitamin D from food is never a share of need (most comes from sun; inIuOnly), so a wrap can't call it a gap.
  const microAvg = MICROS.filter(({ key }) => !inIuOnly(key)).map(({ key, label }) => ({
    label,
    pctOfTarget: Math.round((dayTotals.reduce((t, x) => t + x.micros[key], 0) / n / targets.micros[key]) * 100),
  })).sort((a, b) => a.pctOfTarget - b.pctOfTarget);

  return {
    period: { start, end },
    daysLogged: days.length,
    mealsLogged: logs.length,
    longestStreakDays: streak,
    loggedBy: { photo: logs.filter((l) => l.source === "photo").length, voice: logs.filter((l) => l.source === "voice").length, text: logs.filter((l) => l.source === "text").length },
    avgPerLoggedDay: { kcal: avg("kcal"), proteinG: avg("proteinG"), fibreG: avg("fibreG") },
    targets: { kcal: targets.kcal, proteinG: targets.proteinG, fibreG: targets.fibreG },
    proteinTargetHitDays: proteinDays,
    bestProteinDay: bestProtein ? { day: bestProtein.day, proteinG: Math.round(bestProtein.proteinG) } : null,
    topFoods,
    lowestMicros: microAvg.slice(0, 3),
    reportsInPeriod: input.reportsInPeriod,
    markersMoved: (input.markersMoved ?? []).slice(0, 6),
  };
}

export async function wrapStats(userId: string, profile: Profile, start: string, end: string) {
  const d = await db();
  const [logs, reports] = await Promise.all([
    logsBetween(userId, start, end),
    d
      .select()
      .from(schema.reports)
      .where(and(eq(schema.reports.userId, userId), eq(schema.reports.status, "ready")))
      .orderBy(asc(schema.reports.createdAt)),
  ]);

  // Marker movement: the latest report in the period against the one before it.
  const inPeriod = reports.filter((r) => inRange(reportDay(r, profile.timezone), start, end));
  const moved: { marker: string; from: number; to: number; unit: string | null }[] = [];
  const latest = inPeriod.at(-1);
  const before = latest ? reports[reports.indexOf(latest) - 1] : undefined;
  if (latest && before) {
    const [a, b] = await Promise.all([
      d.select().from(schema.markers).where(eq(schema.markers.reportId, before.id)),
      d.select().from(schema.markers).where(eq(schema.markers.reportId, latest.id)),
    ]);
    for (const m of b) {
      const prev = a.find((x) => x.key && x.key === m.key);
      if (prev?.value != null && m.value != null && prev.value !== m.value)
        moved.push({ marker: markerDef(m.key)?.name ?? m.name, from: prev.value, to: m.value, unit: m.unit });
    }
  }

  return wrapStatsFrom({ start, end, logs, targets: wrapTargets(profile), timezone: profile.timezone, reportsInPeriod: inPeriod.length, markersMoved: moved });
}

export type WrapStats = ReturnType<typeof wrapStatsFrom>;
export type WrapRow = { id: string; period: Period; startsOn: string; endsOn: string; stats: WrapStats; story: WrapStory; model: string | null; createdAt: Date };

export async function findWrap(userId: string, period: Period, start: string): Promise<WrapRow | null> {
  const d = await db();
  const [w] = await d
    .select()
    .from(schema.wraps)
    .where(and(eq(schema.wraps.userId, userId), eq(schema.wraps.period, period), eq(schema.wraps.startsOn, start)))
    .limit(1);
  return (w as WrapRow | undefined) ?? null;
}

export async function listWraps(userId: string) {
  const d = await db();
  return d.select().from(schema.wraps).where(eq(schema.wraps.userId, userId)).orderBy(desc(schema.wraps.startsOn)) as Promise<WrapRow[]>;
}

export async function makeWrap(userId: string, profile: Profile, period: Period, start: string, end: string): Promise<WrapRow | { empty: true }> {
  const mode = aiMode();
  if (mode === "off") throw new AiUnavailableError();
  const stats = await wrapStats(userId, profile, start, end);
  if (stats.daysLogged === 0 && stats.reportsInPeriod === 0) return { empty: true };
  const persona = personaFor(profile);
  const { data, model } =
    mode === "mock"
      ? await mockWrap(stats)
      : await writeWrap({
          period,
          label: periodLabel(period, start, end),
          persona: persona.label,
          firstName: persona.firstName,
          goals: profile.goals.map((g) => labelOf(GOALS, g)),
          stats,
          language: profile.language,
        });
  const d = await db();
  const row = { id: newId(), userId, period, startsOn: start, endsOn: end, stats, story: data, model };
  const [saved] = await d
    .insert(schema.wraps)
    .values(row)
    .onConflictDoUpdate({ target: [schema.wraps.userId, schema.wraps.period, schema.wraps.startsOn], set: { stats, story: data, model, createdAt: new Date() } })
    .returning();
  return saved as WrapRow;
}

export async function hasAnyLogs(userId: string, start: string, end: string) {
  const d = await db();
  const rows = await d
    .select({ id: schema.foodLogs.id })
    .from(schema.foodLogs)
    .where(and(eq(schema.foodLogs.userId, userId), gte(schema.foodLogs.localDate, start), lte(schema.foodLogs.localDate, end)))
    .limit(1);
  return rows.length > 0;
}
