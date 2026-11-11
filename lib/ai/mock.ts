import "server-only";
import { markerDef } from "@/lib/domain/markers";
import type { Day, Extracted, Meal, Read, StackPlan, WrapStory } from "./schemas";
import type { ReadInput } from "./report";
import type { FoundEvent } from "./events";

// Local-only stand-ins for Claude (D_HUMAN_AI_MOCK=1 with no API key), so every
// screen can be built and tested without spending anything. Everything they
// return is illustrative and saved with model "mock", which the UI labels.

export const MOCK_MODEL = "mock";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEMO_MARKERS: Extracted["markers"] = [
  ["Haemoglobin", "hemoglobin", "Haematology", 13.4, "g/dL", 13, 17],
  ["Serum Ferritin", "ferritin", "Iron studies", 24, "ng/mL", 30, 400],
  ["Transferrin Saturation", "transferrin_sat", "Iron studies", 19, "%", 20, 50],
  ["25-OH Vitamin D (Total)", "vitamin_d", "Vitamins", 17.8, "ng/mL", 30, 100],
  ["Vitamin B12", "b12", "Vitamins", 412, "pg/mL", 211, 911],
  ["TSH (Ultrasensitive)", "tsh", "Thyroid", 2.1, "µIU/mL", 0.35, 5.5],
  ["HbA1c", "hba1c", "Diabetes", 5.4, "%", 4, 5.6],
  ["Fasting Blood Sugar", "glucose_fasting", "Diabetes", 92, "mg/dL", 70, 100],
  ["Total Cholesterol", "total_cholesterol", "Lipid profile", 192, "mg/dL", null, 200],
  ["LDL Cholesterol (Direct)", "ldl", "Lipid profile", 118, "mg/dL", null, 100],
  ["HDL Cholesterol", "hdl", "Lipid profile", 56, "mg/dL", 40, null],
  ["Triglycerides", "triglycerides", "Lipid profile", 96, "mg/dL", null, 150],
  ["SGPT (ALT)", "alt", "Liver function", 28, "U/L", null, 50],
  ["Creatinine", "creatinine", "Kidney function", 1.02, "mg/dL", 0.7, 1.3],
  ["Magnesium", "magnesium", "Electrolytes", 1.9, "mg/dL", 1.7, 2.4],
  ["hs-CRP", "hscrp", "Inflammation", 1.4, "mg/L", null, 3],
].map(([printed_name, key, panel, value, unit, ref_low, ref_high]) => ({
  printed_name: printed_name as string,
  key: key as Extracted["markers"][number]["key"],
  panel: panel as string,
  value: value as number,
  value_text: null,
  unit: unit as string,
  ref_low: ref_low as number | null,
  ref_high: ref_high as number | null,
  ref_text: ref_low != null && ref_high != null ? `${ref_low} - ${ref_high}` : ref_low != null ? `> ${ref_low}` : `< ${ref_high}`,
}));

export async function mockExtract(onFound: (name: string) => void): Promise<{ data: Extracted; model: string }> {
  await wait(1500);
  for (const m of DEMO_MARKERS) {
    onFound(m.printed_name);
    await wait(450);
  }
  return {
    data: {
      is_lab_report: true,
      lab_name: "Demo Diagnostics",
      collected_on: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
      name_on_report: null,
      age_on_report: null,
      sex_on_report: null,
      markers: DEMO_MARKERS,
      reading_notes: null,
    },
    model: MOCK_MODEL,
  };
}

export async function mockRead(input: ReadInput): Promise<{ data: Read; model: string }> {
  await wait(2500);
  const off = input.markers.filter((m) => m.status === "low" || m.status === "high");
  const flagged = input.markers.some((m) => m.flag);
  const target = input.target.kind === "event" ? input.target.name : "your next block";
  const level = flagged ? "doctor_first" : off.length === 0 ? "go" : off.length <= 2 ? "go_with_tweaks" : "build";
  const fixes = off.length === 1 ? "one fix" : `${off.length} fixes`;
  const line =
    level === "go" ? `Ready for ${target}.` : level === "go_with_tweaks" ? `Ready for ${target}, with ${fixes}.` : level === "build" ? `Build first. ${target} can wait a block.` : `See a doctor before ${target}.`;
  return {
    data: {
      headline: off.length ? "Strong engine, low reserves." : "Everything's pulling its weight.",
      verdict: { level, line, detail: off.length ? `${off.map((m) => m.name).join(" and ")} sit outside range. Both are fixable in a training block.` : "Nothing on this report holds you back." },
      summary: `This is a demo read, written without AI. ${input.markers.length} markers came through; ${off.length} sit outside their range.`,
      focus: off.slice(0, 3).map((m) => ({
        marker_key: m.key,
        title: `Lift your ${m.name.toLowerCase()}`,
        why: markerDef(m.key)?.what ?? "It matters for how you train and recover.",
        action: "Demo pointer: the live read gives a food-first step for your kitchen.",
      })),
      markers: input.markers.map((m) => ({
        id: m.id,
        note: markerDef(m.key)?.what ?? "A marker on your report.",
      })),
      wins: input.markers.filter((m) => m.status === "in_range").slice(0, 2).map((m) => `${m.name} is right where it should be.`),
      doctor_questions: flagged ? ["Demo: which of these flagged markers should we look at first?"] : [],
      retest: { weeks: 12, markers: off.map((m) => m.key).filter((k): k is string => !!k), why: "Iron and vitamin D take about three months to move." },
      test_tips: ["Book your next test after a rest day, before 10 a.m., fasting 10–12 hours."],
    },
    model: MOCK_MODEL,
  };
}

