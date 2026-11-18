// Adding up and averaging food estimates in code (lib/domain/food-sums.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { sumMicros, averageDays, settledRuns, USUAL_DAY_RUNS } = await import("../lib/domain/food-sums.ts");
const { emptyMicros } = await import("../lib/domain/nutrition.ts");

const micros = (o: Partial<ReturnType<typeof emptyMicros>> = {}) => ({ ...emptyMicros(), ...o });
const meal = (kcal: number, m: Partial<ReturnType<typeof emptyMicros>> = {}) => ({
  meal: "lunch" as const, title: "Thali", kcal, protein_g: kcal / 25, carbs_g: kcal / 8, fat_g: kcal / 40, fibre_g: 5, micros: micros(m),
});
const total = (meals: { kcal: number }[]) => meals.reduce((t, m) => t + m.kcal, 0);

describe("sumMicros", () => {
  it("adds up the items, counting missing or bad values as 0", () => {
    const sum = sumMicros([
      { micros: micros({ zinc_mg: 1.2, calcium_mg: 120 }) },
      { micros: micros({ zinc_mg: 0.9, magnesium_mg: 75 }) },
      { micros: { zinc_mg: Number.NaN, iron_mg: -2 } },
      {},
      { micros: null },
    ]);
    assert.deepEqual(sum, micros({ zinc_mg: 2.1, calcium_mg: 120, magnesium_mg: 75 }));
  });

  it("gives all zeros for nothing", () => {
    assert.deepEqual(sumMicros([]), emptyMicros());
  });
});

describe("averageDays", () => {
  const runs = [
    { meals: [meal(500, { zinc_mg: 2, magnesium_mg: 100 }), meal(700, { zinc_mg: 3, magnesium_mg: 150 })], patterns: ["first"] },
    { meals: [meal(600, { zinc_mg: 2.5, magnesium_mg: 120 }), meal(700, { zinc_mg: 3.5, magnesium_mg: 160 })], patterns: ["second"] },
    { meals: [meal(500, { zinc_mg: 1 })], patterns: ["third"] },
  ];

  it("makes the day's micronutrients the mean of each estimate's sum", () => {
    const day = averageDays(runs);
    assert.equal(day.micros.zinc_mg, 4); // (5 + 6 + 1) / 3
    assert.equal(day.micros.magnesium_mg, 176.67); // (250 + 280 + 0) / 3
    assert.equal(day.runs, 3);
  });

  it("keeps the meals and patterns of the estimate nearest the mean energy, scaled to the means", () => {
    const day = averageDays(runs); // totals 1200, 1300, 500: mean 1000, nearest is the first
    assert.deepEqual(day.patterns, ["first"]);
    assert.equal(day.meals.length, 2);
    assert.ok(Math.abs(total(day.meals) - 1000) <= 1, `meals add up to the mean energy, got ${total(day.meals)}`);
    const zinc = day.meals.reduce((t, m) => t + m.micros.zinc_mg, 0);
    assert.ok(Math.abs(zinc - 4) < 0.02, `meal micronutrients add up to the mean, got ${zinc}`);
  });

  it("leaves a single estimate as it was", () => {
    const day = averageDays([runs[0]]);
    assert.deepEqual(day.meals.map((m) => m.kcal), [500, 700]);
    assert.equal(day.micros.zinc_mg, 5);
    assert.equal(day.runs, 1);
  });

  it("keeps the day's mean when the kept estimate has none of a nutrient", () => {
    const day = averageDays([
      { meals: [meal(1000)], patterns: [] },
      { meals: [meal(1000, { vitamin_d_iu: 60 })], patterns: [] },
    ]);
    assert.equal(day.micros.vitamin_d_iu, 30);
  });

  it("refuses to average nothing", () => {
    assert.throws(() => averageDays([]));
  });
});

describe("settledRuns", () => {
  it(`runs ${USUAL_DAY_RUNS} at once and keeps the ones that succeed`, async () => {
    let n = 0;
    let running = 0;
    let most = 0;
    const ok = await settledRuns(USUAL_DAY_RUNS, async () => {
      const i = ++n;
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (i === 2) throw new Error("slow");
      return i;
    });
    assert.deepEqual(ok, [1, 3]);
    assert.equal(most, USUAL_DAY_RUNS, "side by side, not one after another");
  });

  it("throws the first error, with its type, only when every run fails", async () => {
    class Refused extends Error {}
    await assert.rejects(settledRuns(3, () => Promise.reject(new Refused("no"))), Refused);
  });
});
