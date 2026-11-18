import { z } from "zod";
import { FOOD_CODES } from "@/lib/domain/food-table";
import { EXTRACT_KEYS } from "@/lib/domain/markers";
import type { Ingredient, MineralBasis } from "@/lib/domain/meal-minerals";
import type { Micros } from "@/lib/domain/nutrition";
import { SPOKEN_IDS } from "@/lib/domain/speech";
import { GAP_OUTCOMES } from "@/lib/domain/supplements";

// Output shapes Claude must return. Structured-output shapes (extract, read,
// meal, day, wrap) have every field required, nullable where it may be absent:
// structured outputs work best with closed, explicit schemas. The web-search
// shapes (events, stack) are read from free text instead, so they tolerate
// missing optional keys and drop a bad entry rather than the whole paid reply.

export const ExtractedSchema = z.object({
  is_lab_report: z.boolean(),
  lab_name: z.string().nullable(),
  collected_on: z.string().nullable().describe("Sample collection date as YYYY-MM-DD, if printed"),
  name_on_report: z.string().nullable(),
  age_on_report: z.number().nullable(),
  sex_on_report: z.enum(["male", "female"]).nullable(),
  markers: z.array(
    z.object({
      printed_name: z.string(),
      key: z.enum([...EXTRACT_KEYS, "other"]),
      panel: z.string().nullable(),
      value: z.number().nullable(),
      value_text: z.string().nullable().describe("Only when the result is not a plain number, e.g. '<0.5' or 'Positive'"),
      unit: z.string().nullable(),
      ref_low: z.number().nullable(),
      ref_high: z.number().nullable(),
      ref_text: z.string().nullable().describe("Only when the range can't go in ref_low/ref_high (e.g. 'Negative'): the range as printed. Otherwise null"),
    }),
  ),
  reading_notes: z.string().nullable().describe("Anything that made the report hard to read, e.g. a blurry page"),
});
export type Extracted = z.infer<typeof ExtractedSchema>;

export const VERDICT_LEVELS = ["go", "go_with_tweaks", "build", "doctor_first"] as const;
export type VerdictLevel = (typeof VERDICT_LEVELS)[number];

export const ReadSchema = z.object({
  headline: z.string().describe("Six words or fewer that capture this report for this person"),
  verdict: z.object({
    level: z.enum(VERDICT_LEVELS),
    line: z.string().describe("The goal-aligned verdict, e.g. 'Ready for HYROX Mumbai, with one fix.'"),
    detail: z.string(),
  }),
  summary: z.string(),
  focus: z.array(
    z.object({
      marker_key: z.string().nullable(),
      title: z.string(),
      why: z.string().describe("Why it matters for their activity and goal"),
      action: z.string().describe("A food-first, practical step"),
    }),
  ),
  markers: z.array(z.object({ id: z.string(), note: z.string() })),
  wins: z.array(z.string()),
  doctor_questions: z.array(z.string()),
  retest: z.object({ weeks: z.number(), markers: z.array(z.string()), why: z.string() }),
  test_tips: z.array(z.string()),
});
export type Read = z.infer<typeof ReadSchema>;

// Since 2026-11-18 (second change that day) the model no longer gives minerals for foods on the
// food list: it names each ingredient's code and raw grams, and code works the minerals out
// (lib/domain/meal-minerals.ts). It still gives the vitamins for each item, and the minerals of
// foods off the list. Meals and usual days saved before then have per-item `micros` from the model.
const MineralsSchema = z.object({
  iron_mg: z.number(),
  calcium_mg: z.number(),
  magnesium_mg: z.number(),
  zinc_mg: z.number(),
  b12_ug: z.number(),
});

const IngredientSchema = z.object({
  food: z.enum([...FOOD_CODES, "other"]).describe("The code from the food list, or 'other' when nothing on it fits"),
  name: z.string().describe("Short, e.g. 'toor dal'"),
  raw_g: z.number().describe("Edible weight before cooking or soaking (dry dal, raw rice, atta, raw meat without bone). Never cooked weight"),
  kcal: z.number().describe("Energy of this ingredient alone"),
  minerals: MineralsSchema.nullable().describe("Only when food is 'other': its iron, calcium, magnesium, zinc and B12 in raw_g. Otherwise null"),
});

const VitaminsSchema = z.object({
  folate_ug: z.number(),
  vitamin_c_mg: z.number(),
  vitamin_d_iu: z.number(),
});

// Ingredients come before the item's own totals, so the model lists them first and then estimates
// the whole portion. With the totals first, a live test returned 0 kcal and 0 macros for the item.
const ItemSchema = z.object({
  name: z.string(),
  portion: z.string().describe("Household measure, e.g. '2 rotis' or '1 katori (150 mL)'"),
  grams: z.number().nullable(),
  ingredients: z.array(IngredientSchema),
  kcal: z.number().describe("The whole portion as eaten, including cooking fat"),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fibre_g: z.number(),
  vitamins: VitaminsSchema.describe("For the whole portion as eaten"),
});

