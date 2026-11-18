// Adding up and averaging food estimates, in code rather than by the model.
//
// Micronutrients per item, added up here: on 2026-11-17 the model's own total for
// "2 rotis, dal and a bowl of curd" came to about two thirds of what its per-item values
// added up to. And a usual day is estimated USUAL_DAY_RUNS times and averaged: one
// estimate varied 10–28% from run to run on minerals, enough to move a day across the
// stack's lines on its own (magnesium crossed 60% of need in 2 of 5 runs of one day).
import { MICROS, emptyMicros, type Micros } from "./nutrition";

export const USUAL_DAY_RUNS = 3;

const clean = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** The micronutrients of a meal or a day: the sum of its parts. Missing or bad values count as 0. */
export function sumMicros(parts: readonly { micros?: Partial<Micros> | null }[]): Micros {
  const t = emptyMicros();
  for (const p of parts) for (const { key } of MICROS) t[key] += clean(p.micros?.[key]);
  for (const { key } of MICROS) t[key] = round(t[key], 2);
  return t;
}

const MACROS = ["kcal", "protein_g", "carbs_g", "fat_g", "fibre_g"] as const;
type Macro = (typeof MACROS)[number];
type DayMeal = Record<Macro, number> & { micros: Micros };
type DayEstimate<M extends DayMeal> = { meals: M[]; patterns: string[] };

/**
 * The average of several estimates of the same usual day. The day's micronutrients are the
 * mean of each run's sum. The run whose energy is nearest the mean keeps its meals and
 * patterns, its meals scaled so they add up to the mean energy and macros (dietPicture adds
 * the meals up) and, where that run has any, to the mean micronutrients.
 */
export function averageDays<M extends DayMeal>(runs: readonly DayEstimate<M>[]): { meals: M[]; micros: Micros; patterns: string[]; runs: number } {
  if (!runs.length) throw new Error("No usual-day estimates to average");
  const totals = runs.map((r) => ({
    macros: Object.fromEntries(MACROS.map((k) => [k, r.meals.reduce((t, m) => t + clean(m[k]), 0)])) as Record<Macro, number>,
    micros: sumMicros(r.meals),
  }));
  const meanOf = (pick: (t: (typeof totals)[number]) => number) => totals.reduce((s, t) => s + pick(t), 0) / totals.length;
  const macros = Object.fromEntries(MACROS.map((k) => [k, meanOf((t) => t.macros[k])])) as Record<Macro, number>;
  const micros = emptyMicros();
  for (const { key } of MICROS) micros[key] = round(meanOf((t) => t.micros[key]), 2);

  let rep = 0;
  totals.forEach((t, i) => {
    if (Math.abs(t.macros.kcal - macros.kcal) < Math.abs(totals[rep].macros.kcal - macros.kcal)) rep = i;
  });
  const own = totals[rep];
  const factor = (mean: number, mine: number) => (mine > 0 ? mean / mine : 1);
  const meals = runs[rep].meals.map((m) => {
    const scaled = { ...m, micros: { ...m.micros } };
    for (const k of MACROS) scaled[k] = round(clean(m[k]) * factor(macros[k], own.macros[k]), k === "kcal" ? 0 : 1) as M[Macro];
    for (const { key } of MICROS) scaled.micros[key] = round(clean(m.micros?.[key]) * factor(micros[key], own.micros[key]), 2);
    return scaled;
  });
  return { meals, micros, patterns: runs[rep].patterns, runs: runs.length };
}

/**
 * Runs `n` copies of an estimate at once and keeps the ones that succeed. Throws the first
 * error only when every copy fails, so one slow or refused call doesn't lose the answer.
 */
export async function settledRuns<T>(n: number, run: () => Promise<T>): Promise<T[]> {
  const settled = await Promise.allSettled(Array.from({ length: n }, run));
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
  return ok;
}
