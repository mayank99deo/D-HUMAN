// Meals and the usual day against a real embedded database, with Claude replaced by a
// fake client so the real estimateMeal, estimateTypicalDay and estimateUsualDay run:
// a meal's micronutrients are its items added up in code; a usual day is estimated three
// times and averaged (and saved with how many estimates made it); one failed estimate
// doesn't lose the day; a usual day counts only from 60% of the energy target; usual days
// and logged meals saved before this change still read; and demo mode works with the new shapes.
// Since the food table (2026-11-18), minerals come from each ingredient's code and raw grams.
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
const { FOODS, FOOD_TABLE_VERSION } = await import("../lib/domain/food-table.ts");

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
const MINERALS = ["iron_mg", "calcium_mg", "magnesium_mg", "zinc_mg", "b12_ug"] as const;
type Minerals = Record<(typeof MINERALS)[number], number>;
const minerals = (o: Partial<Minerals> = {}): Minerals => ({ iron_mg: 0, calcium_mg: 0, magnesium_mg: 0, zinc_mg: 0, b12_ug: 0, ...o });
// An ingredient on the food list (its kcal matches the table, so the energy check keeps the grams),
// and one off it, which carries the model's own minerals.
const coded = (food: keyof typeof FOODS, raw_g: number) => ({ food, name: food, raw_g, kcal: Math.round((FOODS[food].kcal * raw_g) / 100), minerals: null });
const offList = (name: string, kcal: number, m: Partial<Minerals>) => ({ food: "other", name, raw_g: 100, kcal, minerals: minerals(m) });
const fromTable = (food: keyof typeof FOODS, g: number) => Object.fromEntries(MINERALS.map((k) => [k, (FOODS[food][k] * g) / 100])) as Minerals;
const vitamins = { folate_ug: 0, vitamin_c_mg: 0, vitamin_d_iu: 0 };
const item = (name: string, kcal: number, ingredients: object[], v = vitamins) => ({
  name, portion: "1 katori", grams: 150, kcal, protein_g: 6, carbs_g: 20, fat_g: 4, fibre_g: 3, ingredients, vitamins: v,
});
// A usual-day meal whose minerals are given straight (an ingredient off the list), so averages are easy to follow.
const dayMeal = (kcal: number, m: Partial<Minerals>) => ({
  meal: "lunch", title: "Dal, roti, sabzi", kcal, protein_g: kcal / 25, carbs_g: kcal / 8, fat_g: kcal / 40, fibre_g: 6,
  ingredients: [offList("thali", kcal, m)], vitamins,
});
const day = (meals: ReturnType<typeof dayMeal>[], pattern: string) => ({ parsed_output: { meals, patterns: [pattern] } });
const kcalOf = (meals: { kcal: number }[]) => meals.reduce((t, m) => t + m.kcal, 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

describe("a meal's micronutrients", () => {
  it("are worked out from each ingredient's code and raw grams, plus the model's vitamins, and added up", async () => {
    live();
    const me = await person();
    g.__replies.push({
      parsed_output: {
        is_food: true, reply_language: "en", title: "Rotis and dal", meal_guess: "lunch", confidence: "medium", tip: null,
        items: [
          item("Roti", 210, [coded("atta", 40), coded("ghee", 5)], { folate_ug: 20, vitamin_c_mg: 0, vitamin_d_iu: 0 }),
          item("Dal", 150, [coded("toor_dal", 30), offList("kokum", 5, { iron_mg: 0.5, calcium_mg: 10, magnesium_mg: 5, zinc_mg: 0.1 })], { folate_ug: 40, vitamin_c_mg: 2, vitamin_d_iu: 0 }),
        ],
      },
    });
    const result = await logMeal(me.userId, me, { source: "text", text: "2 rotis and dal" });
    assert.ok("log" in result);
    const stored = result.log.micros as Record<string, unknown>;
    const atta = fromTable("atta", 40), ghee = fromTable("ghee", 5), toor = fromTable("toor_dal", 30);
    for (const k of MINERALS) {
      const other = { iron_mg: 0.5, calcium_mg: 10, magnesium_mg: 5, zinc_mg: 0.1, b12_ug: 0 }[k];
      assert.ok(Math.abs((stored[k] as number) - (atta[k] + ghee[k] + toor[k] + other)) < 0.011, `${k}: ${stored[k]}`);
    }
    assert.equal(stored.zinc_mg, r2(40 * 0.026 + 30 * 0.0276 + 0.1), "zinc by hand: atta 2.6 and toor 2.76 mg per 100 g");
    assert.equal(stored.folate_ug, 60, "vitamins are the model's, added up");
    assert.equal(stored.vitamin_c_mg, 2);
    assert.equal(stored.lang, "en", "the reply language still rides along");
    assert.deepEqual(stored.basis, { table: FOOD_TABLE_VERSION, coded_share: r2((136 + 44 + 103) / (136 + 44 + 103 + 5)), ingredients: 4, fixes: 0 });
    assert.equal(result.log.kcal, 360);
    const items = result.log.items as { name: string; portion: string; ingredients: { food: string; g: number; src: string }[] }[];
    assert.deepEqual(items[0].ingredients.map((i) => [i.food, i.g, i.src]), [["atta", 40, FOODS.atta.src], ["ghee", 5, FOODS.ghee.src]]);
    assert.equal(items[1].ingredients[1].src, "ai", "a food off the list is marked as the model's estimate");
  });

  it("corrects a raw and cooked mix-up from the ingredient's energy", async () => {
    live();
    const me = await person();
    // "1 cup rice" written as 150 g raw: the table says 548 kcal against the model's 205.
    g.__replies.push({
      parsed_output: {
        is_food: true, reply_language: "en", title: "Rice", meal_guess: "lunch", confidence: "medium", tip: null,
        items: [item("Rice", 205, [{ food: "rice_white", name: "rice", raw_g: 150, kcal: 205, minerals: null }])],
      },
    });
    const result = await logMeal(me.userId, me, { source: "text", text: "1 cup rice" });
    assert.ok("log" in result);
    const [ing] = (result.log.items as { ingredients: { g: number; fix?: string; asked_g?: number }[] }[])[0].ingredients;
    assert.equal(ing.fix, "energy");
    assert.equal(ing.asked_g, 150);
    assert.equal(ing.g, 56.2);
    assert.equal((result.log.micros as Record<string, number>).zinc_mg, r2(56.2 * 0.0109));
    assert.equal(((result.log.micros as { basis: { fixes: number } }).basis).fixes, 1);
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
    assert.deepEqual(saved.basis, { table: FOOD_TABLE_VERSION, coded_share: 0, ingredients: 2, fixes: 0 }, "the kept estimate's basis, all off the list here");
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

  it("still reads a usual day saved with the model's micronutrients per meal (before the food table)", async () => {
    const target = targetsFor({ sex: "female", age: 28, heightCm: 160, weightKg: 55, level: "regular", archetype: "strength", goals: ["muscle"] }).kcal;
    const meal = (title: string, share: number, zinc: number) => ({
      meal: "lunch", title, kcal: Math.round(target * share), protein_g: 16, carbs_g: 95, fat_g: 10, fibre_g: 7, micros: micros({ zinc_mg: zinc, calcium_mg: 150 }),
    });
    const before = { meals: [meal("Rice and dal", 0.4, 2.5), meal("Roti and sabzi", 0.35, 3)], micros: micros({ zinc_mg: 5.5, calcium_mg: 300 }), patterns: ["Mostly carbs."], runs: 3 };
    const { me } = await withUsualDay(0, before);
    const picture = await dietPicture(me.userId, me);
    assert.equal(picture.source, "typical_day");
    assert.deepEqual(picture.perDay?.micros, before.micros);
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

describe("logged meals saved before the food table", () => {
  it("add up exactly as before, next to new ones", async () => {
    const me = await person();
    const target = targetsFor({ sex: "female", age: 28, heightCm: 160, weightKg: 55, level: "regular", archetype: "strength", goals: ["muscle"] }).kcal;
    const kcal = Math.round((target * 0.8) / 2);
    const d = await db();
    // Days in India time, as the app saves meals (localDate); UTC dates broke this from 00:00 to 05:30 IST.
    const ist = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
    const today = ist(new Date());
    const dayAgo = (n: number) => ist(new Date(Date.now() - n * 86400000));
    // Three kinds of rows, two meals a day for three days: the model's meal total (until 2026-11-18),
    // the model's micronutrients per item (2026-11-18), and the food table's (now, with ingredients and basis).
    const oldest = { name: "Thali", portion: "1 plate" };
    const perItem = { ...oldest, micros: micros({ zinc_mg: 2, calcium_mg: 100 }) };
    const rows = [
      { items: [oldest], micros: { ...micros({ zinc_mg: 3, calcium_mg: 200 }), tip: null } },
      { items: [perItem], micros: { ...micros({ zinc_mg: 2, calcium_mg: 100 }), tip: null, lang: "en" } },
    ];
    for (const [n, date] of [[0, today], [1, dayAgo(1)], [2, dayAgo(2)]] as const) {
      for (const [i, r] of rows.entries()) {
        await d.insert(schema.foodLogs).values({
          id: `old-${me.userId}-${n}-${i}`, userId: me.userId, localDate: date, meal: "lunch", source: "text", title: "Thali",
          items: r.items, kcal, proteinG: 20, carbsG: 60, fatG: 10, fibreG: 5, micros: r.micros, confidence: "medium", model: "claude-haiku-5-5",
        });
      }
    }
    demo();
    const logged = await logMeal(me.userId, me, { source: "text", text: "rajma chawal" });
    assert.ok("log" in logged);
    const newZinc = (logged.log.micros as Record<string, number>).zinc_mg;
    const picture = await dietPicture(me.userId, me);
    assert.equal(picture.source, "logs");
    // Today has the new meal too; the mean is over the three days.
    assert.ok(Math.abs((picture.perDay?.micros.zinc_mg ?? 0) - (3 * 5 + newZinc) / 3) < 1e-9, `zinc ${picture.perDay?.micros.zinc_mg}`);
    assert.equal(picture.perDay?.micros.calcium_mg, (3 * 300 + (logged.log.micros as Record<string, number>).calcium_mg) / 3);
  });
});

describe("demo mode", () => {
  it("logs a meal and saves a usual day with the new shapes, their minerals from the food table", async () => {
    demo();
    const me = await person();
    const result = await logMeal(me.userId, me, { source: "text", text: "2 rotis and dal" });
    assert.ok("log" in result);
    // Dal, roti and sabzi: atta 40 g, ghee 2.5 g, toor dal 30 g, potato 100 g, oil 10 g.
    const meal = [fromTable("atta", 40), fromTable("ghee", 2.5), fromTable("toor_dal", 30), fromTable("potato", 100), fromTable("oil", 10)];
    for (const k of MINERALS) {
      const hand = meal.reduce((t, m) => t + m[k], 0);
      assert.ok(Math.abs((result.log.micros as Record<string, number>)[k] - hand) < 0.011, `${k}: ${(result.log.micros as Record<string, number>)[k]} against ${hand}`);
    }
    assert.equal((result.log.micros as Record<string, number>).zinc_mg, 2.17, "atta 1.04 + toor dal 0.83 + potato 0.3 mg");

    const saved = await saveTypicalDay(me.userId, me, "Poha, dal roti sabzi, rice and dal, chai twice.");
    assert.equal(saved.runs, 1);
    const off = [
      minerals({ iron_mg: 1.8, calcium_mg: 8, magnesium_mg: 20, zinc_mg: 0.5 }), // poha
      minerals({ iron_mg: 0.6, calcium_mg: 20, magnesium_mg: 8, zinc_mg: 0.2 }), // biscuits
    ];
    const table = [
      fromTable("peanuts", 10), fromTable("oil", 10), fromTable("milk", 50), fromTable("sugar", 8),
      fromTable("atta", 60), fromTable("toor_dal", 30), fromTable("potato", 100), fromTable("oil", 10),
      fromTable("milk", 50), fromTable("sugar", 8),
      fromTable("rice_white", 100), fromTable("moong", 30), fromTable("curd", 155), fromTable("oil", 5),
    ];
    for (const k of MINERALS) {
      const hand = [...off, ...table].reduce((t, m) => t + m[k], 0);
      assert.ok(Math.abs(saved.micros[k] - hand) < 0.03, `${k}: ${saved.micros[k]} against ${hand}`);
    }
    assert.deepEqual([saved.micros.folate_ug, saved.micros.vitamin_c_mg, saved.micros.vitamin_d_iu], [210, 30, 20], "the vitamins are the model's");
    assert.equal(kcalOf(saved.meals), 1670);
    assert.equal(saved.basis?.ingredients, 16);
    assert.equal(saved.basis?.fixes, 0, "demo grams agree with their energy");
  });
});