export const MealSchema = z.object({
  is_food: z.boolean(),
  // Before the title, so the language is settled before any words are written.
  reply_language: z.enum(SPOKEN_IDS).describe("The language you write the title and tip in"),
  title: z.string(),
  meal_guess: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable(),
  items: z.array(ItemSchema).describe("One per dish or food named: '2 rotis, dal and curd' is three items"),
  confidence: z.enum(["high", "medium", "low"]),
  tip: z.string().nullable().describe("One short, specific tip linked to their markers or goal, or null"),
});
export type Meal = z.infer<typeof MealSchema>;

export const DaySchema = z.object({
  meals: z.array(
    z.object({
      meal: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      title: z.string(),
      ingredients: z.array(IngredientSchema),
      kcal: z.number().describe("The whole meal as eaten, including cooking fat"),
      protein_g: z.number(),
      carbs_g: z.number(),
      fat_g: z.number(),
      fibre_g: z.number(),
      vitamins: VitaminsSchema.describe("For the whole meal as eaten"),
    }),
  ),
  patterns: z.array(z.string()).describe("2–4 plain observations about how they eat"),
});
export type Day = z.infer<typeof DaySchema>;

/** A usual day's meal as saved: ingredients resolved, micronutrients worked out in code. */
export type SavedDayMeal = Omit<Day["meals"][number], "ingredients" | "vitamins"> & { ingredients: Ingredient[]; micros: Micros };

/**
 * A usual day as saved: the average of up to USUAL_DAY_RUNS estimates (averageDays), with the
 * day's micronutrients added up in code. Older days have less:
 * - before 2026-11-18: the model's own day total, no micronutrients per meal;
 * - from 2026-11-18 until the food table: the model's micronutrients per meal, no ingredients or basis.
 */
export type SavedDay = {
  meals: (Omit<SavedDayMeal, "micros" | "ingredients"> & { micros?: Micros; ingredients?: Ingredient[] })[];
  micros: Micros;
  patterns: string[];
  runs?: number;
  /** How the minerals were worked out (since the food table). */
  basis?: MineralBasis;
};

export const WrapStorySchema = z.object({
  title: z.string(),
  cards: z.array(
    z.object({
      kind: z.enum(["stat", "streak", "food", "gap", "marker", "win", "next"]),
      big: z.string().describe("The big thing on the card: a number from the stats, or 1–3 words"),
      label: z.string(),
      line: z.string(),
    }),
  ),
  one_thing: z.string(),
});
export type WrapStory = z.infer<typeof WrapStorySchema>;

// ---- Web-search replies (parsed from free text, so lenient) ----

// A string the model may leave out or set to null; always comes back as string | null.
const maybe = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
// A string the model may leave out; always comes back as a string.
const text = z
  .string()
  .nullish()
  .transform((v) => v ?? "");
// A sentence, even when the model wrote {"marker": "...", "why": "..."} instead of a string.
const line = z
  .union([z.string(), z.record(z.string(), z.unknown()).transform((o) => Object.values(o).filter((v): v is string => typeof v === "string").join(": "))])
  .refine((v) => v.trim() !== "");
// Keeps the entries that fit and drops the ones that don't. `required` arrays
// must be present, so a reply in the wrong shape altogether still fails.
const keep = <T extends z.ZodType>(item: T) => (xs: unknown[] | null | undefined) =>
  (xs ?? []).flatMap((x) => {
    const r = item.safeParse(x);
    return r.success ? [r.data as z.output<T>] : [];
  });
const lenientArray = <T extends z.ZodType>(item: T) => z.array(z.unknown()).nullish().transform(keep(item));
const requiredArray = <T extends z.ZodType>(item: T) => z.array(z.unknown()).transform(keep(item));

export const EventSchema = z.object({
  name: z.string(),
  kind: maybe,
  starts_on: maybe,
  ends_on: maybe,
  city: maybe,
  country: maybe,
  url: maybe,
  details: maybe,
});

export const EventsSchema = z.object({ events: requiredArray(EventSchema) });

export const StackSchema = z.object({
  items: requiredArray(
    z.object({
      // An item needs at least a nutrient and a dose to be safe to show.
      nutrient: z.string().min(1),
      dose: z.string().min(1),
      why: text,
      markers: lenientArray(z.string()),
      diet_gap: maybe,
      form: text,
      timing: text,
      duration: text,
      cautions: maybe,
      // Since 2026-11-13: the rule that earned the item, and brand prices for budgets. Older stacks have neither.
      rule: z.string().nullable().optional(),
      brands: lenientArray(
        z.object({
          brand: z.string(),
          product: text,
          url: maybe,
          note: maybe,
          price_inr: z.number().nullable().optional(),
          pack: z.string().nullable().optional(),
          monthly_inr: z.number().nullable().optional(),
        }),
      ),
    }),
  ),
  skip: lenientArray(z.object({ name: z.string(), why: text })),
  food_first: lenientArray(line),
  see_doctor: lenientArray(line),
  // Since 2026-11-17, worked out in code (foodGaps): what the meals fall short on, what the
  // stack did about each, and what the averages came from. Older stacks have neither.
  gaps: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        pct: z.number(),
        iu: z.number().nullable().optional(),
        outcome: z.enum(GAP_OUTCOMES),
        note: z.string(),
        rule: z.string().nullable(),
      }),
    )
    .optional(),
  gaps_basis: z.object({ source: z.enum(["logs", "typical_day"]), days: z.number() }).nullable().optional(),
});
export type StackPlan = z.infer<typeof StackSchema>;
