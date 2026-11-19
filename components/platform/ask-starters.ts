// Ask's starters: fixed questions picked by code for the screen someone is on, in their
// read language (UX spec §5). Never written by AI, and nothing is spent until they send.
// Also the prefills behind "Ask about this", which fill the box and never send.
// Pure, so every pick can be tested without a browser.
// The Hindi and Hinglish lines wait on the native-speaker check (an open item).
import type { AskAboutRequest, AskReadLanguage, AskStarterFacts, AskThread } from "@/lib/ask/types";
import type { MarkerStatus } from "@/lib/domain/markers";

type Words = Record<AskReadLanguage, string>;

export const STARTERS = {
  matters: {
    en: "What matters most in my report for how I train?",
    hinglish: "Meri training ke hisaab se report mein sabse zaroori kya hai?",
    hi: "मेरी ट्रेनिंग के हिसाब से रिपोर्ट में सबसे ज़रूरी क्या है?",
  },
  eat_for: { en: "What should I eat for my {marker}?", hinglish: "Mere {marker} ke liye kya khaun?", hi: "मेरे {marker} के लिए क्या खाऊँ?" },
  ask_doctor: {
    en: "What should I ask a doctor about my {marker}?",
    hinglish: "Doctor se mere {marker} ke baare mein kya poochhun?",
    hi: "डॉक्टर से मेरे {marker} के बारे में क्या पूछूँ?",
  },
  marker_mean: {
    en: "What does my {marker} result mean for how I train?",
    hinglish: "Mera {marker} result meri training ke liye kya batata hai?",
    hi: "मेरा {marker} रिज़ल्ट मेरी ट्रेनिंग के लिए क्या बताता है?",
  },
  retest: { en: "When should I test again, and for what?", hinglish: "Dobara test kab karaun, aur kaun se?", hi: "दोबारा टेस्ट कब कराऊँ, और कौन-से?" },
  report_shows: {
    en: "What does a blood report show that food can't?",
    hinglish: "Blood report mein aisa kya dikhta hai jo khane se pata nahi chalta?",
    hi: "ब्लड रिपोर्ट में ऐसा क्या दिखता है जो खाने से पता नहीं चलता?",
  },
  how_upload: { en: "How do I upload my blood report?", hinglish: "Apni blood report kaise upload karun?", hi: "अपनी ब्लड रिपोर्ट कैसे अपलोड करूँ?" },
  protein_left: { en: "How do I get {g} g more protein today?", hinglish: "Aaj {g} g protein aur kaise lun?", hi: "आज {g} ग्राम प्रोटीन और कैसे लूँ?" },
  next_meal: {
    en: "What should my next meal be, after what I ate today?",
    hinglish: "Aaj jo khaya uske baad agla meal kya ho?",
    hi: "आज जो खाया, उसके बाद अगला खाना क्या हो?",
  },
  gaps: { en: "Which foods close my biggest gaps?", hinglish: "Meri sabse badi kami kin cheezon se poori hogi?", hi: "मेरी सबसे बड़ी कमी किन चीज़ों से पूरी होगी?" },
  how_counted: { en: "How does D-Human count my meals?", hinglish: "D-Human mera khana kaise count karta hai?", hi: "D-Human मेरा खाना कैसे गिनता है?" },
  meal_better: {
    en: "How could this meal fit my goals better?",
    hinglish: "Yeh meal mere goals ke liye aur behtar kaise ho?",
    hi: "यह खाना मेरे लक्ष्य के लिए और बेहतर कैसे हो?",
  },
  why_item: { en: "Why is {nutrient} in my stack?", hinglish: "{nutrient} mere stack mein kyun hai?", hi: "{nutrient} मेरे स्टैक में क्यों है?" },
  food_for: { en: "Which foods give me {nutrient}?", hinglish: "{nutrient} kin cheezon mein milta hai?", hi: "{nutrient} किन चीज़ों में मिलता है?" },
  how_built: { en: "How is my stack worked out?", hinglish: "Mera stack kaise banta hai?", hi: "मेरा स्टैक कैसे बनता है?" },
  which_reports: { en: "Which reports can I upload?", hinglish: "Kaun si reports upload ho sakti hain?", hi: "कौन-सी रिपोर्ट अपलोड हो सकती हैं?" },
  who_sees: { en: "Who can see my report?", hinglish: "Meri report kaun dekh sakta hai?", hi: "मेरी रिपोर्ट कौन देख सकता है?" },
  pass: { en: "What does the ₹49 pass include?", hinglish: "₹49 pass mein kya milta hai?", hi: "₹49 पास में क्या मिलता है?" },
  language: { en: "How do I change the language of my reads?", hinglish: "Reads ki language kaise badlun?", hi: "रीड की भाषा कैसे बदलूँ?" },
  delete_report: { en: "How do I delete a report?", hinglish: "Report kaise delete karun?", hi: "रिपोर्ट कैसे डिलीट करूँ?" },
  one_change: {
    en: "What one change would help my week most?",
    hinglish: "Is hafte ke liye sabse kaam ka ek badlav kya hai?",
    hi: "इस हफ़्ते के लिए सबसे काम का एक बदलाव क्या है?",
  },
} as const satisfies Record<string, Words>;

