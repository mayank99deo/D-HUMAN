import "server-only";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { aiMode, AiUnavailableError } from "@/lib/ai/client";
import { mockWrap } from "@/lib/ai/mock";
import type { WrapStory } from "@/lib/ai/schemas";
import { writeWrap } from "@/lib/ai/wrap";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import type { Profile } from "@/lib/db/schema";
import { markerDef } from "@/lib/domain/markers";
import { MICROS, targetsFor } from "@/lib/domain/nutrition";
import { GOALS, labelOf } from "@/lib/domain/options";
import { logsBetween, totalsOf } from "./food";
import { localDate, personaFor } from "./profile";

export { periodLabel, periodRange } from "@/lib/domain/periods";
import { addDays, periodLabel, type Period } from "@/lib/domain/periods";
export type { Period };

export async function wrapStats(userId: string, profile: Profile, start: string, end: string) {
  const logs = await logsBetween(userId, start, end);
  const persona = personaFor(profile);
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });

  const byDay = new Map<string, typeof logs>();
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
  const proteinDays = dayTotals.filter((x) => x.proteinG >= targets.proteinG * 0.9).length;
  const titles = new Map<string, number>();
  for (const l of logs) titles.set(l.title, (titles.get(l.title) ?? 0) + 1);
  const topFoods = [...titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([title, times]) => ({ title, times }));
  const bestProtein = [...dayTotals].sort((a, b) => b.proteinG - a.proteinG)[0];
  const microAvg = MICROS.map(({ key, label }) => ({
    label,
    pctOfTarget: Math.round((dayTotals.reduce((t, x) => t + x.micros[key], 0) / n / targets.micros[key]) * 100),
  })).sort((a, b) => a.pctOfTarget - b.pctOfTarget);

  // Marker movement: the latest report in the period against the one before it.
  const d = await db();
  const reports = await d
    .select()
    .from(schema.reports)
    .where(and(eq(schema.reports.userId, userId), eq(schema.reports.status, "ready")))
    .orderBy(asc(schema.reports.createdAt));
  const inPeriod = reports.filter((r) => {
    const day = r.collectedOn ?? localDate(profile.timezone, r.createdAt);
    return day >= start && day <= end;
  });
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
    reportsInPeriod: inPeriod.length,
    markersMoved: moved.slice(0, 6),
  };
}

export type WrapStats = Awaited<ReturnType<typeof wrapStats>>;
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
