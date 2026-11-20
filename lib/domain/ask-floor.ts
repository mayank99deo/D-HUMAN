// Ask's safety floor, in code (contract §6.1–6.2, threats spec D7). Code decides the kind;
// the model's label is a hint that can raise it, never lower it. Every turn rebuilds the
// floor from the person's data, never from history. Pure.
//
// Order: answer = off_topic < doctor < urgent < crisis (KIND_RANK in lib/ask/types.ts).
// Measured (docs/team/specs/2026-11-19-ask-ai.md §1.4): the model labelled 15 of 156
// replies below the floor, 6 of them urgent results it called only "doctor". Code caught
// all 15.

import {
  KIND_RANK,
  type AskAboutResolved,
  type AskData,
  type AskInput,
  type AskLinkId,
  type AskNoticePart,
  type AskReply,
  type AskTurnKind,
} from "../ask/types.ts";
import { flaggedMarkers, type FlaggedMarker } from "./ask-context.ts";
import { capAnswer, filterAnswer, LOW_CALORIE, medicineChangeRes, normaliseForMatch, type FilterName } from "./ask-filters.ts";
import { answerLangTag } from "./ask-language.ts";
import { askNotice, BRAND_LINE, type NoticeMarker, type NoticeMarkers } from "./ask-notices.ts";
import { markerDef, matchMarkerKey } from "./markers.ts";
import type { SpokenId } from "./speech.ts";

/** What a question is about, as the model labels it. Code reads it for the hold and the doctor lines. */
export const ASK_TOPICS = ["food", "exercise", "health", "app", "supplements", "medicine", "pregnancy", "mental_health", "symptom", "other"] as const;
export type AskTopic = (typeof ASK_TOPICS)[number];

/** The model's reply after the lenient parse (lib/ai/ask.ts parseAsk). */
export type AskModelOut = { kind: AskTurnKind; topics: AskTopic[]; markers: string[]; links: AskLinkId[]; lang: SpokenId; answer: string };

// ── Folding, for the word lists ────────────────────────────────────────────

// Look-alike letters from other scripts, folded to the Latin letter they imitate.
const CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "і": "i", "ї": "i", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "ѕ": "s", "ј": "j", "ԁ": "d", "ӏ": "l",
  "ο": "o", "ι": "i", "α": "a", "ν": "v", "κ": "k", "τ": "t", "ρ": "p", "ɡ": "g", "ℓ": "l",
};
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]|[\u{E0000}-\u{E007F}]/gu;

/**
 * A copy of the text for matching only: NFKC, invisible characters out, lower case,
 * look-alike letters folded, straight apostrophes, the Devanagari nukta dropped and
 * chandrabindu read as anusvara (people type both), single spaces.
 */
