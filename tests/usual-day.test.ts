// Meals and the usual day against a real embedded database, with Claude replaced by a
// fake client so the real estimateMeal, estimateTypicalDay and estimateUsualDay run:
// a meal's micronutrients are its items added up in code; a usual day is estimated three
// times and averaged (and saved with how many estimates made it); one failed estimate
// doesn't lose the day; a usual day counts only from 60% of the energy target; usual days
// saved before this change still read; and demo mode works with the new shapes.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Reply = { parsed_output: unknown } | Error;
const g = globalThis as unknown as { __replies: Reply[]; __calls: number };
g.__replies = [];
g.__calls = 0;

allowAppImports({
  // lib/ai/food.ts's own client: every call takes the next reply in line, in call order.
  "./client": `
    export const MODELS = { food: "claude-haiku-5-5" };
    export const VOICE = "";
    export const fallbackFor = () => ({});
    export const languageRule = () => "";
    export const logUsage = () => {};
    export const assertComplete = () => {};
    export const anthropic = () => ({ beta: { messages: { stream: () => {
      globalThis.__calls++;
      const next = globalThis.__replies.shift();
      return { finalMessage: async () => {
        if (!next) throw new Error("no reply queued");
        if (next instanceof Error) throw next;
        return { ...next, model: "claude-haiku-5-5", stop_reason: "end_turn" };
      } };
    } } } });`,
});
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { logMeal, saveTypicalDay, dietPicture, USUAL_DAY_SHARE } = await import("../lib/platform/food.ts");
const { targetsFor } = await import("../lib/domain/nutrition.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

const live = () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.D_HUMAN_AI_MOCK;
};
const demo = () => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.D_HUMAN_AI_MOCK = "1";
};

let n = 0;
async function person() {
  const d = await db();
  const id = `user-${++n}`;
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  await d.insert(schema.profiles).values({
    userId: id, name: "Asha", birthYear: 1998, sex: "female", heightCm: 160, weightKg: 55, activities: ["strength"], primaryActivity: "strength",
    level: "regular", goals: ["muscle"], diet: "veg", language: "en", timezone: "Asia/Kolkata", onboardedAt: new Date(),
  });
  const [profile] = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, id));
  return profile;
}

const micros = (o: Record<string, number> = {}) => ({
  iron_mg: 0, calcium_mg: 0, magnesium_mg: 0, zinc_mg: 0, b12_ug: 0, folate_ug: 0, vitamin_c_mg: 0, vitamin_d_iu: 0, ...o,
});
const item = (name: string, kcal: number, m: Record<string, number>) => ({
  name, portion: "1 katori", grams: 150, kcal, protein_g: 6, carbs_g: 20, fat_g: 4, fibre_g: 3, micros: micros(m),
});
const dayMeal = (kcal: number, m: Record<string, number>) => ({
  meal: "lunch", title: "Dal, roti, sabzi", kcal, protein_g: kcal / 25, carbs_g: kcal / 8, fat_g: kcal / 40, fibre_g: 6, micros: micros(m),
});
const day = (meals: ReturnType<typeof dayMeal>[], pattern: string) => ({ parsed_output: { meals, patterns: [pattern] } });
const kcalOf = (meals: { kcal: number }[]) => meals.reduce((t, m) => t + m.kcal, 0);

describe("a meal's micronutrients", () => {
  it("are its items added up in code", async () => {
    live();
    const me = await person();
    g.__replies.push({
      parsed_output: {
        is_food: true, reply_language: "en", title: "Rotis and dal", meal_guess: "lunch", confidence: "medium", tip: null,
        items: [item("Roti", 210, { zinc_mg: 1.2, magnesium_mg: 75, calcium_mg: 25 }), item("Dal", 150, { zinc_mg: 0.9, magnesium_mg: 40, iron_mg: 1.6 })],
      },
    });
    const result = await logMeal(me.userId, me, { source: "text", text: "2 rotis and dal" });
    assert.ok("log" in result);
    const stored = result.log.micros as Record<string, unknown>;
    assert.equal(stored.zinc_mg, 2.1);
    assert.equal(stored.magnesium_mg, 115);
    assert.equal(stored.calcium_mg, 25);
    assert.equal(stored.iron_mg, 1.6);
    assert.equal(stored.lang, "en", "the reply language still rides along");
    assert.equal(result.log.kcal, 360);
  });
});

