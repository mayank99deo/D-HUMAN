// Meal minerals worked out in code, not by the model (2026-11-18).
//
// The model names each ingredient's code from the food list (lib/domain/food-table.ts), its raw
// weight and its kcal. Code multiplies: iron, calcium, magnesium, zinc and B12 come from the table.
// Folate, vitamin C and vitamin D stay the model's estimates for the whole item: folate and vitamin C
// change with cooking, vitamin D from plants is unreliable in food tables, and none of them earns a
// stack item from food. Foods off the list keep the model's own minerals, saved with src "ai".
//
// Why: the model's own minerals were off by food (paneer under half, rice about 3 times too high), and
// giving it reference values made it apply raw-food values to cooked rice and dal (see MEMORY.md, "IFCT
// values in the prompt backfire").
//
// The energy check catches raw and cooked mix-ups, such as 150 g "raw" rice for a cup of cooked rice:
// the table's energy for those grams comes out 2.5-3 times the model's kcal. When the table's energy is
// more than `high` times the model's kcal, the grams are lowered to match the kcal.
// - Grams are only ever lowered, never raised. In the live harness (2026-11-18) every case of the
//   model's kcal running above the table's was the kcal at fault: cooked chicken's energy for raw
//   chicken (125 g would have become 210 g), cream coded as milk (40 g became 98 g), a whole dish's
//   kcal on 20 g of moong (it became 200 g). With no grams at all, they come from the kcal.
// - The tight band is for dry grains and pulses: they take up 2.5-8 times their weight in water, so a
//   mix-up is large. Everything else gets a wide band, a guard against absurd grams (2 kg of spinach
//   for 60 kcal); meat, fish, eggs and dairy only lose some water in cooking.
// - Small amounts (under minKcal) and drinks with almost no energy get no check.
import { averageDays } from "./food-sums";
import { FOOD_TABLE_VERSION, TABLE_NUTRIENTS, foodRow, type TableNutrient } from "./food-table";
import { emptyMicros, type Micros } from "./nutrition";

export const AI_VITAMINS = ["folate_ug", "vitamin_c_mg", "vitamin_d_iu"] as const;
export type Minerals = Record<TableNutrient, number>;
export type Vitamins = Record<(typeof AI_VITAMINS)[number], number>;

/** An ingredient as the model gives it. */
export type AiIngredient = { food: string; name: string; raw_g: number; kcal: number; minerals: Minerals | null };

/** An ingredient as saved: the grams used, where its numbers came from, and its minerals. */
export type Ingredient = {
  /** A code from the food list, or "other". */
  food: string;
  name: string;
  /** Raw grams used for the minerals. */
  g: number;
  /** The model's kcal for this ingredient. */
  kcal: number;
  /** "fdc:<id>" for foods on the list (the row's main source), "ai" for the rest. */
  src: string;
  /** Set when the energy check replaced the model's grams, which are kept in asked_g. */
  fix?: "energy";
  asked_g?: number;
  /** The model gave no minerals for a food off the list; they count as 0. */
  missing?: true;
  micros: Minerals;
};

/** Dry grains and pulses (at least this many kcal per 100 g, so not tofu or sweet corn) get the tight band. */
export const DRY_KCAL = 100;
export const DRY_BAND = { high: 1.5, minKcal: 40 } as const;
export const WIDE_BAND = { high: 3, minKcal: 20 } as const;
const bandFor = (row: { group: string; kcal: number }) => ((row.group === "grain" || row.group === "pulse") && row.kcal >= DRY_KCAL ? DRY_BAND : WIDE_BAND);

const clean = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const emptyMinerals = (): Minerals => ({ iron_mg: 0, calcium_mg: 0, magnesium_mg: 0, zinc_mg: 0, b12_ug: 0 });

