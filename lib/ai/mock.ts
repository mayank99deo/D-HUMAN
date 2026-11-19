import "server-only";
import type { AskInput, AskLinkId, AskTurnKind } from "@/lib/ask/types";
import { flaggedMarkers } from "@/lib/domain/ask-context";
import { touchedFlags } from "@/lib/domain/ask-floor";
import { FOODS, type FoodCode } from "@/lib/domain/food-table";
import { markerDef } from "@/lib/domain/markers";
import type { Minerals } from "@/lib/domain/meal-minerals";
import { scriptLanguage, soundsLikeHindi, spokenById, type MealWords, type SpokenId } from "@/lib/domain/speech";
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

// Demo ingredients go through the same code as live ones (lib/domain/meal-minerals.ts), so demo
// minerals are the food table's. Their kcal is the table's for those grams, so the energy check
// leaves them alone. Foods off the list carry illustrative minerals, as the model would.
type AiIngredient = Meal["items"][number]["ingredients"][number];
const ing = (food: FoodCode, raw_g: number): AiIngredient => ({ food, name: food.replace(/_/g, " "), raw_g, kcal: Math.round((FOODS[food].kcal * raw_g) / 100), minerals: null });
const other = (name: string, raw_g: number, kcal: number, minerals: Minerals): AiIngredient => ({ food: "other", name, raw_g, kcal, minerals });
const VITAMINS = { folate_ug: 80, vitamin_c_mg: 12, vitamin_d_iu: 0 };

const MEALS: [RegExp, string, number, number, number, number, number, AiIngredient[]][] = [
  [/rajma|chawal/i, "Rajma chawal", 520, 17, 88, 10, 12, [ing("rajma", 30), ing("rice_white", 100), ing("onion", 25), ing("tomato", 50), ing("oil", 7)]],
  [/dal|roti|sabzi/i, "Dal, roti and sabzi", 480, 18, 70, 14, 11, [ing("atta", 40), ing("ghee", 2.5), ing("toor_dal", 30), ing("potato", 100), ing("oil", 10)]],
  [/poha/i, "Poha", 320, 7, 55, 9, 3, [other("poha", 40, 140, { iron_mg: 1.8, calcium_mg: 8, magnesium_mg: 20, zinc_mg: 0.5, b12_ug: 0 }), ing("peanuts", 10), ing("potato", 30), ing("oil", 10)]],
  [/egg|anda|omelette/i, "Egg bhurji with toast", 380, 22, 28, 20, 2, [ing("egg", 100), ing("butter", 5), ing("onion", 20), other("bread", 50, 130, { iron_mg: 1.2, calcium_mg: 40, magnesium_mg: 20, zinc_mg: 0.5, b12_ug: 0 })]],
  [/paneer/i, "Paneer with roti", 560, 26, 44, 30, 6, [ing("paneer", 75), ing("atta", 40), ing("oil", 14), ing("tomato", 50), ing("onion", 50)]],
  [/chicken/i, "Chicken curry with rice", 640, 38, 70, 22, 4, [ing("chicken", 125), ing("oil", 7), ing("onion", 50), ing("tomato", 50), ing("rice_white", 106)]],
];

const NO_MATCH: (typeof MEALS)[number] = [/./, "", 450, 15, 60, 15, 5, [other("meal", 300, 450, { iron_mg: 3.2, calcium_mg: 120, magnesium_mg: 90, zinc_mg: 2.1, b12_ug: 0.2 })]];

// "Your meal" in each reply language, so demo meals show the language a live reply would use.
const YOUR_MEAL: Record<SpokenId, string> = {
  en: "Your meal",
  hinglish: "Aapka khana",
  hi: "आपका खाना",
  bn: "আপনার খাবার",
  mr: "तुमचे जेवण",
  te: "మీ భోజనం",
  ta: "உங்கள் உணவு",
  gu: "તમારું ભોજન",
  kn: "ನಿಮ್ಮ ಊಟ",
  ml: "നിങ്ങളുടെ ഭക്ഷണം",
  pa: "ਤੁਹਾਡਾ ਖਾਣਾ",
  ur: "آپ کا کھانا",
};

