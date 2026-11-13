// The stack, worked out in code. Each rule says which marker or food gap earns
// a supplement, in what form, at what conservative dose, for how long, and with
// which cautions. This replaced a Sonnet call with web searches for every stack
// (about $0.16 each, 2026-11-11); brands now come from a shared cache, and Claude
// only translates the text for Hindi and Hinglish readers.
//
// Doses stay within adult tolerable upper limits and are deliberately at the
// low end. The safety floor (lib/domain/safety.ts, floorStack) still runs on the
// result: nothing self-treats a flagged marker, and iron needs a measured low ferritin.

import { markerDef, toCatalogUnit } from "./markers.ts";
import type { MicroKey } from "./nutrition.ts";

export type StackItem = {
  nutrient: string;
  why: string;
  markers: string[];
  diet_gap: string | null;
  form: string;
  dose: string;
  timing: string;
  duration: string;
  cautions: string | null;
  /** The rule that earned it; picks typical prices when a brand has none (lib/domain/budget.ts). */
  rule?: RuleId;
  brands: StackBrand[];
};
/** A brand found by the monthly search. Prices are as listed then, for a month at this item's dose. */
export type StackBrand = {
  brand: string;
  product: string;
  url: string | null;
  note: string | null;
  price_inr?: number | null;
  pack?: string | null;
  monthly_inr?: number | null;
};
export type Plan = {
  items: StackItem[];
  skip: { name: string; why: string }[];
  food_first: string[];
  see_doctor: string[];
};

export type RuleMarker = {
  key: string | null;
  name: string;
  value: number | null;
  unit: string | null;
  status: string; // low | edge_low | in_range | edge_high | high | unknown
  flag: string | null;
};
export type Gap = { key: MicroKey | "protein" | "fibre"; label: string; pct: number };
export type RuleContext = {
  markers: RuleMarker[];
  gaps: Gap[]; // share of daily need, from logs or the typical day; empty when unknown
  diet: string | null; // veg | eggetarian | nonveg | vegan | jain
  level: string | null; // starting | regular | competitive | elite
  conditions: string[];
  medications: string | null;
};

/** The rule ids double as the key for shared brand look-ups. */
export type RuleId = "vitamin_d3" | "b12" | "iron" | "folate" | "magnesium" | "omega3" | "calcium" | "protein" | "zinc";

const PLANT_DIETS = new Set(["veg", "vegan", "jain", "eggetarian"]);
const LOW = new Set(["low", "edge_low"]);
const HIGH = new Set(["high", "edge_high"]);
const fmt = (n: number) => (Math.abs(n) >= 100 ? String(Math.round(n)) : String(+n.toFixed(1)));

const byKey = (ctx: RuleContext, key: string) => ctx.markers.find((m) => m.key === key);
const gapOf = (ctx: RuleContext, key: Gap["key"]) => ctx.gaps.find((g) => g.key === key);
const reading = (m: RuleMarker) => (m.value != null ? `${fmt(m.value)}${m.unit ? ` ${m.unit}` : ""}` : "");
const markerName = (m: RuleMarker) => markerDef(m.key)?.name ?? m.name;

type Built = Omit<StackItem, "brands"> & { rule: RuleId };

// ── The rules ─────────────────────────────────────────────────────────────

function vitaminD(ctx: RuleContext): Built | null {
  const m = byKey(ctx, "vitamin_d");
  if (!m || !LOW.has(m.status) || m.value == null) return null;
  const ngml = toCatalogUnit(markerDef("vitamin_d")!, m.value, m.unit);
  const dose = ngml != null && ngml < 20 ? "2,000 IU a day" : "1,000 IU a day";
  return {
    rule: "vitamin_d3",
    nutrient: "Vitamin D3",
    why: `Your vitamin D is ${reading(m)}, ${m.status === "low" ? "below" : "at the bottom of"} the range.`,
    markers: ["vitamin_d"],
    diet_gap: null,
    form: "Cholecalciferol (D3), a tablet, capsule or drops",
    dose,
    timing: "With your biggest meal; it needs some fat to absorb",
    duration: "12 weeks, then retest vitamin D",
    cautions: "Don't go above 4,000 IU a day without a doctor. Ask first if you've had kidney stones, have kidney disease or high calcium.",
  };
}