export type StarterId = keyof typeof STARTERS;

/** One per persona archetype (lib/domain/options.ts ACTIVITIES); "starting" for anything else. */
export const PERSONA_STARTERS: Record<string, Words> = {
  running: { en: "What should I eat before a morning run?", hinglish: "Subah ki run se pehle kya khaun?", hi: "सुबह की दौड़ से पहले क्या खाऊँ?" },
  hyrox: { en: "How should I eat on a HYROX race day?", hinglish: "HYROX race wale din kya khaun?", hi: "HYROX रेस वाले दिन क्या खाऊँ?" },
  strength: { en: "What should I eat after a lifting session?", hinglish: "Weights ke baad kya khaun?", hi: "वेट ट्रेनिंग के बाद क्या खाऊँ?" },
  trekking: { en: "What should I eat on a long trek day?", hinglish: "Lambe trek wale din kya khaun?", hi: "लंबे ट्रेक वाले दिन क्या खाऊँ?" },
  cycling: { en: "What should I eat on a long ride?", hinglish: "Lambi ride par kya khaun?", hi: "लंबी राइड पर क्या खाऊँ?" },
  swimming: { en: "What should I eat before an early swim?", hinglish: "Subah swimming se pehle kya khaun?", hi: "सुबह तैराकी से पहले क्या खाऊँ?" },
  yoga: { en: "What should I eat before morning yoga?", hinglish: "Subah yoga se pehle kya khaun?", hi: "सुबह योग से पहले क्या खाऊँ?" },
  team: { en: "What should I eat on a match day?", hinglish: "Match wale din kya khaun?", hi: "मैच वाले दिन क्या खाऊँ?" },
  walking: { en: "How can I get more from my daily walk?", hinglish: "Roz ki walk se zyada fayda kaise lun?", hi: "रोज़ की सैर से ज़्यादा फ़ायदा कैसे लूँ?" },
  starting: { en: "Where do I start with exercise?", hinglish: "Exercise kahan se shuru karun?", hi: "एक्सरसाइज़ कहाँ से शुरू करूँ?" },
};

/** A starter and what fills its slot: a marker or nutrient name (English, from the catalogue or the card), or grams. */
export type StarterRef = { id: StarterId; slot?: string };
export type Starter = { key: string; text: string };

export const isReadLanguage = (x: unknown): x is AskReadLanguage => x === "en" || x === "hi" || x === "hinglish";

export function starterText(ref: StarterRef, lang: AskReadLanguage) {
  const words = STARTERS[ref.id][isReadLanguage(lang) ? lang : "en"];
  return words.replace(/\{(?:marker|nutrient|g)\}/g, ref.slot ?? "");
}

export function personaStarter(archetype: string, lang: AskReadLanguage): Starter {
  const words = PERSONA_STARTERS[archetype] ?? PERSONA_STARTERS.starting;
  return { key: `persona:${archetype in PERSONA_STARTERS ? archetype : "starting"}`, text: words[isReadLanguage(lang) ? lang : "en"] };
}

export type AskScreen = "home" | "report" | "fuel" | "stack" | "upload" | "settings" | "wraps" | "other";

export function screenOf(path: string): AskScreen {
  const p = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (p === "/home" || p === "/reports") return "home";
  if (p.startsWith("/reports/")) return "report";
  if (p === "/fuel" || p.startsWith("/fuel/")) return "fuel";
  if (p === "/stack") return "stack";
  if (p === "/upload") return "upload";
  if (p === "/settings") return "settings";
  if (p === "/wraps" || p.startsWith("/wraps/")) return "wraps";
  return "other";
}

type Pick = { path: string; facts: AskStarterFacts; report: AskThread["report"]; urgent: boolean; lang: AskReadLanguage };