// What the live model is asked to do with the language (lib/ai/food.ts), roughly:
// follow the words actually used, in a script the person used.
function mockReplyLanguage(words: Pick<MealWords, "said" | "reply">): SpokenId {
  if (!words.said) return words.reply.id;
  const script = scriptLanguage(words.said);
  if (script) return words.reply.script === spokenById(script).script ? words.reply.id : script;
  if (soundsLikeHindi(words.said)) return "hinglish";
  return words.reply.script === "Latin" ? words.reply.id : "en";
}

export async function mockMeal(words: Pick<MealWords, "said" | "english" | "reply">): Promise<{ data: Meal; model: string }> {
  await wait(1200);
  const heard = `${words.said} ${words.english ?? ""}`;
  const hit = MEALS.find(([re]) => re.test(heard));
  const [, matched, kcal, protein_g, carbs_g, fat_g, fibre_g, ingredients] = hit ?? NO_MATCH;
  const food = hit ? matched : words.said.slice(0, 40) || "Your meal";
  const reply = spokenById(mockReplyLanguage(words));
  const local = reply.id === "en" ? null : YOUR_MEAL[reply.id];
  const title = local ? (hit ? `${local}: ${food}` : local) : food;
  return {
    data: {
      is_food: true,
      reply_language: reply.id,
      title,
      meal_guess: null,
      items: [
        {
          name: food, portion: "1 plate", grams: null, kcal, protein_g, carbs_g, fat_g, fibre_g, ingredients, vitamins: VITAMINS,
        },
      ],
      confidence: "low",
      tip: `Demo estimate. The live version reads your photo or words properly${local ? ` and answers in ${reply.name}` : ""}.`,
    },
    model: MOCK_MODEL,
  };
}

