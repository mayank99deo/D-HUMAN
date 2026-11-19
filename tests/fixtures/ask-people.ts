// Three synthetic people for Ask's tests and eval. Not real users. Statuses, flags, targets,
// the verdict level and the stack come from the repo's own code (statusFor, flagFor,
// targetsFor, floorVerdict, planStack, floorStack), the way the app works them out, so the
// AskData here is what Lane A's loader would hand over.
//
// - Riya: the typical person. 28, vegetarian runner, Pune Half Marathon, 16-marker report
//   with ferritin flagged doctor, 3-item stack, two meals today, free plan.
// - Arjun: the heavy person. 41, non-vegetarian lifter with diabetes and a kidney condition,
//   metformin; 75-marker report with HbA1c, fasting glucose and eGFR flagged; five meals
//   today; a usual day; a pass.
// - Meena: the holds. 30, pregnant, vegetarian, reads in Hindi; haemoglobin 6.7 flagged
//   urgent and ferritin doctor; stack on hold.

import type { AskData, AskMarker, AskMeal, AskPerson, AskReport, AskStack } from "../../lib/ask/types.ts";
import { flagFor, markerDef, statusFor, type Sex } from "../../lib/domain/markers.ts";
import { emptyMicros, targetsFor } from "../../lib/domain/nutrition.ts";
import { PLAN, type PlanView } from "../../lib/domain/plan.ts";
import { asFlag, floorStack, floorVerdict } from "../../lib/domain/safety.ts";
import { planStack, type Gap } from "../../lib/domain/supplements.ts";
import type { DietPicture, MealKind, Totals } from "../../lib/platform/food.ts";

type Row = [key: string, value: number, unit: string, low: number | null, high: number | null];
type MealRow = { meal: MealKind; at: string; title: string; kcal: number; proteinG: number; carbsG: number; fatG: number; fibreG: number };

/** 13:40 in India on Thursday 19 November 2026. */
export const ASK_NOW = new Date("2026-11-19T08:10:00Z");

export function reportOf(sex: Sex, collectedOn: string, rows: Row[], o: { id?: string; mayNotBeTheirs?: boolean } = {}): AskReport {
  const markers: AskMarker[] = rows.map(([key, value, unit, low, high]) => {
    const def = markerDef(key);
    return { key, printedName: def?.name ?? key, value, valueText: null, unit, refLow: low, refHigh: high, status: statusFor(value, low, high), flag: flagFor(def, value, unit, sex) };
  });
  const verdict = floorVerdict(
    { level: "go_with_tweaks", line: "Ready, with fixes.", detail: "" },
    { markers: markers.map((m) => ({ key: m.key, name: markerDef(m.key)?.name ?? m.printedName, status: m.status, flag: asFlag(m.flag) })) },
  );
  return { id: o.id ?? "3f0c2a9e-1b4d-4c8e-9a7f-2d6b5e8c1a03", collectedOn, verdictLevel: verdict.level, mayNotBeTheirs: o.mayNotBeTheirs ?? false, markers };
}

function stackOf(p: { report: AskReport | null; gaps: Gap[]; diet: string; level: string; conditions: string[]; medications: string | null; builtOn: string }): AskStack {
  const rows = p.report?.markers ?? [];
  const named = rows.map((m) => ({ key: m.key, name: markerDef(m.key)?.name ?? m.printedName, status: m.status, flag: asFlag(m.flag) }));
  const planned = planStack({ markers: rows.map((m) => ({ ...named.find((n) => n.key === m.key)!, value: m.value, unit: m.unit })), gaps: p.gaps, diet: p.diet, level: p.level, conditions: p.conditions, medications: p.medications });
  const floored = floorStack({ ...planned }, named);
  const leftForDoctor = named.filter((m) => m.flag).map((m) => m.name);
  if (named.some((m) => m.flag === "urgent")) return { state: "held", reason: "urgent", builtOn: p.builtOn, leftForDoctor };
  if (p.conditions.includes("pregnant")) return { state: "held", reason: "pregnant", builtOn: p.builtOn, leftForDoctor };
  return {
    state: "current",
    builtOn: p.builtOn,
    basis: p.report ? "report" : "meals",
    items: floored.items.map((i) => ({ nutrient: i.nutrient, form: i.form, dose: i.dose, timing: i.timing, duration: i.duration, cautions: i.cautions })),
    skip: floored.skip.map((s) => s.name),
    leftForDoctor,
  };
}

function totalsOf(meals: MealRow[]): Totals {
  return meals.reduce<Totals>(
    (t, m) => ({ kcal: t.kcal + m.kcal, proteinG: t.proteinG + m.proteinG, carbsG: t.carbsG + m.carbsG, fatG: t.fatG + m.fatG, fibreG: t.fibreG + m.fibreG, micros: t.micros }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0, micros: emptyMicros() },
  );
}