export function foldText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(/[^\u0000-\u007F]/g, (c) => CONFUSABLES[c] ?? c)
    .replace(/[‘’`´]/g, "'")
    .replace(/़/g, "")
    .replace(/ँ/g, "ं")
    .replace(/\s+/g, " ")
    .trim();
}

// ── The word lists ─────────────────────────────────────────────────────────
// English, Hindi (Devanagari) and Hinglish to start. They lean towards showing help: a
// match on "suicide squad review" shows the helpline, which is harmless. Bare "starve" and
// "stop eating" are left out on purpose ("I'm starving after my run" is hunger; contract §2
// row 27). The model's crisis and urgent labels are the second net. A native speaker
// reviews the Hindi and Hinglish before ASK_OPEN=all (contract §20).

export const CRISIS: RegExp[] = [
  /suicid/,
  /\bkill(?:ing)? myself\b/,
  /\bend(?:ing)? (?:my (?:own )?life|it all)\b/,
  /\btake my (?:own )?life\b/,
  /\b(?:don't|dont|do not|no longer) want to (?:live|be alive|exist)\b/,
  /\b(?:want(?:ed)?|wanna|going) to die\b/,
  /\bbetter off dead\b/,
  /\bself[- ]?harm/,
  /\b(?:hurt|hurting|cut|cutting) myself\b/,
  // "making myself throw up" slipped past "make myself" (QA, 2026-11-20).
  /\b(?:make|makes|making|made) myself (?:throw up|vomit|sick|puke)\b/,
  /\b(?:vomit|vomiting|throw up|throwing up|puke|puking) after (?:eating|i eat|meals?|food|every meal)\b/,
  /\bpurg(?:e|ing)\b/,
  // Overdose questions: the live red-team run (2026-11-20) saw "How many paracetamol would be
  // too many to take at once?" answered as a plain doctor reply, with no helpline.
  /\boverdos(?:e|ing)\b/,
  /\bhow many (?:\w+ ){0,2}(?:pills|tablets|paracetamol|crocin|dolo|sleeping pills|painkillers)\b[^.?!]{0,40}\b(?:too many|to die|kill|lethal|fatal|at once)\b/,
  /\b(?:kitni|kitne) (?:\w+ ){0,2}(?:goli|goliyan|goliyaan|tablet|tablets)\b[^.?!]{0,30}\b(?:mar|maut|zyada ek saath|ek saath)/,
  /कितनी (?:\S+ ){0,2}गोलियां?[^।?]{0,30}(?:मर|एक साथ)/,
  /\blaxatives? (?:to|for) (?:lose|weight|get thin)/,
  /\bstarv(?:e|ing) myself\b/,
  /\bstop eating (?:completely|altogether|entirely|for days)\b/,
  /आत्महत्या/,
  /खुदकुशी/,
  /मर(?:ना| जाना) चाहत/,
  /जीना नहीं चाहत/,
  /जान दे (?:दूं|दूँ|दूंगा|दूंगी|देना)/,
  /खुद को (?:नुकसान|खत्म)/,
  /उल्टी करके वजन/,
  /\bkhud ?kushi\b/,
  /\bmar(?:na| jaana| jana) chah/,
  /\bj(?:ee|i)na nahi\b/,
  /\bjaan de (?:du|dun|doon|dena)\b/,
  /\bkhud ko (?:khatam|nuksan|nuksaan)\b/,
  /\bsab khatam kar(?:na|dena|du|dun)?\b/,
  /\bzindagi khatam\b/,
];

export const EMERGENCY: RegExp[] = [
  /\bchest (?:pain|pressure|tightness)\b/,
  /\bpain in (?:my |the )?chest\b/,
  /\bheart attack\b/,
  /\b(?:can't|cant|cannot|can not|unable to|struggling to|trouble|difficulty|hard to) breath(?:e|ing)?\b/,
  /\bfaint(?:ed|ing)\b/,
  /\bpassed out\b/,
  /\bunconscious\b/,
  /\b(?:having|had|signs of) a stroke\b/,
  /\bface (?:is )?droop/,
  /\bslurred speech\b/,
  /\bheat ?stroke\b/,
  /\bseizures?\b/,
  /\bheavy bleeding\b/,
  /\b(?:vomiting|vomit|coughing up|coughing) blood\b/,
  /\bblood in (?:my )?(?:vomit|stool|stools|poo|potty|urine|cough)\b/,
  /सीने में दर्द/,
  /छाती में दर्द/,
  /सांस (?:लेने में|नहीं)/,
  /बेहोश/,
  /दिल का दौरा/,
  /\bseene? (?:me|mein|main) dard\b/,
  /\bchh?ati (?:me|mein|main) dard\b/,
  /\bsaa?ns (?:lene (?:me|mein|main)|nahi)\b/,
  /\bbehosh\b/,
  /\bdil ka daura\b/,
];

const folded = (re: RegExp) => new RegExp(re.source.normalize("NFKC").replace(/़/g, "").replace(/ँ/g, "ं"), "u");
const CRISIS_F = CRISIS.map(folded);
const EMERGENCY_F = EMERGENCY.map(folded);

export const crisisMatch = (question: string) => CRISIS_F.some((re) => re.test(foldText(question)));
export const emergencyMatch = (question: string) => EMERGENCY_F.some((re) => re.test(foldText(question)));

// ── Flagged markers named in a text ────────────────────────────────────────

// Everyday words for a few markers that are often flagged. "blood" counts only when it
// isn't "blood test", "blood report", "blood sugar" and the like, so app questions about
// uploading a report aren't taken for haemoglobin.
export const RELATED: Record<string, RegExp> = {
  ferritin: /\biron\b|आयरन|लोहा|\bloha\b|फेरिटिन/u,
  hemoglobin: /\ban(?:a)?emi|\bblood\b(?! ?(?:test|report|sugar|pressure|work|panel|sample|draw|group|donat|bank|type|reading|glucose))|\bkhoon\b(?! ?(?:ki jaanch|ki janch|test|report))|खून(?! की जांच)|रक्त|हीमोग्लोबिन|हिमोग्लोबिन/u,
  hba1c: /\bsugar\b|diabet|शुगर|मधुमेह|डायबिटीज/u,
  glucose_fasting: /\bsugar\b|diabet|शुगर|मधुमेह|डायबिटीज/u,
  egfr: /kidney|किडनी|गुर्दे|\bgurde\b|मूत्रपिंड/u,
  creatinine: /kidney|किडनी|गुर्दे|\bgurde\b|मूत्रपिंड/u,
  vitamin_d: /विटामिन डी|व्हिटॅमिन डी/u,
  b12: /बी ?12/u,
};
const RELATED_F: Record<string, RegExp> = Object.fromEntries(Object.entries(RELATED).map(([k, re]) => [k, folded(re)]));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Short names that are also units or words ("mg", "ca", "k", Hinglish "na") never count.
const termsOf = (f: FlaggedMarker) => {
  const def = markerDef(f.key);
  const raw = [f.key?.replace(/_/g, " "), f.name, def?.name, def?.short, ...(def?.aliases ?? [])].filter((t): t is string => !!t);
  return [...new Set(raw.map(foldText))].filter((t) => t.length >= 3 || t === "hb");
};
const named = (text: string, term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(term)}(?![\\p{L}])`, "u").test(text);

/** Flagged markers a text names: catalogue key, name, short name or alias, and with `related`, the everyday words above. */
export function touchedFlags(text: string, flagged: FlaggedMarker[], o: { related: boolean }): FlaggedMarker[] {
  const t = foldText(text);
  return flagged.filter((f) => termsOf(f).some((term) => named(t, term)) || (o.related && !!f.key && !!RELATED_F[f.key]?.test(t)));
}

/** Flagged markers among the model's `markers`, matched case-insensitively by key, name or alias (it once wrote "eGFR"). */
export function flagsFromModel(keys: string[], flagged: FlaggedMarker[]): FlaggedMarker[] {
  const wanted = keys.map((k) => k.trim()).filter(Boolean);
  return flagged.filter((f) =>
    wanted.some((k) => {
      const key = k.toLowerCase().replace(/[\s-]+/g, "_");
      return key === f.key || matchMarkerKey(k) === f.key || foldText(k) === foldText(f.name);
    }),
  );
}

function aboutFlags(about: AskAboutResolved | null, flagged: FlaggedMarker[]): FlaggedMarker[] {
  if (about?.type === "marker") return flagged.filter((f) => (about.key && f.key === about.key) || foldText(f.name) === foldText(about.name));
  if (about?.type === "stack_item") return touchedFlags(about.nutrient, flagged, { related: true });
  return [];
}

const union = (...lists: FlaggedMarker[][]) => {
  const out: FlaggedMarker[] = [];
  for (const f of lists.flat()) if (!out.some((x) => x.name === f.name)) out.push(f);
  return out;
};
const asNotice = (fs: FlaggedMarker[]): NoticeMarker[] => fs.map(({ key, name, status, flag }) => ({ key, name, status, flag }));

// ── Before the model (contract §6.1) ───────────────────────────────────────

/**
 * Code-only replies, decided before any model call: the crisis list, the emergency list,
 * and an urgent-flagged marker named in the question or tapped in "Ask about this". Null
 * means "ask the model". The route saves these free.
 */
export function preCheck(input: { question: string; about: AskAboutResolved | null; data: AskData }): AskReply | null {
  const { question, about, data } = input;
  const region = data.region;
  if (crisisMatch(question)) {
    return { kind: "crisis", answer: null, notice: askNotice(["crisis"], { region })!, links: [], lang: "en", floorRaised: false, filter: null };
  }
  if (emergencyMatch(question)) {
    return { kind: "urgent", answer: null, notice: askNotice(["symptom"], { region })!, links: [], lang: "en", floorRaised: false, filter: null };
  }
  const flagged = flaggedMarkers(data).filter((f) => f.flag === "urgent");
  const hit = union(touchedFlags(question, flagged, { related: true }), aboutFlags(about, flagged));
  if (hit.length) {
    return {
      kind: "urgent",
      answer: null,
      notice: askNotice(["urgent_marker"], { region, markers: { urgent_marker: asNotice(hit) } })!,
      links: data.report ? ["report"] : [],
      lang: "en",
      floorRaised: false,
      filter: null,
    };
  }
  return null;
}

// ── After the model (contract §6.2, then §6.3 and the caps) ────────────────

// Not app-only when any of these is in the topics, even with "app".
const NOT_APP_ONLY: AskTopic[] = ["supplements", "medicine", "pregnancy", "symptom", "mental_health"];

// ── Doctor signals in the question itself (threats spec D7) ────────────────

/** Their own medicine words (5+ letters, as the medicine filter reads them). */
const ownMedicines = (medications: string | null) =>
  (medications ?? "").toLowerCase().match(/\p{L}{5,}/gu)?.filter((w) => !/^(?:twice|daily|morning|night|after|before|prescribed|tablets?|times|every|evening|capsules?|weekly|doctor)$/.test(w)) ?? [];

/** The question asks to start, stop, skip or change a medicine, or names one they take. */
export function asksMedicineChange(question: string, medications: string | null): boolean {
  const text = normaliseForMatch(question);
  if (medicineChangeRes(medications).some((re) => re.test(text))) return true;
  return ownMedicines(medications).some((w) => new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u").test(text));
}

/** While pregnant: supplements, fasting, dieting or hard training (threats spec D7), in English, Hindi and Hinglish. */
export const PREGNANCY_RISKY =
  /\b(?:supplements?|vitamins?|iron|folic|folate|calcium|b12|omega|fish oil|protein powder|whey|creatine|tablets?|capsules?|dose|doses|fast|fasting|diet|dieting|lose weight|weight loss|calories?|hiit|crossfit|heavy|intense|marathon)\b|सप्लीमेंट|विटामिन|आयरन|गोली|व्रत|उपवास|डाइट|\b(?:vrat|upvaas|goli|dawa|vitamin)\b/u;

const VERY_LITTLE_FOOD = [
  /\bwithout eating\b/,
  /\bbina khaye\b/,
  /बिना खाए/,
  /\bonly (?:eat|have) (?:one|1) (?:meal|time) a day\b/,
  /सिर्फ एक बार खाना/,
  /\bdin (?:mein|me) ek (?:baar|bar) khana\b/,
  // "I haven't eaten in 4 days and want to keep going" (live red-team run, 2026-11-20).
  /\b(?:haven't|have not|hadn't|didn't|did not|not) (?:eat|eaten) (?:anything )?(?:in|for) (?:\d+|two|three|four|five|six|seven|several|many) days\b/,
  /\b(?:\d+|two|three|four|five|six|seven|several) days without (?:food|eating)\b/,
  /\b(?:\d+|do|teen|char|chaar) din se (?:kuch )?nahi? khaya\b/,
];

/** The question asks how to eat very little: the low-calorie phrases, asked rather than answered. */
export function asksVeryLittleFood(question: string): boolean {
  const text = normaliseForMatch(question);
  return LOW_CALORIE.some((re) => re.test(text)) || VERY_LITTLE_FOOD.some((re) => re.test(foldText(question)));
}

/**
 * The model's reply after the floor, the output filters and the caps: what Lane A saves.
 * Null when there's nothing to show (the answer was empty once stripped): the caller
 * treats that as bad output.
 */
export function finishReply(out: AskModelOut, input: AskInput): AskReply | null {
  const { data, question, about } = input;
  const region = data.region;
  const flagged = flaggedMarkers(data);
  const asked = union(touchedFlags(question, flagged, { related: true }), aboutFlags(about, flagged), flagsFromModel(out.markers, flagged));
  const urgentAsked = asked.filter((f) => f.flag === "urgent");
  const doctorAsked = asked.filter((f) => f.flag === "doctor");
  const urgentOnReport = flagged.filter((f) => f.flag === "urgent");
  const topics = new Set(out.topics);
  const appOnly = topics.has("app") && !NOT_APP_ONLY.some((t) => topics.has(t));
  const pregnant = data.person.conditions.includes("pregnant");

  // Row 4: the model says crisis. Calm, code's words only.
  if (out.kind === "crisis") {
    return { kind: "crisis", answer: null, notice: askNotice(["crisis"], { region })!, links: [], lang: "en", floorRaised: false, filter: null };
  }

  let kind: AskTurnKind = out.kind;
  const raise = (k: AskTurnKind) => {
    if (KIND_RANK[k] > KIND_RANK[kind]) kind = k;
  };
  const parts = new Set<AskNoticePart>();
  const markers: NoticeMarkers = {};

  // Row 5: the model says urgent.
  if (out.kind === "urgent") parts.add(urgentAsked.length ? "urgent_marker" : "symptom");
  // Row 6: an urgent-flagged marker touched.
  if (urgentAsked.length) {
    raise("urgent");
    parts.add("urgent_marker");
  }
  if (parts.has("urgent_marker")) markers.urgent_marker = asNotice(urgentAsked);
  // Row 7: the urgent hold (M4). While an urgent result stands, only app and meal-logging questions get answers.
  if (urgentOnReport.length && !appOnly) {
    raise("urgent");
    parts.add("urgent_hold");
    markers.urgent_hold = asNotice(urgentOnReport);
  }
  // Rows 8–10.
  if (doctorAsked.length) {
    raise("doctor");
    parts.add("doctor_marker");
    markers.doctor_marker = asNotice(doctorAsked);
  }
  // The model's topics are a hint; the question itself is checked in code too (threats spec
  // D7), so a mislabelled reply can't drop these lines (QA, 2026-11-20).
  if (topics.has("medicine") || asksMedicineChange(question, data.person.medications)) {
    raise("doctor");
    parts.add("medicine");
  }
  if (pregnant && (topics.has("supplements") || topics.has("pregnancy") || PREGNANCY_RISKY.test(foldText(question)))) {
    raise("doctor");
    parts.add("pregnancy");
  }
  if (asksVeryLittleFood(question)) {
    raise("doctor");
    parts.add("low_calorie");
  }
  // Row 11: the model says doctor and nothing more specific was added.
  if (out.kind === "doctor" && !parts.size) parts.add("doctor_general");

  const floorRaised = KIND_RANK[kind] > KIND_RANK[out.kind];

  if (kind === "urgent") {
    return {
      kind: "urgent",
      answer: null,
      notice: askNotice(parts, { region, markers })!,
      links: parts.has("urgent_marker") && data.report ? ["report"] : [],
      lang: "en",
      floorRaised,
      filter: null,
    };
  }

  // Answer, off-topic or doctor: the AI text goes through the filters.
  // While an urgent result stands, the only answers that get here are ones the model called
  // app-only. That label is the model's, so they still get the reassurance filter: "it's
  // fine, no need to see a doctor" never shows under an urgent hold (QA, 2026-11-20).
  const filtered = filterAnswer(out.answer, { data, question, atLeastDoctor: KIND_RANK[kind] >= KIND_RANK.doctor || urgentOnReport.length > 0 });
  // Under an urgent result, an answer the model called app-only that a safety filter then had
  // to remove wasn't about the app: the hold applies after all, with code's urgent lines
  // (QA, 2026-11-20: it fell to a plain "doctor" reply without the urgent line).
  if (urgentOnReport.length && (filtered.raiseToDoctor || filtered.brand)) {
    return {
      kind: "urgent",
      answer: null,
      notice: askNotice(new Set<AskNoticePart>([...parts, "urgent_hold"]), { region, markers: { ...markers, urgent_hold: asNotice(urgentOnReport) } })!,
      links: [],
      lang: "en",
      floorRaised: true,
      filter: filtered.filter,
    };
  }
  let answer: string | null = filtered.answer;
  let filter: FilterName | null = filtered.filter;
  for (const p of filtered.parts) parts.add(p);
  if (filtered.raiseToDoctor) raise("doctor");
  if (filtered.brand) answer = BRAND_LINE;
  if (answer != null) {
    answer = capAnswer(answer);
    if (!answer.trim()) answer = null;
    // Row 12: a flagged marker named only in the answer gets its line; the kind stays.
    const onlyInAnswer = touchedFlags(answer ?? "", flagged, { related: false }).filter((f) => !asked.some((a) => a.name === f.name));
    for (const f of onlyInAnswer) {
      const part = f.flag === "urgent" ? "urgent_marker" : "doctor_marker";
      parts.add(part);
      markers[part] = [...(markers[part] ?? []), ...asNotice([f])];
    }
  }
  if (kind === "doctor" && !parts.size) parts.add("doctor_general");
  if (answer == null && kind !== "doctor") return null;
  if (!filter && filtered.brand) filter = "brand";

  const notice = askNotice(parts, { region, markers });
  const lang = answerLangTag(out.lang, answer);
  const floorRaisedNow = floorRaised || KIND_RANK[kind] > KIND_RANK[out.kind];

  if (kind === "off_topic") {
    return { kind: "off_topic", answer: answer!, notice, links: [], lang, floorRaised: floorRaisedNow, filter };
  }
  let links: AskLinkId[] = [...new Set(out.links)].filter((id) => id !== "report" || !!data.report);
  if (filtered.brand) links = ["stack"];
  else if (filtered.dose) links = ["stack", ...links.filter((l) => l !== "stack")];
  links = links.slice(0, 2);
  if (kind === "doctor") return { kind: "doctor", answer, notice: notice!, links, lang, floorRaised: floorRaisedNow, filter };
  return { kind: "answer", answer: answer!, notice, links, lang, floorRaised: floorRaisedNow, filter };
}
