// Ask's output filters (contract §6.3, threats spec D8) and length caps. They run on the
// parsed answer after the kind floor, before anything is stored. Pure.
//
// Every safety filter lets negated forms through ("can't say whether you have",
// "don't double your metformin", "no doctor reviews these"): the AI efficiency lead's
// measurements found 4 correct refusals among 222 answers that plain patterns would
// have wiped out (docs/team/specs/2026-11-19-ask-ai.md §8.5).
//
// When a filter that removes the answer trips, the whole answer goes (a partial edit can
// leave a misleading half-sentence) and code's fixed line says why.

import { ASK_LIMITS, type AskData, type AskNoticePart } from "../ask/types.ts";

// ── Normalising, for matching only ─────────────────────────────────────────

// Zero-width spaces, bidi controls, BOM, soft hyphen and Unicode tag characters. The
// joiners (U+200C, U+200D) stay in shown text: Indian scripts need them to render.
const INVISIBLE = /[­᠎​‎‏‪-‮⁠-⁤⁦-⁯﻿]|[\u{E0000}-\u{E007F}]/gu;
const JOINERS = /[‌‍]/g;
// Indian digits (Devanagari to Malayalam) and Arabic-Indic digits, by their zero.
const DIGIT_ZEROS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0660, 0x06f0];
const toAsciiDigits = (s: string) =>
  s.replace(/[٠-٩۰-۹०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g, (d) => {
    const cp = d.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9)!;
    return String(cp - zero);
  });
// Unit words to symbols, after NFKC and lower case.
const UNIT_WORDS: [RegExp, string][] = [
  [/milligrams?|मिलीग्राम|मिली ग्राम|एमजी|मिग्रॅ|मि\.ग्रा\./gu, "mg"],
  [/micrograms?|माइक्रोग्राम|माइक्रो ग्राम|µg|μg|\bug\b/gu, "mcg"],
  [/international units?|\bi\.u\.|आईयू|आई यू/gu, "iu"],
];

/** The text as filters match it: NFKC, invisible characters out, ASCII digits, curly quotes straight, unit words as symbols, lower case. */
export function normaliseForMatch(s: string): string {
  let t = toAsciiDigits(s.normalize("NFKC").replace(INVISIBLE, "").replace(JOINERS, "")).toLowerCase().replace(/[‘’`´]/g, "'");
  for (const [re, unit] of UNIT_WORDS) t = t.replace(re, unit);
  return t.replace(/[ \t]+/g, " ");
}

// ── Format and contact: stripped from the text ─────────────────────────────

/** Markdown, HTML tags and invisible characters out; the words stay. */
export function stripFormat(s: string): string {
  return s
    .replace(INVISIBLE, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`+/g, "")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[*•][ \t]+/gm, "");
}

const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}/giu;
const WA = /\bwa\.me\/\S*/gi;
const DOMAIN = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|co|io|app|fit|health|example|info|me|gov|nic|ly|xyz|biz|ai|link|site|online|store|shop)\b(?:\/\S*)?/gi;
// Six or more digits, optionally after +91, separated by single spaces or dashes. Not part of
// a number like "1,830" or "60,000"; dates (2026-11-02) are matched first and kept.
const PHONE = /\b\d{4}-\d{2}-\d{2}\b|(?<!\d|\d[.,])(?:\+\s?\d{1,3}[\s-]?)?(?:\d[\s-]?){5,}\d(?!\d|[.,]\d)/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** URLs, bare domains, emails, wa.me links and phone numbers of 6+ digits out of the text. Our own call buttons are code, not text, so they're untouched. */
export function stripContacts(s: string): string {
  return s
    .replace(WA, "")
    .replace(URL_LIKE, "")
    .replace(EMAIL, "")
    .replace(DOMAIN, "")
    .replace(PHONE, (m) => (ISO_DATE.test(m.trim()) ? m : ""))
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([.,;:!?।])/g, "$1")
    .trim();
}

// ── Negation ───────────────────────────────────────────────────────────────