// Under an urgent hold Ask answers only app and meal-logging questions (contract §6.2 row 7),
// so only app starters show, led by the screen's own.
const APP_ONLY: readonly StarterId[] = ["how_counted", "which_reports", "delete_report", "who_sees", "language", "pass"];
const APP_LEAD: Partial<Record<AskScreen, StarterId[]>> = {
  fuel: ["how_counted"],
  upload: ["which_reports", "who_sees"],
  settings: ["pass", "language", "delete_report"],
};

/** Whether a ready report stands behind the answers. "reading" can sit on top of an older one. */
const hasReport = (report: AskThread["report"], facts: AskStarterFacts) => report === "ready" || facts.flagged != null || facts.foodMarker != null;

function homeList({ facts, report }: Pick): (StarterRef | null)[] {
  if (!hasReport(report, facts)) return [{ id: "report_shows" }, { id: "how_upload" }];
  // A flagged marker never gets a food question; it gets a doctor question.
  const lead: StarterRef | null = facts.flagged
    ? { id: "ask_doctor", slot: facts.flagged.name }
    : facts.foodMarker
      ? { id: "eat_for", slot: facts.foodMarker.name }
      : null;
  return [lead, { id: "matters" }, { id: "retest" }];
}

function screenList(screen: AskScreen, p: Pick): (StarterRef | null)[] {
  const f = p.facts;
  switch (screen) {
    case "fuel":
      return [
        f.proteinLeftG != null && f.proteinLeftG >= 10 ? { id: "protein_left", slot: String(f.proteinLeftG) } : !f.mealsEver ? { id: "how_counted" } : null,
        f.mealsToday >= 1 ? { id: "next_meal" } : f.hasGaps ? { id: "gaps" } : null,
      ];
    case "stack":
      return f.stackItem ? [{ id: "why_item", slot: f.stackItem }, { id: "food_for", slot: f.stackItem }] : [{ id: "how_built" }];
    case "upload":
      return [{ id: "which_reports" }, { id: "who_sees" }];
    case "settings":
      return [{ id: "pass" }, { id: "language" }, { id: "delete_report" }];
    case "wraps":
      return [{ id: "one_change" }, ...homeList(p)];
    default:
      return homeList(p);
  }
}

/**
 * Three starters for the empty sheet: the first two that apply on this screen (topped up
 * from the Home list when a screen has fewer), then the persona's. Under an urgent hold,
 * three app questions instead, and no food starter at all.
 */
export function pickStarters(p: Pick): Starter[] {
  const screen = screenOf(p.path);
  if (p.urgent) {
    const ids = [...new Set([...(APP_LEAD[screen] ?? []), ...APP_ONLY])].slice(0, 3);
    return ids.map((id) => ({ key: id, text: starterText({ id }, p.lang) }));
  }
  const refs: StarterRef[] = [];
  for (const ref of [...screenList(screen, p), ...homeList(p)]) {
    if (ref && !refs.some((r) => r.id === ref.id)) refs.push(ref);
    if (refs.length === 2) break;
  }
  return [...refs.map((r) => ({ key: r.id, text: starterText(r, p.lang) })), personaStarter(p.facts.archetype, p.lang)];
}

// ── "Ask about this": prefills that never send ─────────────────────────────

/** The "About" chip over the box: what the person tapped, by name, with a marker's status glyph. */
export type AboutChip = { request: AskAboutRequest; name: string; status: MarkerStatus | null };
export type Prefill = { about: AboutChip; starter: StarterRef };

const LINKED_STATUSES: readonly string[] = ["low", "high", "edge_low", "edge_high"];

/** Markers that get an "Ask about this" link: out of range, at the edge, or flagged. In-range ones stay calm. */
export const askAboutMarker = (m: { status: string; flag: string | null }) => !!m.flag || LINKED_STATUSES.includes(m.status);

export function markerPrefill(m: { id: string; name: string; status: MarkerStatus; flag: string | null }): Prefill {
  return {
    about: { request: { type: "marker", id: m.id }, name: m.name, status: m.status },
    starter: { id: m.flag ? "ask_doctor" : "marker_mean", slot: m.name },
  };
}

export const stackItemPrefill = (nutrient: string): Prefill => ({
  about: { request: { type: "stack_item", nutrient }, name: nutrient, status: null },
  starter: { id: "why_item", slot: nutrient },
});

export const mealPrefill = (meal: { id: string; title: string }): Prefill => ({
  about: { request: { type: "meal", id: meal.id }, name: meal.title, status: null },
  starter: { id: "meal_better" },
});

export const gapsPrefill = (chip: string): Prefill => ({ about: { request: { type: "gaps" }, name: chip, status: null }, starter: { id: "gaps" } });