type Spec = {
  person: Omit<AskPerson, "readLanguage"> & { readLanguage?: AskPerson["readLanguage"] };
  plan: { passUntil: string | null; readsUsed: number; mealsUsed: number };
  today: MealRow[];
  usualDay: string | null;
  picture: { source: "logs" | "typical_day"; days: number; kcal: number; proteinG: number; gaps: Gap[] } | null;
  report: AskReport | null;
  stackBuilt: string | null;
  stackBrands: string[];
};

export function askDataOf(s: Spec, o: { asksLeft?: number; now?: Date } = {}): AskData {
  const p: AskPerson = { readLanguage: "en", ...s.person };
  const targets = targetsFor({ sex: p.sex, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg, level: p.level, archetype: p.archetype as never, goals: p.goals });
  const plan: PlanView = {
    pass: s.plan.passUntil ? { until: s.plan.passUntil } : null,
    queuedUntil: null,
    reads: { used: s.plan.readsUsed, limit: s.plan.passUntil ? PLAN.passReads : PLAN.freeReads, free: !s.plan.passUntil },
    meals: { today: s.today.length, perDay: PLAN.mealsPerDay, used: s.plan.mealsUsed, freeLimit: s.plan.passUntil ? null : PLAN.freeMeals },
    readBlock: null,
    mealBlock: null,
    canBuy: !s.plan.passUntil,
    paymentsOn: true,
  };
  const meals: AskMeal[] = s.today.map((m) => ({ meal: m.meal, title: m.title, at: new Date(`2026-11-19T${m.at}:00+05:30`), kcal: m.kcal, proteinG: m.proteinG }));
  const diet: DietPicture = s.picture
    ? {
        source: s.picture.source,
        days: s.picture.source === "logs" ? s.picture.days : 0,
        fullDays: s.picture.source === "logs" ? s.picture.days : 0,
        perDay: { kcal: s.picture.kcal, proteinG: s.picture.proteinG, carbsG: 0, fatG: 0, fibreG: 0, micros: emptyMicros() },
        gaps: s.picture.gaps,
        patterns: [],
        usualDayShort: false,
      }
    : { source: "none", days: 0, fullDays: 0, perDay: null, gaps: [], patterns: [], usualDayShort: false };
  const stack: AskStack = s.stackBuilt
    ? stackOf({ report: s.report, gaps: s.picture?.gaps ?? [], diet: p.diet ?? "veg", level: p.level ?? "regular", conditions: p.conditions, medications: p.medications, builtOn: s.stackBuilt })
    : { state: "none" };
  return {
    now: o.now ?? ASK_NOW,
    timezone: "Asia/Kolkata",
    region: "in",
    person: p,
    plan,
    asksLeft: o.asksLeft ?? 4,
    targets,
    today: { meals, totals: totalsOf(s.today) },
    diet,
    usualDay: s.usualDay,
    report: s.report,
    stack,
    stackBrands: s.stackBrands,
  };
}

const gap = (key: Gap["key"], label: string, pct: number): Gap => ({ key, label, pct });

export const RIYA_SPEC: Spec = {
  person: {
    age: 28, sex: "female", heightCm: 160, weightKg: 52, archetype: "running", level: "regular", sessionsPerWeek: 4, goals: ["energy", "performance"],
    eventTyped: "Pune Half Marathon", diet: "veg", conditions: [], medications: null, currentSupplements: null,
  },
  plan: { passUntil: null, readsUsed: 1, mealsUsed: 9 },
  today: [
    { meal: "breakfast", at: "08:10", title: "Poha with peanuts and chai", kcal: 390, proteinG: 9, carbsG: 58, fatG: 13, fibreG: 4 },
    { meal: "lunch", at: "13:05", title: "Rajma chawal with curd", kcal: 610, proteinG: 21, carbsG: 96, fatG: 14, fibreG: 12 },
  ],
  usualDay: null,
  picture: { source: "logs", days: 4, kcal: 1640, proteinG: 52, gaps: [gap("b12_ug", "Vitamin B12", 34), gap("iron_mg", "Iron", 41), gap("calcium_mg", "Calcium", 58), gap("protein", "Protein", 63), gap("zinc_mg", "Zinc", 66)] },
  report: reportOf("female", "2026-11-02", [
    ["hemoglobin", 11.6, "g/dL", 12, 15], ["ferritin", 11, "ng/mL", 15, 150], ["transferrin_sat", 17, "%", 20, 50],
    ["vitamin_d", 16, "ng/mL", 30, 100], ["b12", 236, "pg/mL", 211, 911], ["tsh", 2.4, "µIU/mL", 0.35, 5.5],
    ["hba1c", 5.2, "%", 4, 5.6], ["glucose_fasting", 86, "mg/dL", 70, 100], ["total_cholesterol", 164, "mg/dL", null, 200],
    ["ldl", 92, "mg/dL", null, 100], ["hdl", 58, "mg/dL", 50, null], ["triglycerides", 84, "mg/dL", null, 150],
    ["alt", 17, "U/L", null, 35], ["creatinine", 0.76, "mg/dL", 0.6, 1.1], ["magnesium", 2.0, "mg/dL", 1.7, 2.4], ["hscrp", 0.6, "mg/L", null, 3],
  ]),
  stackBuilt: "2026-11-03",
  stackBrands: ["Carbamide Forte", "Tayo"],
};