// Words just before a match, in the same sentence, that make it a refusal rather than a
// claim: "don't double your metformin", "this doesn't mean you have".
const NEGATION = /(?:\b(?:not|no|never|cannot|nor|without|avoid|unless)\b|n't\b|नहीं|मत|\b(?:nahi|nahin|mat)\b)/u;
// Question and condition words count only right before the match: "whether you have", "if your
// doctor said", "until your doctor has reviewed" (seen in the live eval, 2026-11-19).
const QUESTION = /(?:\b(?:whether|if|before|until|till|after|once|when|unless)\b|क्या|\bkya\b)\s*\S*\s*$/u;
function negatedBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 30), index);
  const clause = before.slice(Math.max(0, ...[".", "!", "?", "।"].map((c) => before.lastIndexOf(c) + 1)));
  return NEGATION.test(clause) || QUESTION.test(before.slice(-16));
}
// Hindi puts "don't" after the verb: "दवा बंद मत करें".
const negatedAfter = (text: string, end: number, span = 14) => /(?:मत|नहीं|\bmat\b|\bnahi\b|\bna\b)/u.test(text.slice(end, end + span));

function trips(re: RegExp, text: string, o: { after?: boolean; allow?: (match: string) => boolean } = {}): boolean {
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
    const i = m.index ?? 0;
    if (negatedBefore(text, i)) continue;
    if (o.after && negatedAfter(text, i + m[0].length)) continue;
    if (o.allow?.(m[0])) continue;
    return true;
  }
  return false;
}

const nfkc = (src: string, flags = "iu") => new RegExp(src.normalize("NFKC"), flags);

// ── Diagnosis ──────────────────────────────────────────────────────────────

const CONDITION =
  "(?:pre-?diabet\\w*|diabet\\w*|anaemi\\w*|anemi\\w*|hypothyroid\\w*|hyperthyroid\\w*|thyroid (?:disease|disorder|problem)|kidney (?:disease|damage|failure|problem)|chronic kidney|ckd|heart disease|fatty liver|liver disease|(?:an? )?(?:[\\w-]+ ){0,2}deficien\\w*|pcos|pcod|hypertension|high blood pressure|cancer|an infection|gout|insulin resistan\\w*|metabolic syndrome|osteoporosis)";
export const DIAGNOSIS: RegExp[] = [
  nfkc(`\\b(?:you have|you've got|you have got|you've|you're|you are|you are suffering from|you suffer from|this means you have)\\s+(?:an? |the |some |early |mild |severe |a mild |early-stage )?${CONDITION}`),
  nfkc("आपको\\s+(?:\\S+\\s+){0,3}?(?:डायबिटीज़?|मधुमेह|शुगर|थायराइड|एनीमिया|खून की कमी|\\S+ की कमी|किडनी की बीमारी|बीमारी)\\s+(?:है|हो गई है|हो गया है)"),
  nfkc("\\b(?:aapko|apko|aap ko|tumhe|tumko)\\s+(?:\\w+\\s+){0,3}?(?:diabetes|sugar|thyroid|anemia|anaemia|khoon ki kami|\\w+ ki kami|bimari|bimaari)\\s+(?:hai|ho gaya hai|ho gayi hai)\\b"),
];

// A condition the person told us about (profile ids, lib/domain/options.ts) isn't a
// diagnosis when the answer repeats it: "since you have diabetes" for someone who said so.
const OWN_CONDITION: Record<string, RegExp> = {
  diabetes: /diabet|sugar|शुगर|मधुमेह|डायबिटीज/u,
  thyroid: /thyroid|थायराइड/u,
  bp: /hypertension|high blood pressure/,
  pcos: /pcos|pcod/,
  anaemia: /anaemi|anemi|एनीमिया|खून की कमी|khoon ki kami/u,
  kidney: /kidney|ckd|किडनी/u,
  liver: /liver/,
  heart: /heart/,
};
const ownCondition = (conditions: string[]) => (match: string) =>
  conditions.some((c) => OWN_CONDITION[c]?.test(match.normalize("NFKC").toLowerCase()));

// ── False authority ────────────────────────────────────────────────────────