function b12(ctx: RuleContext): Built | null {
  const m = byKey(ctx, "b12");
  if (!m || !LOW.has(m.status)) return null;
  // At the bottom of the range, it's worth acting only where diet explains it.
  if (m.status === "edge_low" && !PLANT_DIETS.has(ctx.diet ?? "")) return null;
  const meds = /metformin|pantoprazole|omeprazole|rabeprazole|esomeprazole|ranitidine|famotidine/i.test(ctx.medications ?? "");
  return {
    rule: "b12",
    nutrient: "Vitamin B12",
    why: `Your B12 is ${reading(m)}, ${m.status === "low" ? "below" : "at the bottom of"} the range${PLANT_DIETS.has(ctx.diet ?? "") ? ", common on a vegetarian diet" : ""}.`,
    markers: ["b12"],
    diet_gap: null,
    form: "Methylcobalamin or cyanocobalamin tablet",
    dose: "500–1,000 mcg a day",
    timing: "Any time of day",
    duration: "12 weeks, then retest B12",
    cautions: meds ? "Your medicines (metformin or acid reducers) lower B12 absorption; tell your doctor you're taking it." : null,
  };
}

function iron(ctx: RuleContext): Built | null {
  const m = byKey(ctx, "ferritin");
  if (!m || m.status !== "low") return null;
  return {
    rule: "iron",
    nutrient: "Iron (only if your doctor agrees)",
    why: `Your ferritin, your stored iron, is ${reading(m)}, below the range.`,
    markers: ["ferritin"],
    diet_gap: null,
    form: "Iron bisglycinate (gentler on the stomach)",
    dose: "About 18–30 mg of elemental iron a day or every other day, once a doctor agrees",
    timing: "With a vitamin C food, 2 hours away from tea, coffee, milk and calcium",
    duration: "8–12 weeks, then retest ferritin and haemoglobin",
    cautions:
      "Check with a doctor before starting: the cause of low iron matters, especially for men and women after menopause. Stop and see a doctor for black stools or bad stomach pain. Keep it away from children.",
  };
}

function folate(ctx: RuleContext): Built | null {
  const m = byKey(ctx, "folate");
  if (!m || m.status !== "low") return null;
  return {
    rule: "folate",
    nutrient: "Folate",
    why: `Your folate is ${reading(m)}, below the range.`,
    markers: ["folate"],
    diet_gap: null,
    form: "Folic acid or methylfolate",
    dose: "400 mcg a day",
    timing: "Any time of day",
    duration: "12 weeks, then retest folate",
    cautions: "Folate can hide a low B12, so test B12 too if you haven't.",
  };
}

function magnesium(ctx: RuleContext): Built | null {
  const m = byKey(ctx, "magnesium");
  const gap = gapOf(ctx, "magnesium_mg");
  const markerLow = !!m && LOW.has(m.status);
  const dietLow = !!gap && gap.pct < 60;
  if (!markerLow && !dietLow) return null;
  return {
    rule: "magnesium",
    nutrient: "Magnesium",
    why: markerLow ? `Your magnesium is ${reading(m!)}, ${m!.status === "low" ? "below" : "at the bottom of"} the range.` : `Your meals cover about ${gap!.pct}% of your magnesium need.`,
    markers: markerLow ? ["magnesium"] : [],
    diet_gap: dietLow ? `Magnesium at ${gap!.pct}% of daily need` : null,
    form: "Magnesium glycinate",
    dose: "200–300 mg of elemental magnesium a day",
    timing: "In the evening",
    duration: "8 weeks, then retest if you tested it",
    cautions: "Too much can loosen stools; lower the dose if it does.",
  };
}

function omega3(ctx: RuleContext): Built | null {
  const m = byKey(ctx, "triglycerides");
  if (!m || !HIGH.has(m.status)) return null;
  const plant = PLANT_DIETS.has(ctx.diet ?? "");
  return {
    rule: "omega3",
    nutrient: "Omega-3 (EPA and DHA)",
    why: `Your triglycerides are ${reading(m)}, ${m.status === "high" ? "above" : "near the top of"} the range.`,
    markers: ["triglycerides"],
    diet_gap: null,
    form: plant ? "Algae oil (vegetarian EPA and DHA)" : "Fish oil or algae oil",
    dose: "1–2 g of EPA and DHA together a day",
    timing: "With meals",
    duration: "12 weeks, then retest triglycerides",
    cautions: "Ask a doctor first if you take blood thinners or have surgery coming up.",
  };
}

function calcium(ctx: RuleContext): Built | null {
  const gap = gapOf(ctx, "calcium_mg");
  if (!gap || gap.pct >= 50) return null;
  return {
    rule: "calcium",
    nutrient: "Calcium",
    why: `Your meals cover about ${gap.pct}% of your calcium need.`,
    markers: [],
    diet_gap: `Calcium at ${gap.pct}% of daily need`,
    form: "Calcium citrate",
    dose: "500 mg a day",
    timing: "With a meal, apart from any iron tablet",
    duration: "Until your meals cover it",
    cautions: "Ask a doctor first if you've had kidney stones.",
  };
}

