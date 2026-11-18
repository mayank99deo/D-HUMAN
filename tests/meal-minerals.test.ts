// Meal minerals worked out in code (lib/domain/meal-minerals.ts): table values times raw grams,
// the model's own minerals for foods off the list, the energy check that catches raw and cooked
// mix-ups, and how items, meals and usual days add up.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { resolveIngredient, resolveItem, basisOf, averageUsualDay, DRY_BAND, WIDE_BAND } = await import("../lib/domain/meal-minerals.ts");
const { FOODS, FOOD_TABLE_VERSION } = await import("../lib/domain/food-table.ts");
const { sumMicros } = await import("../lib/domain/food-sums.ts");

type Code = keyof typeof FOODS;
const kcalOf = (food: Code, g: number) => (FOODS[food].kcal * g) / 100;
type Minerals = { iron_mg: number; calcium_mg: number; magnesium_mg: number; zinc_mg: number; b12_ug: number };
const ing = (food: string, raw_g: number, kcal: number, minerals: Minerals | null = null) => ({ food, name: food, raw_g, kcal, minerals });
const coded = (food: Code, g: number) => ing(food, g, Math.round(kcalOf(food, g)));
const near = (a: number, b: number, what: string, tol = 0.002) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} against ${b}`);
const none = { folate_ug: 0, vitamin_c_mg: 0, vitamin_d_iu: 0 };

describe("an ingredient on the food list", () => {
  it("gets the table's values times its raw grams, with the table's source", () => {
    const atta = resolveIngredient(coded("atta", 40));
    assert.equal(atta.g, 40);
    assert.equal(atta.src, FOODS.atta.src);
    assert.equal(atta.fix, undefined);
    near(atta.micros.zinc_mg, 1.04, "zinc: 40 g at 2.6 mg per 100 g");
    near(atta.micros.magnesium_mg, 54.8, "magnesium");
    near(atta.micros.iron_mg, 1.44, "iron");
    near(atta.micros.calcium_mg, 13.6, "calcium");
    assert.equal(atta.micros.b12_ug, 0, "no B12 in a plant food, whatever the model says");
  });

  it("ignores minerals the model sends for it", () => {
    const egg = resolveIngredient(ing("egg", 50, 72, { iron_mg: 9, calcium_mg: 900, magnesium_mg: 90, zinc_mg: 9, b12_ug: 9 }));
    near(egg.micros.b12_ug, 0.445, "B12 from the table: 50 g at 0.89 µg per 100 g");
    near(egg.micros.zinc_mg, 0.645, "zinc");
  });
});

describe("a food off the list", () => {
  it("keeps the model's minerals, marked 'ai'", () => {
    const poha = resolveIngredient(ing("other", 40, 140, { iron_mg: 1.8, calcium_mg: 8, magnesium_mg: 20, zinc_mg: 0.5, b12_ug: 0 }));
    assert.equal(poha.food, "other");
    assert.equal(poha.src, "ai");
    assert.deepEqual(poha.micros, { iron_mg: 1.8, calcium_mg: 8, magnesium_mg: 20, zinc_mg: 0.5, b12_ug: 0 });
    assert.equal(poha.missing, undefined);
  });

  it("counts as 0 and is flagged when the model gave no minerals, and bad values count as 0", () => {
    const blank = resolveIngredient(ing("other", 40, 140, null));
    assert.equal(blank.missing, true);
    assert.deepEqual(Object.values(blank.micros), [0, 0, 0, 0, 0]);
    const bad = resolveIngredient(ing("other", 40, 140, { iron_mg: Number.NaN, calcium_mg: -5, magnesium_mg: 20, zinc_mg: 0.5, b12_ug: 0 }));
    assert.equal(bad.micros.iron_mg, 0);
    assert.equal(bad.micros.calcium_mg, 0);
  });

  it("includes an unknown code, which the schema shouldn't allow but a model override might send", () => {
    const odd = resolveIngredient(ing("ragi", 50, 160, { iron_mg: 2, calcium_mg: 180, magnesium_mg: 70, zinc_mg: 1.2, b12_ug: 0 }));
    assert.equal(odd.src, "ai");
    assert.equal(odd.micros.calcium_mg, 180);
  });
});

describe("the energy check", () => {
  it("corrects 150 g 'raw' rice written for a cup of cooked rice (205 kcal) to 56 g", () => {
    const rice = resolveIngredient(ing("rice_white", 150, 205));
    assert.equal(rice.fix, "energy");
    assert.equal(rice.asked_g, 150);
    near(rice.g, 56.2, "grams from energy: 205 / 3.65", 0.05);
    near(rice.micros.zinc_mg, 0.613, "zinc falls from 1.64 mg to 0.61 mg");
  });

  it("never raises grams from the model's kcal: every live case of that was the kcal at fault", () => {
    // Live, 2026-11-18: a whole dish's kcal on 20 g moong; cream coded as milk; cooked chicken's energy.
    for (const [food, g, kcal] of [["moong", 20, 695], ["milk", 40, 60], ["chicken", 125, 250], ["rice_white", 18, 205]] as const) {
      const out = resolveIngredient(ing(food, g, kcal));
      assert.equal(out.fix, undefined, food);
      assert.equal(out.g, g, food);
    }
  });

  it("keeps grams that agree with the energy, inside the band", () => {
    assert.equal(resolveIngredient(ing("toor_dal", 30, 100)).fix, undefined, "30 g dal at 103 kcal against 100");
    const edge = DRY_BAND.high * 0.99;
    assert.equal(resolveIngredient(ing("atta", 40, kcalOf("atta", 40) / edge)).fix, undefined, "just inside the band");
    assert.equal(resolveIngredient(ing("atta", 40, kcalOf("atta", 40) / (DRY_BAND.high * 1.05))).fix, "energy", "just outside it");
  });

  it("gives meat, eggs and dairy only the wide band: their kcal often follows the cooked food", () => {
    // Live, 2026-11-18: 125 g raw chicken at 250 kcal (cooked chicken's energy). The tight band made it 210 g.
    const chicken = resolveIngredient(ing("chicken", 125, 250));
    assert.equal(chicken.fix, undefined);
    assert.equal(chicken.g, 125);
    assert.equal(resolveIngredient(ing("paneer", 75, 140)).fix, undefined, "paneer at half its table energy");
    assert.equal(resolveIngredient(ing("chicken", 500, 150)).fix, "energy", "but not 4 times off");
    assert.equal(resolveIngredient(ing("tofu", 100, 150)).fix, undefined, "tofu is a pulse but not dry");
  });

  it("leaves small amounts alone, where the model's kcal is too rough", () => {
    const pinch = resolveIngredient(ing("besan", 30, 35));
    assert.equal(pinch.fix, undefined, "under 40 kcal, though 30 g besan is 116 kcal");
    assert.equal(pinch.g, 30);
    assert.equal(resolveIngredient(ing("sesame", 30, 15)).fix, undefined, "under the wide band's 20 kcal");
  });

  it("gives light foods a wider band, and drinks with almost no energy none", () => {
    assert.equal(resolveIngredient(ing("spinach", 150, 20)).fix, undefined, "150 g spinach is 35 kcal: within 3 times");
    const absurd = resolveIngredient(ing("spinach", 2000, 60));
    assert.equal(absurd.fix, "energy", "2 kg of spinach for 60 kcal");
    near(absurd.g, 260.9, "grams from energy", 0.1);
    assert.equal(WIDE_BAND.high, 3);
    assert.equal(resolveIngredient(ing("tea", 500, 5)).fix, undefined, "tea: 5 kcal, no check");
  });

  it("works out grams from the energy when the model gave none", () => {
    const atta = resolveIngredient(ing("atta", 0, 136));
    assert.equal(atta.fix, "energy");
    near(atta.g, 40, "grams", 0.05);
  });
});

describe("items, meals and usual days", () => {
  it("add an item's ingredients and the model's vitamins", () => {
    const item = resolveItem({
      name: "Dal", portion: "1 katori", grams: 180, kcal: 160, protein_g: 7, carbs_g: 20, fat_g: 5, fibre_g: 4,
      ingredients: [coded("toor_dal", 30), coded("oil", 5), ing("other", 5, 5, { iron_mg: 0.5, calcium_mg: 10, magnesium_mg: 5, zinc_mg: 0.1, b12_ug: 0 })],
      vitamins: { folate_ug: 45, vitamin_c_mg: 3, vitamin_d_iu: 0 },
    });
    assert.equal(item.name, "Dal");
    assert.equal(item.ingredients.length, 3);
    assert.equal("vitamins" in item, false, "the vitamins are folded into micros");
    near(item.micros.zinc_mg, 0.83 + 0.1, "zinc: toor 0.828 + oil 0.0005 + other 0.1", 0.006);
    near(item.micros.magnesium_mg, 54.9 + 5, "magnesium", 0.006);
    assert.equal(item.micros.folate_ug, 45);
    assert.equal(item.micros.vitamin_c_mg, 3);
  });

  it("treat an item with no ingredients as having no minerals (replies in the older shape)", () => {
    const item = resolveItem({ name: "Chai", portion: "1 cup", kcal: 60 } as { name: string; portion: string; kcal: number; ingredients?: never });
    assert.deepEqual(item.ingredients, []);
    assert.equal(item.micros.zinc_mg, 0);
  });

  it("add up items into a meal (sumMicros)", () => {
    const roti = resolveItem({ ingredients: [coded("atta", 40)], vitamins: none });
    const dal = resolveItem({ ingredients: [coded("toor_dal", 30)], vitamins: { ...none, folate_ug: 50 } });
    const meal = sumMicros([roti, dal]);
    near(meal.zinc_mg, 1.04 + 0.828, "zinc", 0.006);
    assert.equal(meal.folate_ug, 50);
  });

  it("record how the minerals were worked out", () => {
    const items = [
      resolveItem({ ingredients: [coded("atta", 40), ing("rice_white", 150, 205)], vitamins: none }),
      resolveItem({ ingredients: [ing("other", 40, 140, { iron_mg: 1, calcium_mg: 1, magnesium_mg: 1, zinc_mg: 1, b12_ug: 0 })], vitamins: none }),
    ];
    const basis = basisOf(items);
    assert.equal(basis.table, FOOD_TABLE_VERSION);
    assert.equal(basis.ingredients, 3);
    assert.equal(basis.fixes, 1);
    assert.equal(basis.coded_share, Math.round(((136 + 205) / (136 + 205 + 140)) * 100) / 100);
    assert.equal(basisOf([]).coded_share, 0);
  });

  it("average usual-day estimates after working out each one's minerals", () => {
    const meal = (kcal: number, ingredients: ReturnType<typeof ing>[]) => ({ meal: "lunch", title: "Thali", kcal, protein_g: 20, carbs_g: 80, fat_g: 15, fibre_g: 8, ingredients, vitamins: none });
    // The same day twice: once right, once with the rice written as cooked weight.
    const right = { meals: [meal(700, [coded("atta", 60), coded("toor_dal", 30), ing("rice_white", 56, 205)])], patterns: ["right"] };
    const mixed = { meals: [meal(720, [coded("atta", 60), coded("toor_dal", 30), ing("rice_white", 158, 205)])], patterns: ["mixed"] };
    const day = averageUsualDay([right, mixed]);
    assert.equal(day.runs, 2);
    const zinc = 60 * 0.026 + 30 * 0.0276 + 56 * 0.0109;
    near(day.micros.zinc_mg, zinc, "the energy check makes both estimates agree on zinc", 0.01);
    assert.equal(day.basis.fixes, 0, "the kept estimate (nearest the mean energy, the first) needed no fix");
    assert.equal(day.meals[0].ingredients.length, 3, "its ingredients are kept");
  });
});