export const AUTHORITY: RegExp[] = [
  /\bdoctors?\s+(?:has\s+|have\s+)?(?:approved|cleared|reviewed|signed off|said)\b/i,
  /\bdoctor-reviewed\b/i,
  /\breviewed by (?:our|a|the|d-?human)\b/i,
  /\bd-?human (?:recommends|suggests you buy)\b/i,
  // Fake affiliations only: "run with a training partner" is fine.
  /\b(?:our|d-?human'?s?|brand|official|trusted|paid) partners?\b/i,
  /\bpartner(?:s|ed|ship)? (?:with|labs?|brands?|pharmac\w+|clinics?|doctors?)\b/i,
  /\bin partnership\b/i,
  /\bsponsored\b/i,
];

// ── Medicine changes ───────────────────────────────────────────────────────

const MED_WORDS = [
  "tablets?", "pills?", "dose", "dosage", "medicines?", "medications?", "meds", "metformin", "insulin", "thyroxine", "levothyroxine",
  "eltroxin", "thyronorm", "telmisartan", "amlodipine", "statins?", "atorvastatin", "rosuvastatin", "aspirin", "glimepiride",
  "losartan", "davai", "dawai", "dawa", "dava", "goli", "दवा", "दवाई", "गोली",
];
// The contract's verbs (stop, skip, reduce, increase, double, halve) and plain synonyms.
// Not "change" or "switch": "switch to whole grains, and keep taking your medicines" is advice.
const CHANGE_VERBS = "(?:stop|stopping|skip|skipping|reduce|reducing|increase|increasing|double|doubling|halve|halving|cut down|cut back|quit|quitting|discontinue|come off|taper off)";
const STOP_WORDS = new Set(["twice", "daily", "morning", "night", "after", "before", "prescribed", "tablet", "tablets", "times", "every", "evening", "capsule", "weekly", "doctor"]);

/** Medicine words: the fixed list plus words from what they take (5+ letters). */
export function medicineChangeRes(medications: string | null): RegExp[] {
  const theirs = (medications ?? "")
    .toLowerCase()
    .match(/\p{L}{5,}/gu)
    ?.filter((w) => !STOP_WORDS.has(w))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) ?? [];
  const meds = `(?:${[...MED_WORDS, ...theirs].join("|")})`;
  return [
    nfkc(`\\b${CHANGE_VERBS}\\b[^.!?।,;]{0,40}?${meds}`),
    nfkc(`${meds}\\s*(?:\\S+\\s+){0,2}?(?:बंद|कम|ज़्यादा|डबल)`),
    nfkc(`\\b${meds}\\s+(?:\\w+\\s+){0,2}?(?:band|kam|double|zyada)\\s*(?:kar|karo|karein|kar do|kar dein|kar du)?\\b`),
  ];
}

// ── Low calories ───────────────────────────────────────────────────────────

export const LOW_CALORIE: RegExp[] = [
  /\bskip(?:ping)? (?:your |a )?(?:meals?|breakfast|lunch|dinner)\b[^.!?]{0,40}\b(?:lose|weight|lighter|cut|drop)/i,
  /\b(?:to lose|for weight loss|to get lighter|to make weight)\b[^.!?]{0,30}\bskip(?:ping)? (?:meals?|breakfast|lunch|dinner)\b/i,
  /\beat(?:ing)? (?:only )?once a day\b[^.!?]{0,30}\b(?:lose|weight|lighter)/i,
  /\bfast(?:ing)? for (?:\d+|two|three|four|five|several) days\b/i,
  /\b(?:water|juice) fast(?:ing)?\b/i,
];

// ── Reassurance against a flag (kind doctor or higher only) ────────────────