function protein(ctx: RuleContext): Built | null {
  const gap = gapOf(ctx, "protein");
  if (!gap || gap.pct >= 70 || !ctx.level || ctx.level === "starting") return null;
  const plant = ctx.diet === "vegan" || ctx.diet === "jain";
  return {
    rule: "protein",
    nutrient: "Protein top-up",
    why: `Your meals give about ${gap.pct}% of the protein your training needs.`,
    markers: [],
    diet_gap: `Protein at ${gap.pct}% of daily need`,
    form: plant ? "Pea or soy protein powder" : "Whey protein, or pea or soy if you prefer",
    dose: "One scoop (20–30 g of protein) on days your meals fall short",
    timing: "After training or with breakfast",
    duration: "While your meals fall short",
    cautions: "Pick one tested for heavy metals. Food comes first: dal, curd, paneer, eggs or sprouts at each meal.",
  };
}

function zinc(ctx: RuleContext): Built | null {
  const gap = gapOf(ctx, "zinc_mg");
  if (!gap || gap.pct >= 60 || !PLANT_DIETS.has(ctx.diet ?? "")) return null;
  return {
    rule: "zinc",
    nutrient: "Zinc",
    why: `Your meals cover about ${gap.pct}% of your zinc need.`,
    markers: [],
    diet_gap: `Zinc at ${gap.pct}% of daily need`,
    form: "Zinc picolinate or gluconate",
    dose: "10–15 mg a day",
    timing: "With a meal",
    duration: "8 weeks",
    cautions: "Don't go above 40 mg a day; long use can lower copper.",
  };
}

const RULES = [vitaminD, b12, iron, folate, magnesium, omega3, calcium, protein, zinc];

// ── Priority ──────────────────────────────────────────────────────────────
// The order a budget spends in: a result outside its range first, then one at the
// edge of range, then food gaps, biggest gap first. Ties keep the order above.

const GAP_KEY: Partial<Record<RuleId, Gap["key"]>> = { magnesium: "magnesium_mg", calcium: "calcium_mg", protein: "protein", zinc: "zinc_mg" };

function rank(ctx: RuleContext, b: Built): [number, number] {
  const statuses = b.markers.map((k) => byKey(ctx, k)?.status);
  if (statuses.some((s) => s === "low" || s === "high")) return [0, 0];
  if (statuses.length) return [1, 0];
  const key = GAP_KEY[b.rule];
  return [2, (key && gapOf(ctx, key)?.pct) ?? 100];
}

// ── Food first and what to skip ───────────────────────────────────────────

const FOOD_FIRST: Partial<Record<RuleId, (ctx: RuleContext) => string>> = {
  vitamin_d3: () => "Vitamin D: 15–20 minutes of midday sun on your arms and legs a few days a week; eggs and fortified milk help a little.",
  b12: (c) => (c.diet === "vegan" ? "B12: fortified soy milk or cereals each day." : "B12: milk, curd and paneer every day, and eggs if you eat them."),
  iron: () => "Iron: rajma, chana, masoor, palak, til and jaggery, with lemon, amla or tomato in the same meal; keep chai an hour away.",
  folate: () => "Folate: dals, chana, leafy greens like methi and palak, and oranges.",
  magnesium: () => "Magnesium: pumpkin seeds, almonds, peanuts, dals, whole grains and leafy greens.",
  omega3: (c) => (PLANT_DIETS.has(c.diet ?? "") ? "Triglycerides: walnuts and flaxseed, and cut sugar, refined carbs and alcohol, which raise them most." : "Triglycerides: bangda or mathi twice a week, and cut sugar, refined carbs and alcohol, which raise them most."),
  calcium: () => "Calcium: curd, paneer, ragi, til and leafy greens.",
  protein: () => "Protein: add dal, curd, paneer, eggs or sprouts to every meal before reaching for a powder.",
  zinc: () => "Zinc: pumpkin seeds, chana, cashews and whole grains.",
};

function skips(ctx: RuleContext, chosen: Set<RuleId>): Plan["skip"] {
  const out: Plan["skip"] = [{ name: "Multivitamin", why: "Your gaps are specific; a multivitamin mostly adds things you don't need." }];
  const fine = (key: string) => {
    const m = byKey(ctx, key);
    return m && m.status === "in_range" ? m : null;
  };
  const d = fine("vitamin_d");
  if (d && !chosen.has("vitamin_d3")) out.push({ name: "Vitamin D", why: `Yours is ${reading(d)}, in range.` });
  const b = fine("b12");
  if (b && !chosen.has("b12")) out.push({ name: "Vitamin B12", why: `Yours is ${reading(b)}, healthy.` });
  const f = fine("ferritin");
  if (f && !chosen.has("iron")) out.push({ name: "Iron", why: `Your ferritin is ${reading(f)}, fine. Iron you don't need can harm.` });
  const t = fine("triglycerides");
  if (t && !chosen.has("omega3")) out.push({ name: "Fish oil for cholesterol", why: `Your triglycerides are ${reading(t)}, in range.` });
  out.push({ name: "Biotin", why: "No marker points to it, and it can distort thyroid and heart test results." });
  return out.slice(0, 4);
}

