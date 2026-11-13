import { z } from "zod";
import { EXTRACT_KEYS } from "@/lib/domain/markers";
import { SPOKEN_IDS } from "@/lib/domain/speech";

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
  // Before the title, so the language is settled before any words are written.
  reply_language: z.enum(SPOKEN_IDS).describe("The language you write the title and tip in"),
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
});
export type StackPlan = z.infer<typeof StackSchema>;