export const REASSURANCE: RegExp[] = [/\bno need (?:to see|for) (?:a |your )?doctor\b/i, /\bnothing to worry about\b/i, /\bit'?s fine\b/i, /\bsafe to ignore\b/i];

// ── Brands ─────────────────────────────────────────────────────────────────
// Indian supplement, pharmacy, lab and packaged-food brands. Words that are also everyday
// English ("ensure", "mankind", "fortune", "Himalayas") only count in a brand's own form.

const BRAND_NAMES = [
  "HealthKart", "MuscleBlaze", "Myprotein", "GNC", "Wellbeing Nutrition", "Kapiva", "Boldfit", "Nutrabay", "AS-IT-IS", "Avvatar",
  "Labrada", "Dymatize", "Isopure", "Gold Standard Whey", "Shelcal", "Calcirol", "Uprise", "D-Rise", "Livogen", "Fefol", "Dexorange",
  "Autrin", "Orofer", "Becosules", "Supradyn", "Zincovit", "Revital", "Neurobion", "Evion", "Limcee", "Celin", "Seven Seas", "Inlife",
  "Carbamide Forte", "Nature's Bounty", "Now Foods", "Centrum", "TrueBasics", "Fast&Up", "OZiva", "Nutrilite", "Amway", "Herbalife",
  "Protinex", "Horlicks", "Bournvita", "Complan", "Pediasure", "Ensure Plus", "Ensure Diabetes", "Himalaya Wellness", "Patanjali",
  "Dabur", "Cipla", "Mankind Pharma", "Abbott", "Sun Pharma", "Tata 1mg", "PharmEasy", "Netmeds", "Apollo Pharmacy", "Apollo 24/7",
  "MedPlus", "Truemeds", "Thyrocare", "Lal PathLabs", "Lal Path Labs", "Dr Lal", "Dr. Lal", "Metropolis Healthcare", "SRL Diagnostics",
  "Redcliffe", "Healthians", "Orange Health", "Agilus", "Apollo Diagnostics", "Amul", "Mother Dairy", "Britannia", "Parle", "Haldiram",
  "Maggi", "Nestle", "Nestlé", "Kellogg", "Saffola", "Yoga Bar", "Epigamia", "Danone", "Akshayakalpa",
];
// Optimum Nutrition only as the brand writes it; "optimum nutrition" is also a phrase.
const CASE_SENSITIVE_BRANDS = ["Optimum Nutrition", "ON Gold Standard"];

const brandRe = (names: string[], flags: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`, flags);
const FIXED_BRANDS = brandRe(BRAND_NAMES, "iu");
const FIXED_BRANDS_CASED = brandRe(CASE_SENSITIVE_BRANDS, "u");

/** True when the answer names a brand: the fixed list, or one in their own stack (3+ characters). */
export function namesBrand(answer: string, stackBrands: string[]): boolean {
  const text = answer.normalize("NFKC");
  if (FIXED_BRANDS.test(text) || FIXED_BRANDS_CASED.test(text)) return true;
  const theirs = stackBrands.map((b) => b.trim()).filter((b) => b.length >= 3);
  return theirs.length > 0 && brandRe(theirs, "iu").test(text);
}

// ── Doses ──────────────────────────────────────────────────────────────────

// A number (or a range) with mg, mcg or IU, after normalising; "mg/dL" isn't a dose.
const DOSE = /(\d[\d,]*(?:\.\d+)?)(?:\s*(?:-|–|—|to|से)\s*(\d[\d,]*(?:\.\d+)?))?\s*(mg|mcg|iu)(?![a-z/])/gu;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const key = (n: number) => String(Math.round(n * 100) / 100);
const num = (s: string) => Number(s.replace(/,/g, ""));

/** Every number in a text, as filters compare them ("1,000" and "1000" are the same). */
export function numbersIn(text: string): string[] {
  return [...toAsciiDigits(text.normalize("NFKC")).matchAll(NUMBER)].map((m) => key(num(m[0])));
}

/** The doses in a text, as "number|unit" (both ends of a range; units mg, mcg or iu). */
export function doseNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of normaliseForMatch(text).matchAll(DOSE)) {
    out.push(`${key(num(m[1]))}|${m[3]}`);
    if (m[2]) out.push(`${key(num(m[2]))}|${m[3]}`);
  }
  return out;
}

const MICRO_UNIT = (k: string) => (k.endsWith("_mg") ? "mg" : k.endsWith("_ug") ? "mcg" : k.endsWith("_iu") ? "iu" : null);

/**
 * Doses an answer may state, as "number|unit", or "number|*" for any unit: their stack's
 * doses and their targets and intakes in their own units; their marker values and ranges,
 * and the numbers in their question, in any unit.
 */
export function allowedDoseNumbers(data: AskData, question: string): Set<string> {
  const allowed = new Set<string>([...doseNumbers(question), ...numbersIn(question).map((n) => `${n}|*`)]);
  const add = (n: number | null | undefined, unit: string) => {
    if (n == null || !Number.isFinite(n)) return;
    for (const v of [n, Math.round(n), Math.round(n * 10) / 10]) allowed.add(`${key(v)}|${unit}`);
  };
  if (data.stack.state === "current") for (const item of data.stack.items) for (const d of doseNumbers(item.dose)) allowed.add(d);
  for (const m of data.report?.markers ?? []) {
    add(m.value, "*");
    add(m.refLow, "*");
    add(m.refHigh, "*");
  }
  for (const micros of [data.targets.micros, data.today.totals.micros, data.diet.perDay?.micros]) {
    for (const [k, v] of Object.entries(micros ?? {})) {
      const unit = MICRO_UNIT(k);
      if (unit) add(Number(v), unit);
    }
  }
  return allowed;
}

const doseAllowed = (dose: string, allowed: Set<string>) => allowed.has(dose) || allowed.has(`${dose.split("|")[0]}|*`);

/** Their stack is held or out of date, or they're pregnant: no dose number at all may appear. */
export const noDosesAtAll = (data: AskData) =>
  data.stack.state === "held" || data.stack.state === "stale" || data.person.conditions.includes("pregnant");

// ── All of it ──────────────────────────────────────────────────────────────

export type FilterName = "dose" | "diagnosis" | "authority" | "medicine" | "low_calorie" | "reassurance" | "brand";

export type FilterResult = {
  /** The answer after stripping; null when a filter removed it. */
  answer: string | null;
  /** Notice parts the filters add. */
  parts: AskNoticePart[];
  /** A filter that removed the answer: the kind becomes at least doctor. */
  raiseToDoctor: boolean;
  /** The brand filter replaced the answer: it links to the stack. */
  brand: boolean;
  /** A dose filter tripped: it links to the stack. */
  dose: boolean;
  /** The first filter that tripped, for the log line. */
  filter: FilterName | null;
};

/**
 * Strips format and contacts, then runs every safety filter on what's left. `atLeastDoctor`
 * says whether the kind is already doctor or higher (the reassurance filter only runs then).
 */
export function filterAnswer(raw: string, o: { data: AskData; question: string; atLeastDoctor: boolean }): FilterResult {
  const answer = stripContacts(stripFormat(raw));
  const text = normaliseForMatch(answer);
  const parts: AskNoticePart[] = [];
  const tripped: FilterName[] = [];

  if (DIAGNOSIS.some((re) => trips(re, text, { allow: ownCondition(o.data.person.conditions) }))) {
    tripped.push("diagnosis");
    parts.push("doctor_general");
  }
  if (AUTHORITY.some((re) => trips(re, text))) {
    tripped.push("authority");
    parts.push("doctor_general");
  }
  if (medicineChangeRes(o.data.person.medications).some((re) => trips(re, text, { after: true }))) {
    tripped.push("medicine");
    parts.push("medicine");
  }
  if (LOW_CALORIE.some((re) => trips(re, text))) {
    tripped.push("low_calorie");
    parts.push("low_calorie");
  }
  const doses = doseNumbers(answer);
  if (doses.length) {
    const allowed = noDosesAtAll(o.data) ? new Set<string>() : allowedDoseNumbers(o.data, o.question);
    if (doses.some((d) => !doseAllowed(d, allowed))) {
      tripped.push("dose");
      parts.push("dose");
    }
  }
  if (o.atLeastDoctor && REASSURANCE.some((re) => trips(re, text))) {
    tripped.push("reassurance");
    parts.push("doctor_general");
  }
  if (tripped.length) {
    return { answer: null, parts: [...new Set(parts)], raiseToDoctor: true, brand: false, dose: tripped.includes("dose"), filter: tripped[0] };
  }
  if (namesBrand(answer, o.data.stackBrands)) {
    return { answer: null, parts: [], raiseToDoctor: false, brand: true, dose: false, filter: "brand" };
  }
  return { answer, parts: [], raiseToDoctor: false, brand: false, dose: false, filter: null };
}

// ── Caps ───────────────────────────────────────────────────────────────────

const SENTENCE_END = /[.!?।۔](?=["')\]]?(?:\s|$))/gu;
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * At most 80 words, 1,200 characters and 4 paragraphs, cut at the last full sentence that
 * fits. When not even one sentence fits, it's cut at the last whole word, with "…".
 */
export function capAnswer(text: string, o: { maxWords?: number; maxChars?: number; maxParagraphs?: number } = {}): string {
  const maxWords = o.maxWords ?? ASK_LIMITS.answerMaxWords;
  const maxChars = o.maxChars ?? ASK_LIMITS.answerMaxChars;
  const maxParagraphs = o.maxParagraphs ?? 4;
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n"))
    .filter(Boolean)
    .slice(0, maxParagraphs);
  const t = paragraphs.join("\n\n");
  const fits = (s: string) => s.length <= maxChars && wordCount(s) <= maxWords;
  if (fits(t)) return t;
  let best = "";
  for (const m of t.matchAll(SENTENCE_END)) {
    const candidate = t.slice(0, (m.index ?? 0) + m[0].length).trim();
    if (fits(candidate)) best = candidate;
    else break;
  }
  if (best) return best;
  const words = t.slice(0, maxChars).split(/(\s+)/);
  let out = "";
  for (const w of words) {
    if (!fits(`${out}${w}…`.trim())) break;
    out += w;
  }
  return `${out.trim().replace(/[,;:]$/, "")}…`;
}