// ── The plan ──────────────────────────────────────────────────────────────

export type PlannedItem = StackItem & { rule: RuleId };

export function planStack(ctx: RuleContext): { items: PlannedItem[]; skip: Plan["skip"]; food_first: string[]; see_doctor: string[] } {
  const conditions = new Set(ctx.conditions);
  const see_doctor: string[] = [];

  // Pregnant or breastfeeding: nothing new without a doctor.
  if (conditions.has("pregnant")) {
    see_doctor.push("You're pregnant or breastfeeding: take nothing new without your doctor, and show them this report.");
    return { items: [], skip: [], food_first: [], see_doctor };
  }

  let built = RULES.map((r) => r(ctx)).filter((b): b is Built => !!b);
  built.sort((a, b) => {
    const [x, p] = rank(ctx, a);
    const [y, q] = rank(ctx, b);
    return x - y || p - q;
  });

  // Kidney disease: no magnesium, protein powder or extra calcium on our say-so.
  if (conditions.has("kidney")) {
    const held = built.filter((b) => b.rule === "magnesium" || b.rule === "protein" || b.rule === "calcium");
    if (held.length) see_doctor.push(`With a kidney condition, ask your doctor before ${held.map((h) => h.nutrient.toLowerCase()).join(" or ")}.`);
    built = built.filter((b) => !held.includes(b));
  }

  const medsNote = ctx.medications?.trim() ? ` You take ${ctx.medications.trim().slice(0, 80)}: check with your doctor or pharmacist for interactions.` : "";
  const items: PlannedItem[] = built.map(({ rule, ...item }) => ({
    ...item,
    rule,
    cautions: [item.cautions, medsNote.trim() || null].filter(Boolean).join(" ") || null,
    brands: [],
  }));

  const chosen = new Set(items.map((i) => i.rule));
  const food_first = [...chosen].map((r) => FOOD_FIRST[r]?.(ctx)).filter((s): s is string => !!s).slice(0, 4);
  return { items, skip: skips(ctx, chosen), food_first, see_doctor };
}

// What to search for when looking up brands for a rule, shared by everyone with that rule and diet.
// The dose lets the search say how long a pack lasts, so prices become a monthly cost.
export function brandQuery(rule: RuleId, diet: string | null): { key: string; nutrient: string; form: string; dose: string } {
  const plant = PLANT_DIETS.has(diet ?? "");
  const vegan = diet === "vegan" || diet === "jain";
  const map: Record<RuleId, [string, string]> = {
    vitamin_d3: ["Vitamin D3", vegan ? "vegan cholecalciferol (lichen D3)" : "cholecalciferol D3 1000 IU or 2000 IU"],
    b12: ["Vitamin B12", "methylcobalamin 500 or 1000 mcg tablet"],
    iron: ["Iron", "iron bisglycinate tablet"],
    folate: ["Folate", "folic acid or methylfolate 400 mcg"],
    magnesium: ["Magnesium", "magnesium glycinate"],
    omega3: ["Omega-3", plant ? "algae oil omega-3 EPA DHA" : "fish oil omega-3 EPA DHA"],
    calcium: ["Calcium", "calcium citrate"],
    protein: ["Protein powder", vegan ? "pea or soy protein powder" : plant ? "whey protein vegetarian" : "whey protein"],
    zinc: ["Zinc", "zinc picolinate or gluconate"],
  };
  const dose: Record<RuleId, string> = {
    vitamin_d3: "1,000–2,000 IU a day",
    b12: "500–1,000 mcg a day",
    iron: "18–30 mg of elemental iron a day",
    folate: "400 mcg a day",
    magnesium: "200–300 mg of elemental magnesium a day",
    omega3: "1–2 g of EPA and DHA together a day",
    calcium: "500 mg a day",
    protein: "one scoop (20–30 g of protein) a day",
    zinc: "10–15 mg a day",
  };
  const [nutrient, form] = map[rule];
  // One cache entry per rule and the diet variant that changes the product. "v2" entries
  // carry prices for budgets (2026-11-13); older ones are ignored and searched again.
  const variant = rule === "vitamin_d3" || rule === "protein" ? (vegan ? "vegan" : plant ? "veg" : "any") : rule === "omega3" ? (plant ? "veg" : "any") : "any";
  return { key: `v2:${rule}:${variant}`, nutrient, form, dose: dose[rule] };
}

export { markerName };