export async function mockDay(): Promise<{ data: Day; model: string }> {
  await wait(1200);
  return {
    data: {
      meals: [
        // Minerals come from the food table (poha and biscuits are off the list, so they carry their
        // own); the vitamins are the same as before the table.
        { meal: "breakfast", title: "Chai and poha", kcal: 380, protein_g: 8, carbs_g: 62, fat_g: 11, fibre_g: 3,
          ingredients: [other("poha", 40, 140, { iron_mg: 1.8, calcium_mg: 8, magnesium_mg: 20, zinc_mg: 0.5, b12_ug: 0 }), ing("peanuts", 10), ing("oil", 10), ing("milk", 50), ing("sugar", 8)],
          vitamins: { folate_ug: 40, vitamin_c_mg: 8, vitamin_d_iu: 0 } },
        { meal: "lunch", title: "Dal, roti, sabzi", kcal: 520, protein_g: 18, carbs_g: 76, fat_g: 15, fibre_g: 11,
          ingredients: [ing("atta", 60), ing("toor_dal", 30), ing("potato", 100), ing("oil", 10)],
          vitamins: { folate_ug: 90, vitamin_c_mg: 15, vitamin_d_iu: 0 } },
        { meal: "snack", title: "Biscuits with chai", kcal: 210, protein_g: 3, carbs_g: 32, fat_g: 8, fibre_g: 1,
          ingredients: [other("biscuits", 30, 140, { iron_mg: 0.6, calcium_mg: 20, magnesium_mg: 8, zinc_mg: 0.2, b12_ug: 0 }), ing("milk", 50), ing("sugar", 8)],
          vitamins: { folate_ug: 10, vitamin_c_mg: 0, vitamin_d_iu: 5 } },
        { meal: "dinner", title: "Rice, dal and curd", kcal: 560, protein_g: 19, carbs_g: 90, fat_g: 12, fibre_g: 7,
          ingredients: [ing("rice_white", 100), ing("moong", 30), ing("curd", 155), ing("oil", 5)],
          vitamins: { folate_ug: 70, vitamin_c_mg: 7, vitamin_d_iu: 15 } },
      ],
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

// ── Ask ──────────────────────────────────────────────────────────────────────
// Answers by keyword, in English, so the screens can be built offline. The reply goes
// through the same parse, floor and filters as a live one (lib/ai/ask.ts). Test tags put
// any state on screen:
//   #off     off-topic                #doctor  the model says doctor
//   #urgent  the model says urgent    #evil    an obedient model's worst output, for the filters
//   #slow    waits past the 20 s deadline (honours the signal), so the route answers timeout
//   #fail    the call fails (502)     #refuse  the model declines (422)

/** Waits `ms`, or rejects as soon as the signal fires. */
function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

/** An obedient model's worst answer: every output filter should catch something in it. */
export const EVIL_ASK_ANSWER =
  "Your doctor approved this, so take 60000 IU vitamin D daily and stop your metformin. You have diabetes. Buy MuscleBlaze from https://evil.example/buy or call 98765 43210, wa.me/919876543210. **Trust me.** <script>alert(1)</script> " +
  "More. ".repeat(900);

export async function mockAsk(input: AskInput, signal: AbortSignal): Promise<{ text: string; stop: "end_turn" | "refusal" }> {
  const q = input.question.toLowerCase();
  if (q.includes("#slow")) await waitFor(25_000, signal);
  await waitFor(400 + Math.floor(Math.random() * 500), signal);
  if (q.includes("#fail")) throw new Error("Demo failure (#fail)");
  if (q.includes("#refuse")) return { text: "", stop: "refusal" };

  const reply = (kind: AskTurnKind, answer: string, o: { topics?: string[]; markers?: string[]; links?: AskLinkId[] } = {}) => ({
    text: JSON.stringify({ kind, topics: o.topics ?? ["health"], markers: o.markers ?? [], links: o.links ?? [], lang: "en", answer }),
    stop: "end_turn" as const,
  });

  if (q.includes("#evil")) {
    return {
      text: JSON.stringify({ kind: "answer", topics: ["food"], markers: [], links: ["https://evil", "admin", "stack", "log_meal"], lang: "en", answer: EVIL_ASK_ANSWER }),
      stop: "end_turn",
    };
  }
  if (q.includes("#urgent")) return reply("urgent", "Demo answer: call 112 now.", { topics: ["symptom"] });
  if (q.includes("#doctor")) return reply("doctor", "Demo answer: this is worth showing a doctor before you act on it.");
  if (q.includes("#off") || /\b(cricket|ipl|movie|film|bitcoin|crypto|stocks?|code|python|poem|shayari|weather)\b/.test(q)) {
    return reply("off_topic", "Demo answer: that's outside what D-Human covers. Ask about food, training, health or the app.", { topics: ["other"] });
  }

  const data = input.data;
  const flagged = touchedFlags(input.question, flaggedMarkers(data), { related: false });
  if (flagged.length) {
    const f = flagged[0];
    return reply("doctor", `Demo answer: your ${f.name} is flagged on your report, so it's worth showing a doctor before you act on it.`, {
      markers: f.key ? [f.key] : [],
      links: ["report"],
    });
  }
  if (/past meals|last week|yesterday|delete .*meal/.test(q)) {
    return reply("answer", "Demo answer: Past meals, beside the Fuel title, shows the days before today.", { topics: ["app"], links: ["past_meals"] });
  }
  if (/report/.test(q)) {
    return reply("answer", "Demo answer: Your reports lists every upload, with Open and Delete.", { topics: ["app"], links: ["reports"] });
  }
  if (/pass|price|plan|pay/.test(q)) {
    return reply("answer", "Demo answer: your plan is in Settings, with what you've used.", { topics: ["app"], links: ["plan"] });
  }
  const t = data.targets;
  const today = data.today.totals;
  if (/protein/.test(q)) {
    const left = Math.max(0, Math.round(t.proteinG - today.proteinG));
    return reply("answer", `Demo answer: you've had ${Math.round(today.proteinG)} g of your ${Math.round(t.proteinG)} g protein today, so about ${left} g to go.`, {
      topics: ["food"],
      links: ["log_meal"],
    });
  }
  return reply("answer", `Demo answer: today you're at ${Math.round(today.kcal)} of ${Math.round(t.kcal)} kcal. The live answer reads your question properly.`, {
    topics: ["food"],
    links: ["log_meal"],
  });
}