/** One ingredient's minerals: table values times raw grams, after the energy check; or the model's, off the list. */
export function resolveIngredient(i: AiIngredient): Ingredient {
  const name = String(i.name ?? "");
  const kcal = clean(i.kcal);
  const asked = clean(i.raw_g);
  const row = foodRow(i.food);
  if (!row) {
    const micros = emptyMinerals();
    for (const n of TABLE_NUTRIENTS) micros[n] = round(clean(i.minerals?.[n]), 3);
    return { food: "other", name, g: asked, kcal, src: "ai", ...(i.minerals ? {} : { missing: true as const }), micros };
  }

  let g = asked;
  let fix: Ingredient["fix"];
  const perGram = row.kcal / 100;
  const band = bandFor(row);
  if (perGram > 0 && kcal >= band.minKcal) {
    if (asked === 0 || (asked * perGram) / kcal > band.high) {
      g = kcal / perGram;
      fix = "energy";
    }
  }
  g = round(g, 1);
  const micros = emptyMinerals();
  for (const n of TABLE_NUTRIENTS) micros[n] = round((row[n] * g) / 100, 3);
  return { food: i.food, name, g, kcal, src: row.src, ...(fix ? { fix, asked_g: asked } : {}), micros };
}

/** An item's (or a usual day's meal's) micronutrients: its ingredients' minerals plus the model's vitamins. */
export function itemMicros(ingredients: readonly Ingredient[], vitamins: Partial<Vitamins> | null | undefined): Micros {
  const t = emptyMicros();
  for (const i of ingredients) for (const n of TABLE_NUTRIENTS) t[n] += i.micros[n];
  for (const v of AI_VITAMINS) t[v] = clean(vitamins?.[v]);
  for (const k of Object.keys(t) as (keyof Micros)[]) t[k] = round(t[k], 2);
  return t;
}

type WithIngredients = { ingredients?: readonly AiIngredient[] | null; vitamins?: Partial<Vitamins> | null };

/** An item or a meal as saved: its ingredients resolved and its micronutrients added up. */
export function resolveItem<T extends WithIngredients>(item: T): Omit<T, "ingredients" | "vitamins"> & { ingredients: Ingredient[]; micros: Micros } {
  const { ingredients, vitamins, ...rest } = item;
  const resolved = (ingredients ?? []).map(resolveIngredient);
  return { ...rest, ingredients: resolved, micros: itemMicros(resolved, vitamins) };
}

/** How a meal's or a day's minerals were worked out, saved with them. */
export type MineralBasis = {
  /** The food table used (FOOD_TABLE_VERSION). */
  table: string;
  /** The share of the ingredients' energy that came from foods on the list (0-1). */
  coded_share: number;
  ingredients: number;
  /** Ingredients whose grams the energy check replaced. */
  fixes: number;
};

export function basisOf(items: readonly { ingredients: readonly Ingredient[] }[]): MineralBasis {
  const all = items.flatMap((i) => i.ingredients);
  const coded = all.filter((i) => i.src !== "ai");
  const energy = all.reduce((t, i) => t + i.kcal, 0);
  const share = energy > 0 ? coded.reduce((t, i) => t + i.kcal, 0) / energy : all.length ? coded.length / all.length : 0;
  return { table: FOOD_TABLE_VERSION, coded_share: round(share, 2), ingredients: all.length, fixes: all.filter((i) => i.fix).length };
}

/** One log line, so the share of foods off the list and the energy fixes can be watched. */
export const basisLine = (b: MineralBasis) =>
  `[food] minerals from ${b.table}: ${Math.round(b.coded_share * 100)}% of energy on the list, energy fixes ${b.fixes}/${b.ingredients}`;

type DayMeal = { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number } & WithIngredients;

/**
 * Several estimates of one usual day, each meal's minerals worked out in code, then averaged
 * (averageDays). The basis is the kept estimate's, since averageDays keeps its meals. Its meals'
 * micronutrients are scaled to the day's means, so they no longer equal their ingredients' sums.
 */
export function averageUsualDay<M extends DayMeal>(days: readonly { meals: readonly M[]; patterns: string[] }[]) {
  const day = averageDays(days.map((d) => ({ meals: d.meals.map(resolveItem), patterns: d.patterns })));
  return { ...day, basis: basisOf(day.meals) };
}
