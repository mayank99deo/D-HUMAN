import { z } from "zod";
import { MARKER_KEYS } from "@/lib/domain/markers";

// Output shapes Claude must return. Every field is required (nullable where it
// may be absent): structured outputs work best with closed, explicit schemas.

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
      key: z.enum([...MARKER_KEYS, "other"]),
      panel: z.string().nullable(),
      value: z.number().nullable(),
      value_text: z.string().nullable().describe("Only when the result is not a plain number, e.g. '<0.5' or 'Positive'"),
      unit: z.string().nullable(),
      ref_low: z.number().nullable(),
      ref_high: z.number().nullable(),
      ref_text: z.string().nullable().describe("The reference range exactly as printed"),
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
  markers: z.array(
    z.object({
      id: z.string(),
      note: z.string(),
      for_you: z.enum(["good", "watch", "act", "neutral"]),
    }),
  ),
  wins: z.array(z.string()),
  doctor_questions: z.array(z.string()),
  retest: z.object({ weeks: z.number(), markers: z.array(z.string()), why: z.string() }),
  test_tips: z.array(z.string()),
});
export type Read = z.infer<typeof ReadSchema>;

const MicrosSchema = z.object({
  iron_mg: z.number(),
  calcium_mg: z.number(),
  magnesium_mg: z.number(),
  zinc_mg: z.number(),
  b12_ug: z.number(),
  folate_ug: z.number(),
  vitamin_c_mg: z.number(),
  vitamin_d_iu: z.number(),
});

const ItemSchema = z.object({
  name: z.string(),
  portion: z.string().describe("Household measure, e.g. '2 rotis' or '1 katori (150 mL)'"),
  grams: z.number().nullable(),
  kcal: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fibre_g: z.number(),
});

export const MealSchema = z.object({
  is_food: z.boolean(),
  title: z.string(),
  meal_guess: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable(),
  items: z.array(ItemSchema),
  micros: MicrosSchema,
  confidence: z.enum(["high", "medium", "low"]),
  tip: z.string().nullable().describe("One short, specific tip linked to their markers or goal, or null"),
});
export type Meal = z.infer<typeof MealSchema>;

export const DaySchema = z.object({
  meals: z.array(
    z.object({
      meal: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      title: z.string(),
      kcal: z.number(),
      protein_g: z.number(),
      carbs_g: z.number(),
      fat_g: z.number(),
      fibre_g: z.number(),
    }),
  ),
  micros: MicrosSchema,
  patterns: z.array(z.string()).describe("2–4 plain observations about how they eat"),
});
export type Day = z.infer<typeof DaySchema>;

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

export const EventsSchema = z.object({
  events: z.array(
    z.object({
      name: z.string(),
      kind: z.string().nullable(),
      starts_on: z.string().nullable(),
      ends_on: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      url: z.string().nullable(),
      details: z.string().nullable(),
    }),
  ),
});

export const StackSchema = z.object({
  items: z.array(
    z.object({
      nutrient: z.string(),
      why: z.string(),
      markers: z.array(z.string()),
      diet_gap: z.string().nullable(),
      form: z.string(),
      dose: z.string(),
      timing: z.string(),
      duration: z.string(),
      cautions: z.string().nullable(),
      brands: z.array(
        z.object({ brand: z.string(), product: z.string(), url: z.string().nullable(), note: z.string().nullable() }),
      ),
    }),
  ),
  skip: z.array(z.object({ name: z.string(), why: z.string() })),
  food_first: z.array(z.string()),
  see_doctor: z.array(z.string()),
});
export type StackPlan = z.infer<typeof StackSchema>;