export const ARJUN_SPEC: Spec = {
  person: {
    age: 41, sex: "male", heightCm: 175, weightKg: 84, archetype: "strength", level: "regular", sessionsPerWeek: 5, goals: ["muscle", "longevity"],
    eventTyped: null, diet: "nonveg", conditions: ["diabetes", "kidney"], medications: "Metformin 500 mg twice a day, Telmisartan 40 mg", currentSupplements: "Whey protein, fish oil",
    readLanguage: "hinglish",
  },
  plan: { passUntil: "10 Dec 2026", readsUsed: 1, mealsUsed: 140 },
  today: [
    { meal: "breakfast", at: "07:45", title: "3 egg omelette with 2 toast", kcal: 420, proteinG: 24, carbsG: 30, fatG: 22, fibreG: 2 },
    { meal: "snack", at: "10:30", title: "Whey shake with milk", kcal: 260, proteinG: 32, carbsG: 14, fatG: 8, fibreG: 0 },
    { meal: "lunch", at: "13:15", title: "Chicken curry, 3 roti, salad", kcal: 720, proteinG: 41, carbsG: 68, fatG: 30, fibreG: 9 },
    { meal: "snack", at: "17:00", title: "Roasted chana and buttermilk", kcal: 230, proteinG: 13, carbsG: 30, fatG: 5, fibreG: 7 },
    { meal: "dinner", at: "20:30", title: "Dal tadka, jeera rice, bhindi sabzi", kcal: 640, proteinG: 20, carbsG: 92, fatG: 20, fibreG: 10 },
  ],
  usualDay: "Eggs and toast in the morning, whey after gym, roti sabzi dal at lunch, chana or fruit in the evening, dal chawal or chicken at night, 2 cups chai",
  picture: { source: "logs", days: 12, kcal: 2210, proteinG: 118, gaps: [gap("magnesium_mg", "Magnesium", 52), gap("fibre", "Fibre", 61), gap("calcium_mg", "Calcium", 66)] },
  report: reportOf("male", "2026-10-28", [
    ["hemoglobin", 14.1, "g/dL", 13, 17], ["rbc", 4.9, "million/µL", 4.5, 5.5], ["hematocrit", 43, "%", 40, 50], ["mcv", 88, "fL", 83, 101],
    ["mch", 29, "pg", 27, 32], ["mchc", 33, "g/dL", 31.5, 34.5], ["rdw", 13.1, "%", 11.6, 14], ["wbc", 7.2, "10³/µL", 4, 11],
    ["neutrophils_pct", 58, "%", 40, 80], ["lymphocytes_pct", 32, "%", 20, 40], ["monocytes_pct", 6, "%", 2, 10], ["eosinophils_pct", 3, "%", 1, 6],
    ["basophils_pct", 1, "%", null, 2], ["neutrophils", 4.2, "10³/µL", 2, 7], ["lymphocytes", 2.3, "10³/µL", 1, 3], ["monocytes", 0.43, "10³/µL", 0.2, 1],
    ["eosinophils", 0.22, "10³/µL", 0.02, 0.5], ["basophils", 0.07, "10³/µL", null, 0.1], ["platelets", 248, "10³/µL", 150, 410], ["mpv", 9.8, "fL", 7.5, 11.5],
    ["nlr", 1.83, "ratio", null, 3], ["ferritin", 182, "ng/mL", 30, 400], ["iron", 96, "µg/dL", 60, 170], ["tibc", 318, "µg/dL", 250, 450],
    ["transferrin_sat", 30, "%", 20, 50], ["uibc", 222, "µg/dL", null, null], ["vitamin_d", 19, "ng/mL", 30, 100], ["b12", 248, "pg/mL", 211, 911],
    ["folate", 8.4, "ng/mL", 4, 20], ["tsh", 3.1, "µIU/mL", 0.35, 5.5], ["t3", 112, "ng/dL", 80, 200], ["t4", 7.9, "µg/dL", 5, 12],
    ["ft4", 1.2, "ng/dL", 0.8, 1.8], ["glucose_fasting", 132, "mg/dL", 70, 100], ["hba1c", 7.1, "%", 4, 5.6], ["insulin_fasting", 14, "µIU/mL", 2, 25],
    ["homa_ir", 4.56, "index", null, 2.5], ["total_cholesterol", 212, "mg/dL", null, 200], ["ldl", 128, "mg/dL", null, 100], ["hdl", 38, "mg/dL", 40, null],
    ["triglycerides", 214, "mg/dL", null, 150], ["vldl", 43, "mg/dL", 5, 40], ["non_hdl", 174, "mg/dL", null, 130], ["tc_hdl_ratio", 5.58, "ratio", null, 5],
    ["ldl_hdl_ratio", 3.37, "ratio", null, 3.5], ["tg_hdl_ratio", 5.63, "ratio", null, 3], ["apob", 118, "mg/dL", null, 100], ["lpa", 22, "mg/dL", null, 30],
    ["alt", 46, "U/L", null, 40], ["ast", 34, "U/L", null, 40], ["alp", 88, "U/L", 40, 130], ["ggt", 52, "U/L", null, 55],
    ["bilirubin_total", 0.8, "mg/dL", 0.3, 1.2], ["bilirubin_direct", 0.2, "mg/dL", null, 0.3], ["bilirubin_indirect", 0.6, "mg/dL", null, 1],
    ["total_protein", 7.2, "g/dL", 6, 8.3], ["albumin", 4.4, "g/dL", 3.5, 5], ["globulin", 2.8, "g/dL", 2, 3.5], ["ag_ratio", 1.57, "ratio", 1, 2.2],
    ["creatinine", 1.42, "mg/dL", 0.7, 1.3], ["egfr", 56, "mL/min/1.73m²", 90, null], ["urea", 44, "mg/dL", 15, 45], ["bun", 20.5, "mg/dL", 7, 20],
    ["bun_creatinine_ratio", 14.4, "ratio", 10, 20], ["uric_acid", 7.6, "mg/dL", 3.5, 7.2], ["sodium", 139, "mmol/L", 135, 145], ["potassium", 4.9, "mmol/L", 3.5, 5.1],
    ["chloride", 103, "mmol/L", 98, 107], ["calcium", 9.3, "mg/dL", 8.6, 10.3], ["magnesium", 1.8, "mg/dL", 1.7, 2.4], ["hscrp", 3.8, "mg/L", null, 3],
    ["esr", 14, "mm/hr", null, 15], ["homocysteine", 16.8, "µmol/L", 5, 15], ["testosterone_total", 402, "ng/dL", 264, 916], ["ck", 286, "U/L", 39, 308],
    ["psa_total", 0.9, "ng/mL", null, 4], ["cortisol", 14, "µg/dL", 6, 23],
  ]),
  stackBuilt: "2026-10-30",
  stackBrands: ["HealthKart HK Vitals"],
};