export async function mockEvents(what: string, city: string | null): Promise<{ events: FoundEvent[]; model: string }> {
  await wait(800);
  const y = new Date().getFullYear();
  const base = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const kind = what.split(":")[0];
  return {
    events: [
      { name: `Demo ${city ?? "Mumbai"} Open`, kind, starts_on: base(38), ends_on: null, city: city ?? "Mumbai", country: "India", url: null, details: `Illustrative event (${kind}) from demo mode.` },
      { name: `Demo Bengaluru Classic ${y + 1}`, kind, starts_on: base(96), ends_on: null, city: "Bengaluru", country: "India", url: null, details: "Illustrative event from demo mode." },
    ],
    model: MOCK_MODEL,
  };
}

const MEALS: [RegExp, string, number, number, number, number, number][] = [
  [/rajma|chawal/i, "Rajma chawal", 520, 17, 88, 10, 12],
  [/dal|roti|sabzi/i, "Dal, roti and sabzi", 480, 18, 70, 14, 11],
  [/poha/i, "Poha", 320, 7, 55, 9, 3],
  [/egg|anda|omelette/i, "Egg bhurji with toast", 380, 22, 28, 20, 2],
  [/paneer/i, "Paneer with roti", 560, 26, 44, 30, 6],
  [/chicken/i, "Chicken curry with rice", 640, 38, 70, 22, 4],
];

export async function mockMeal(text: string | undefined): Promise<{ data: Meal; model: string }> {
  await wait(1200);
  const hit = MEALS.find(([re]) => re.test(text ?? "")) ?? [/./, text?.slice(0, 40) || "Your meal", 450, 15, 60, 15, 5];
  const [, title, kcal, protein_g, carbs_g, fat_g, fibre_g] = hit;
  return {
    data: {
      is_food: true,
      title: String(title),
      meal_guess: null,
      items: [{ name: String(title), portion: "1 plate", grams: null, kcal, protein_g, carbs_g, fat_g, fibre_g }],
      micros: { iron_mg: 3.2, calcium_mg: 120, magnesium_mg: 90, zinc_mg: 2.1, b12_ug: 0.2, folate_ug: 80, vitamin_c_mg: 12, vitamin_d_iu: 0 },
      confidence: "low",
      tip: "Demo estimate. The live version reads your photo or words properly.",
    },
    model: MOCK_MODEL,
  };
}

export async function mockDay(): Promise<{ data: Day; model: string }> {
  await wait(1200);
  return {
    data: {
      meals: [
        { meal: "breakfast", title: "Chai and poha", kcal: 380, protein_g: 8, carbs_g: 62, fat_g: 11, fibre_g: 3 },
        { meal: "lunch", title: "Dal, roti, sabzi", kcal: 520, protein_g: 18, carbs_g: 76, fat_g: 15, fibre_g: 11 },
        { meal: "snack", title: "Biscuits with chai", kcal: 210, protein_g: 3, carbs_g: 32, fat_g: 8, fibre_g: 1 },
        { meal: "dinner", title: "Rice, dal and curd", kcal: 560, protein_g: 19, carbs_g: 90, fat_g: 12, fibre_g: 7 },
      ],
      micros: { iron_mg: 11, calcium_mg: 520, magnesium_mg: 260, zinc_mg: 7, b12_ug: 0.8, folate_ug: 210, vitamin_c_mg: 30, vitamin_d_iu: 20 },
      patterns: ["Demo: most of your protein comes from dal.", "Demo: chai with meals may cut the iron you absorb."],
    },
    model: MOCK_MODEL,
  };
}

export async function mockWrap(stats: { daysLogged?: number }): Promise<{ data: WrapStory; model: string }> {
  await wait(1200);
  return {
    data: {
      title: "Your demo wrap",
      cards: [
        { kind: "stat", big: String(stats.daysLogged ?? 0), label: "days logged", line: "Every logged day sharpens your read." },
        { kind: "gap", big: "Protein", label: "the gap", line: "Demo card: the live wrap names your real gap." },
        { kind: "next", big: "1 thing", label: "next", line: "Add a protein to breakfast." },
      ],
      one_thing: "Add a protein to breakfast.",
    },
    model: MOCK_MODEL,
  };
}

export async function mockStack(): Promise<{ data: StackPlan; model: string }> {
  await wait(1500);
  return {
    data: {
      items: [
        {
          nutrient: "Vitamin D3",
          why: "Demo: your vitamin D sits below range.",
          markers: ["vitamin_d"],
          diet_gap: null,
          form: "Cholecalciferol, taken with a meal that has some fat",
          dose: "1,000–2,000 IU a day",
          timing: "With lunch",
          duration: "12 weeks, then retest",
          cautions: null,
          brands: [],
        },
      ],
      skip: [{ name: "Multivitamin", why: "Demo: most of your markers are in range; a multi would mostly add what you don't need." }],
      food_first: ["Demo: 15–20 minutes of midday sun on arms and legs, a few days a week."],
      see_doctor: [],
    },
    model: MOCK_MODEL,
  };
}
