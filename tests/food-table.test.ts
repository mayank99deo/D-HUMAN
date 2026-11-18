// The food list behind meal minerals (lib/domain/food-table.ts): USDA FoodData Central values,
// each with its source, the codes the model may pick, and the textbook portions in the prompt.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { FOODS, FOOD_CODES, FOOD_TABLE_VERSION, TABLE_NUTRIENTS, PORTIONS, SOURCES, foodRow, sourceOf, foodListText, portionsText } = await import("../lib/domain/food-table.ts");
const { MealSchema, DaySchema } = await import("../lib/ai/schemas.ts");

type Row = (typeof FOODS)[keyof typeof FOODS] & { srcBy?: Record<string, string> };
const rows = Object.entries(FOODS) as [string, Row][];

describe("the food table", () => {
  it("has finite values of 0 or more for every nutrient and energy for every food", () => {
    assert.ok(rows.length >= 100, `${rows.length} foods`);
    for (const [code, row] of rows) {
      for (const k of [...TABLE_NUTRIENTS, "kcal"] as const) assert.ok(Number.isFinite(row[k]) && row[k] >= 0, `${code}.${k} = ${row[k]}`);
      assert.match(code, /^[a-z][a-z0-9_]*$/, "codes are plain words the model can copy");
      assert.equal(typeof row.hint, "string", `${code} has a hint, maybe empty`);
    }
  });

  it("names a source for every value: a FoodData Central id, or 'plant' for B12 in a plant food", () => {
    for (const [code, row] of rows) {
      assert.match(row.src, /^fdc:\d+$/, `${code}: ${row.src}`);
      for (const n of TABLE_NUTRIENTS) {
        const src = sourceOf(code as keyof typeof FOODS, n);
        assert.ok(/^fdc:\d+$/.test(src) || (src === "plant" && n === "b12_ug" && row[n] === 0), `${code}.${n}: ${src}`);
        assert.ok(src.split(":")[0] in SOURCES, `${src} is described in SOURCES`);
      }
    }
    assert.equal(sourceOf("mutton", "magnesium_mg"), "fdc:174338", "goat has no magnesium in USDA, so lamb's is borrowed and says so");
    assert.equal(sourceOf("mutton", "zinc_mg"), "fdc:175303");
  });

  it("matches USDA SR Legacy for spot values", () => {
    // Read from FoodData Central: whole-grain wheat flour (168893), white rice unenriched (169756),
    // pigeon peas (172436), queso fresco (172223), whole egg (171287), chicken (171052), yogurt (171284).
    assert.deepEqual([FOODS.atta.zinc_mg, FOODS.atta.magnesium_mg, FOODS.atta.iron_mg, FOODS.atta.calcium_mg, FOODS.atta.kcal], [2.6, 137, 3.6, 34, 340]);
    assert.deepEqual([FOODS.rice_white.zinc_mg, FOODS.rice_white.iron_mg, FOODS.rice_white.kcal], [1.09, 0.8, 365], "unenriched: no added iron");
    assert.deepEqual([FOODS.toor_dal.zinc_mg, FOODS.toor_dal.magnesium_mg, FOODS.toor_dal.calcium_mg], [2.76, 183, 130]);
    assert.deepEqual([FOODS.paneer.calcium_mg, FOODS.paneer.zinc_mg, FOODS.paneer.b12_ug], [566, 2.58, 1.68]);
    assert.equal(FOODS.egg.b12_ug, 0.89);
    assert.equal(FOODS.chicken.zinc_mg, 1.54);
    assert.equal(FOODS.curd.calcium_mg, 121);
  });

  it("gives B12 only to animal foods (and a trace to mushrooms)", () => {
    for (const [code, row] of rows) {
      const animal = ["dairy", "egg", "meat", "fish"].includes(row.group) || code === "butter" || code === "ghee";
      // USDA measured a trace (0.04 µg per 100 g) in button mushrooms.
      if (!animal && code !== "mushroom") assert.equal(row.b12_ug, 0, `${code} is a plant food`);
    }
    for (const code of ["milk", "curd", "paneer", "egg", "chicken", "mutton", "prawns"] as const) assert.ok(FOODS[code].b12_ug > 0, code);
  });

  it("leaves out stand-ins that are a different food, and anything from IFCT", () => {
    for (const code of ["bajra", "raw_banana", "mackerel", "hilsa", "fish_carp", "fish_basa", "pomfret", "rice_parboiled", "milk_buffalo", "poha", "ragi", "jaggery"]) {
      assert.equal(foodRow(code), null, `${code} is estimated by the model instead`);
    }
    for (const [code, row] of rows) assert.doesNotMatch(JSON.stringify(row), /ifct/i, code);
    assert.match(FOOD_TABLE_VERSION, /^usda-/);
  });

  it("looks foods up by code only", () => {
    assert.equal(foodRow("atta"), FOODS.atta);
    assert.equal(foodRow("other"), null);
    assert.equal(foodRow("constructor"), null);
    assert.equal(foodRow("__proto__"), null);
  });
});

describe("the codes the model may pick", () => {
  const ingredientEnum = (schema: typeof MealSchema | typeof DaySchema) => {
    const json = JSON.stringify(schema.toJSONSchema());
    return JSON.parse(json.match(/"food":(\{"type":"string","enum":\[[^\]]*\][^}]*\})/)![1]).enum as string[];
  };

  it("are the table's codes plus 'other', for meals and usual days", () => {
    assert.deepEqual(ingredientEnum(MealSchema), [...FOOD_CODES, "other"]);
    assert.deepEqual(ingredientEnum(DaySchema), [...FOOD_CODES, "other"]);
  });

  it("are all in the prompt's food list", () => {
    const list = foodListText();
    const listed = list.split("\n").flatMap((line) => line.replace(/^- [^:]+: /, "").split(/, (?![^(]*\))/).map((x) => x.replace(/ \(.*\)$/, "")));
    assert.deepEqual([...listed].sort(), [...FOOD_CODES].sort(), "every code once, grouped");
  });
});

describe("the portions in the prompt", () => {
  it("use the textbook amounts: 20 g atta a roti, 30 g dry dal a bowl", () => {
    const find = (serving: string) => PORTIONS.find((p) => p.serving.startsWith(serving))!;
    assert.equal(find("1 roti").raw, "20 g atta");
    assert.match(find("1 roti").source, /ASC096/);
    assert.equal(find("1 bowl dal").raw, "30 g dry dal or beans");
    assert.match(find("1 bowl dal").source, /ASC151/);
    assert.equal(find("1 cup cooked rice").raw, "56 g raw rice", "158 g at 130 kcal is 205 kcal, which is 56 g at 365 kcal");
    for (const p of PORTIONS) assert.ok(p.source.length > 3, `${p.serving} has a source`);
    const text = portionsText();
    assert.match(text, /1 roti, chapati or phulka: 20 g atta/);
    assert.doesNotMatch(text, /35 g atta/);
  });
});