export const MEENA_SPEC: Spec = {
  person: {
    age: 30, sex: "female", heightCm: 155, weightKg: 58, archetype: "walking", level: "starting", sessionsPerWeek: 3, goals: ["energy", "deficiency"],
    eventTyped: null, diet: "veg", conditions: ["pregnant"], medications: "Folic acid 5 mg (prescribed)", currentSupplements: null, readLanguage: "hi",
  },
  plan: { passUntil: null, readsUsed: 1, mealsUsed: 3 },
  today: [{ meal: "breakfast", at: "08:30", title: "Idli sambar", kcal: 320, proteinG: 11, carbsG: 58, fatG: 5, fibreG: 5 }],
  usualDay: null,
  picture: null,
  report: reportOf("female", "2026-11-15", [
    ["hemoglobin", 6.7, "g/dL", 12, 15], ["ferritin", 8, "ng/mL", 15, 150], ["mcv", 71, "fL", 83, 101], ["platelets", 210, "10³/µL", 150, 410],
    ["vitamin_d", 22, "ng/mL", 30, 100], ["b12", 310, "pg/mL", 211, 911], ["tsh", 3.1, "µIU/mL", 0.35, 5.5], ["glucose_fasting", 84, "mg/dL", 70, 100],
  ]),
  stackBuilt: "2026-11-16",
  stackBrands: [],
};

export const RIYA = askDataOf(RIYA_SPEC);
export const ARJUN = askDataOf(ARJUN_SPEC, { asksLeft: 3 });
export const MEENA = askDataOf(MEENA_SPEC);
export const PEOPLE = { riya: RIYA, arjun: ARJUN, meena: MEENA } as const;
export type PersonId = keyof typeof PEOPLE;