describe("the usual day", () => {
  it("is estimated three times at once and averaged, and one failure doesn't lose it", async () => {
    live();
    const me = await person();
    g.__calls = 0;
    g.__replies.push(
      day([dayMeal(900, { zinc_mg: 3, magnesium_mg: 150 }), dayMeal(600, { zinc_mg: 2, magnesium_mg: 90 })], "first"),
      new Error("timed out"),
      day([dayMeal(1100, { zinc_mg: 4, magnesium_mg: 200 }), dayMeal(600, { zinc_mg: 3, magnesium_mg: 110 })], "third"),
    );
    const saved = await saveTypicalDay(me.userId, me, "Poha, dal roti sabzi, rice and dal, chai twice.");
    assert.equal(g.__calls, 3);
    assert.equal(saved.runs, 2, "saved with how many estimates made it");
    assert.equal(saved.micros.zinc_mg, 6); // (5 + 7) / 2
    assert.equal(saved.micros.magnesium_mg, 275); // (240 + 310) / 2
    assert.ok(Math.abs(kcalOf(saved.meals) - 1600) <= 1, `meals add up to the mean energy, got ${kcalOf(saved.meals)}`);
    assert.deepEqual(saved.patterns, ["first"]);
    const d = await db();
    const [row] = await d.select().from(schema.dietBaselines).where(eq(schema.dietBaselines.userId, me.userId));
    assert.deepEqual(row.estimate, saved);
  });

  it("fails, and saves nothing, only when every estimate fails", async () => {
    live();
    const me = await person();
    g.__replies.push(new Error("one"), new Error("two"), new Error("three"));
    await assert.rejects(saveTypicalDay(me.userId, me, "Poha, dal roti sabzi, rice and dal, chai twice."), /one/);
    const d = await db();
    const rows = await d.select().from(schema.dietBaselines).where(eq(schema.dietBaselines.userId, me.userId));
    assert.equal(rows.length, 0);
  });
});

describe("what a usual day counts for", () => {
  async function withUsualDay(share: number, estimate?: object) {
    const me = await person();
    const target = targetsFor({ sex: "female", age: 28, heightCm: 160, weightKg: 55, level: "regular", archetype: "strength", goals: ["muscle"] }).kcal;
    const kcal = Math.round(target * share);
    const d = await db();
    await d.insert(schema.dietBaselines).values({
      userId: me.userId,
      description: "Dal chawal, roti sabzi, chai.",
      estimate: estimate ?? { meals: [dayMeal(kcal, { zinc_mg: 4 })], micros: micros({ zinc_mg: 4 }), patterns: ["Mostly cereals."], runs: 3 },
    });
    return { me, kcal };
  }

  it(`counts only from ${USUAL_DAY_SHARE * 100}% of the energy target`, async () => {
    assert.equal(USUAL_DAY_SHARE, 0.6);
    const short = await withUsualDay(0.5);
    const shortPicture = await dietPicture(short.me.userId, short.me);
    assert.equal(shortPicture.source, "none", "half a day's energy is too little to judge gaps from");
    assert.equal(shortPicture.perDay, null);
    assert.deepEqual(shortPicture.patterns, ["Mostly cereals."], "its patterns still show");

    const enough = await withUsualDay(0.7);
    const picture = await dietPicture(enough.me.userId, enough.me);
    assert.equal(picture.source, "typical_day");
    assert.equal(picture.perDay?.micros.zinc_mg, 4);
  });

  it("still reads a usual day saved before micronutrients came per meal", async () => {
    const target = targetsFor({ sex: "female", age: 28, heightCm: 160, weightKg: 55, level: "regular", archetype: "strength", goals: ["muscle"] }).kcal;
    const old = {
      meals: [
        { meal: "lunch", title: "Rice and dal", kcal: Math.round(target * 0.4), protein_g: 16, carbs_g: 95, fat_g: 10, fibre_g: 7 },
        { meal: "dinner", title: "Roti and sabzi", kcal: Math.round(target * 0.35), protein_g: 12, carbs_g: 75, fat_g: 15, fibre_g: 8 },
      ],
      micros: micros({ iron_mg: 9, calcium_mg: 300, magnesium_mg: 160, zinc_mg: 9 }),
      patterns: ["Mostly carbs, little protein."],
    };
    const { me } = await withUsualDay(0, old);
    const picture = await dietPicture(me.userId, me);
    assert.equal(picture.source, "typical_day");
    assert.deepEqual(picture.perDay?.micros, old.micros);
  });
});

describe("demo mode", () => {
  it("logs a meal and saves a usual day with the new shapes", async () => {
    demo();
    const me = await person();
    const result = await logMeal(me.userId, me, { source: "text", text: "2 rotis and dal" });
    assert.ok("log" in result);
    assert.equal((result.log.micros as Record<string, number>).zinc_mg, 2.1);
    const saved = await saveTypicalDay(me.userId, me, "Poha, dal roti sabzi, rice and dal, chai twice.");
    assert.equal(saved.runs, 1);
    assert.deepEqual(saved.micros, micros({ iron_mg: 11, calcium_mg: 520, magnesium_mg: 260, zinc_mg: 7, b12_ug: 0.8, folate_ug: 210, vitamin_c_mg: 30, vitamin_d_iu: 20 }));
    assert.equal(kcalOf(saved.meals), 1670);
  });
});
