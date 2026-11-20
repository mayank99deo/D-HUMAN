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
  // "60000 units of vitamin D" is IU (QA, 2026-11-20: "units" got past the dose filter).
  // Only from 100 up, or after a big number word: "2 units of alcohol" isn't a dose.
  [/(\d[\d,]{2,}(?:\.\d+)?)\s*(?:units?|यूनिट)(?![\p{L}])/gu, "$1 iu"],
  [/(hundred|thousand|lakhs?|lacs?|million|हजार|हज़ार|लाख)\s*(?:units?|यूनिट)(?![\p{L}])/gu, "$1 iu"],
];

// Multipliers, so "60K IU", "1 lakh IU" and "60 हज़ार IU" read as the numbers they are
// (QA, 2026-11-20: all three got past the dose filter). Only ever used for matching.
const MULTIPLIERS: [RegExp, number][] = [
  [/(\d[\d,]*(?:\.\d+)?)\s*(?:lakhs?|lacs?|लाख)(?![\p{L}])/gu, 100_000],
  [/(\d[\d,]*(?:\.\d+)?)\s*(?:k|thousand|हजार|हज़ार|hazaa?r)(?![\p{L}])/gu, 1_000],
  [/(\d[\d,]*(?:\.\d+)?)\s*million(?![\p{L}])/gu, 1_000_000],
];
// Thousands grouped with spaces ("60 000 IU", a French and SI habit): read as one number.
const SPACED_THOUSANDS = /\b(\d{1,3})((?:[  ](?:\d{3}))+)(?!\d)/g;

/** The text as filters match it: NFKC, invisible characters out, ASCII digits, curly quotes straight, unit words as symbols, lower case. */
export function normaliseForMatch(s: string): string {
  let t = toAsciiDigits(s.normalize("NFKC").replace(INVISIBLE, "").replace(JOINERS, "")).toLowerCase().replace(/[‘’`´]/g, "'");
  t = t.replace(SPACED_THOUSANDS, (_, head: string, rest: string) => head + rest.replace(/[  ]/g, ""));
  for (const [re, times] of MULTIPLIERS) t = t.replace(re, (_, n: string) => String(Math.round(Number(n.replace(/,/g, "")) * times)));
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
const DOMAIN =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|co|io|app|fit|health|example|info|me|gov|nic|ly|xyz|biz|ai|link|site|online|store|shop|ru|cn|tk|top|click|live|life|club|pro|to|gg|cc|ws|su|pw|uk|us|ca|de|fr|au|sg|ae|pk|bd|lk|np|eu|tv|cloud|tech|space|website|page|dev|ml|ga|cf|gq|vip|win|bid|loan|work|today|news|blog|care|clinic|pharmacy|fitness|diet)\b(?:\/\S*)?/gi;
// Any other "name.tld/path": a path makes it a link whatever the ending (QA, 2026-11-20).
const DOMAIN_WITH_PATH = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/\S+/gi;
// Six or more digits, optionally after +91, separated by single spaces, dashes or dots
// ("98765.43210" got through before; QA, 2026-11-20). Not part of a number like "1,830" or
// "60,000"; dates (2026-11-02) are matched first and kept.
const PHONE = /\b\d{4}-\d{2}-\d{2}\b|(?<!\d|\d[.,])(?:\+\s?\d{1,3}[\s.-]?)?(?:\d[\s.-]?){5,}\d(?!\d|[.,]\d)/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A 6+ digit number followed by a blood-count unit is a reading, not a phone number: "platelets
// 250000 /cumm" (QA, 2026-11-20: platelet counts lost their number). Only count units, so a
// second phone number after a bare "/" or "per" is still removed.
const UNIT_AFTER = /^\s*(?:\/\s*(?:cumm|cu\.?\s?mm|mm3|[µu]l|mcl)\b|per\s+(?:cumm|cu\.?\s?mm|mm3|[µu]l|mcl|micro\s?lit)|cells?\b|cumm\b|lakh\b)/iu;

/** URLs, bare domains, emails, wa.me links and phone numbers of 6+ digits out of the text. Our own call buttons are code, not text, so they're untouched. */
export function stripContacts(s: string): string {
  return s
    .replace(WA, "")
    .replace(URL_LIKE, "")
    .replace(EMAIL, "")
    .replace(DOMAIN_WITH_PATH, "")
    .replace(DOMAIN, "")
    .replace(PHONE, (m: string, at: number, all: string) => (ISO_DATE.test(m.trim()) || UNIT_AFTER.test(all.slice(at + m.length)) ? m : ""))
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
// Words that sound negative but reassure, so they never make what follows a refusal:
// "No doubt, you have diabetes", "Don't worry, stop your metformin" (QA, 2026-11-20: both
// got past the filters).
const FALSE_NEGATION =
  /\b(?:no (?:doubt|question|problem|worries|wonder|denying|kidding)|(?:do not|don't|dont) (?:worry|panic|stress|fret|be (?:scared|alarmed|afraid))|not to (?:worry|alarm you|panic)|without (?:a |any )?doubt|no two ways about it|nothing to worry about)\b/gu;
// A negation counts only in the same clause as the match: a comma, colon, semicolon or dash ends it.
const CLAUSE_BREAKS = [".", "!", "?", "।", ",", ";", ":", "—", "–", " - "];
function negatedBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index);
  const start = Math.max(0, ...CLAUSE_BREAKS.map((c) => {
    const at = before.lastIndexOf(c);
    return at < 0 ? 0 : at + c.length;
  }));
  const clause = before.slice(start);
  return NEGATION.test(clause.replace(FALSE_NEGATION, " ")) || QUESTION.test(clause.slice(-16));
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
// Hedges don't turn a diagnosis into a refusal: "you probably have", "you are likely" (QA, 2026-11-20).
const HEDGE = "(?:probably|likely|most likely|definitely|clearly|certainly|already|possibly|maybe|might|may|could|seem to|appear to|now)";
const DIAG_ARTICLE = "(?:an? |the |some |early |mild |severe |a mild |early-stage |borderline |type ?[12] |stage ?\\d+ |signs of |a touch of )?";
export const DIAGNOSIS: RegExp[] = [
  nfkc(`\\b(?:you have|you've got|you have got|you've|you're|you are|you are suffering from|you suffer from|this means you have)\\s+(?:${HEDGE}\\s+){0,2}(?:(?:got|developed|be|have)\\s+)?${DIAG_ARTICLE}${CONDITION}`),
  nfkc(`\\byou\\s+(?:${HEDGE}\\s+){1,2}(?:have|be|are|got|suffer from|have developed|developed)\\s+${DIAG_ARTICLE}${CONDITION}`),
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
  // "Reviewed by a doctor" alone is advice ("worth getting it reviewed by a doctor"); the claim
  // form ("this was reviewed by a doctor") is the pattern further down.
  /\breviewed by (?:our|d-?human)\b/i,
  /\bd-?human (?:recommends|suggests you buy)\b/i,
  // Fake affiliations only: "run with a training partner" is fine.
  /\b(?:our|d-?human'?s?|brand|official|trusted|paid) partners?\b/i,
  /\bpartner(?:s|ed|ship)? (?:with|labs?|brands?|pharmac\w+|clinics?|doctors?)\b/i,
  /\bin partnership\b/i,
  /\bsponsored\b/i,
  // Claims of a human review, which D-Human never does (QA, 2026-11-20). "Get it checked by a
  // doctor" is advice and passes; "this was reviewed by a doctor" is a claim and trips.
  /\b(?:medically|clinically) (?:reviewed|approved|verified|checked|certified|vetted)\b/i,
  /\b(?:was|were|has been|have been|is|are|been) (?:reviewed|approved|verified|checked|certified|vetted|signed off) by (?:an? |the |our |d-?human'?s? )?(?:doctors?|physicians?|nutritionists?|dietitians?|dieticians?|experts?|medical team|clinicians?|specialists?)\b/i,
  /\b(?:our|d-?human'?s?) (?:own )?(?:doctors?|physicians?|nutritionists?|dietitians?|dieticians?|medical team|medical experts?|health experts?|clinicians?)\b/i,
];

// ── Medicine changes ───────────────────────────────────────────────────────

const MED_WORDS = [
  "tablets?", "pills?", "dose", "dosage", "medicines?", "medications?", "meds", "metformin", "insulin", "thyroxine", "levothyroxine",
  "eltroxin", "thyronorm", "telmisartan", "amlodipine", "statins?", "atorvastatin", "rosuvastatin", "aspirin", "glimepiride",
  "losartan", "davai", "dawai", "dawa", "dava", "goli", "दवा", "दवाई", "गोली",
];
// The contract's verbs (stop, skip, reduce, increase, double, halve) and plain synonyms.
// Not "change" or "switch": "switch to whole grains, and keep taking your medicines" is advice.
const CHANGE_VERBS =
  "(?:stop|stopping|skip|skipping|reduce|reducing|increase|increasing|double|doubling|halve|halving|cut down|cut back|quit|quitting|discontinue|come off|taper off|pause|pausing|hold off on|drop|dropping)";
// "Don't take your metformin (tonight)" ends the clause on the medicine, so it's an instruction
// to skip it; "Don't take your iron tablet with chai" is timing advice and passes (QA, 2026-11-20).
const DONT_TAKE = "(?:don't|do not|dont|no need to|you can skip)\\s+(?:take|taking|use|using)\\s+(?:your\\s+|the\\s+|any\\s+)?";
const SKIP_WHEN = "(?:\\s+(?:today|tonight|tomorrow|for now|anymore|any more|for (?:a|one|two|three|few|\\d+) (?:days?|weeks?|months?)))?\\s*(?:[.!?।]|$)";
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
    nfkc(`\\b${DONT_TAKE}${meds}${SKIP_WHEN}`),
    nfkc(`\\b(?:replace|replacing|swap|swapping|switch|switching)\\s+(?:out\\s+)?(?:your\\s+|the\\s+)?${meds}\\b`),
    nfkc(`\\binstead of (?:your |the |taking (?:your )?)?${meds}\\b`),
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

export const REASSURANCE: RegExp[] = [
  /\bno need (?:to see|for) (?:a |your )?doctor\b/i,
  /\bnothing to worry about\b/i,
  /\bit'?s fine\b/i,
  /\bsafe to ignore\b/i,
  // QA, 2026-11-20: these got past it.
  /\b(?:don't|do not|dont) (?:need|have) to (?:see|visit|consult|call|show) (?:a |your |the )?doctors?\b/i,
  /\b(?:don't|do not|dont) need (?:a |your |the )?doctors?\b/i,
  /\b(?:don't|do not|dont) worry\b/i,
  /\bno need to worry\b/i,
  /\bnothing serious\b/i,
  /\bnot (?:anything )?serious\b/i,
  /\bno (?:cause|reason) for (?:concern|worry)\b/i,
  /\b(?:your )?(?:results?|reports?|numbers|markers|levels|tests?) (?:are|is|look|looks|seem|seems) (?:all |completely |perfectly |totally )?(?:fine|normal|good|okay|ok|healthy)\b/i,
];

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

// Grams count as a dose only for a supplement that's dosed in grams or that grams would
// overdose: "Take 2 g of vitamin C", "5 g fish oil" (QA, 2026-11-20). Grams of food and
// protein stay free: "100 g paneer gives about 18 g protein".
const GRAM_DOSE =
  /(\d[\d,]*(?:\.\d+)?)(?:\s*(?:-|–|—|to|से)\s*(\d[\d,]*(?:\.\d+)?))?\s*(?:g|gm|grams?)\s+(?:of\s+)?(?:[a-z-]+\s+)?(?:vitamin c|omega|epa|dha|fish oil|calcium|magnesium|zinc|iron|vitamin d)/gu;

/** The doses in a text, as "number|unit" (both ends of a range; units mg, mcg, iu, or g for the supplements above). */
export function doseNumbers(text: string): string[] {
  const out: string[] = [];
  const t = normaliseForMatch(text);
  for (const m of t.matchAll(DOSE)) {
    out.push(`${key(num(m[1]))}|${m[3]}`);
    if (m[2]) out.push(`${key(num(m[2]))}|${m[3]}`);
  }
  for (const m of t.matchAll(GRAM_DOSE)) {
    out.push(`${key(num(m[1]))}|g`);
    if (m[2]) out.push(`${key(num(m[2]))}|g`);
  }
  return out;
}

const MICRO_UNIT = (k: string) => (k.endsWith("_mg") ? "mg" : k.endsWith("_ug") ? "mcg" : k.endsWith("_iu") ? "iu" : null);

/**
 * Doses an answer may state, as "number|unit", or "number|*" for any unit: their stack's
 * doses and their targets and intakes in their own units, and their marker values in their own
 * units. Never a number from the question: safety there rested on the model refusing (QA,
 * 2026-11-20), so an answer that repeats "60,000 IU" is replaced even when it says no.
 */
export function allowedDoseNumbers(data: AskData): Set<string> {
  const allowed = new Set<string>();
  const add = (n: number | null | undefined, unit: string) => {
    if (n == null || !Number.isFinite(n)) return;
    for (const v of [n, Math.round(n), Math.round(n * 10) / 10]) allowed.add(`${key(v)}|${unit}`);
  };
  if (data.stack.state === "current") for (const item of data.stack.items) for (const d of doseNumbers(item.dose)) allowed.add(d);
  // A marker's own value, only in its own unit's dose part ("86 mg" for glucose 86 mg/dL). Not
  // its range ends, and never "any unit": round numbers like 50, 100 and 150 are range ends on
  // most reports, so "Take 50 mg zinc" passed for anyone with an HDL range (QA, 2026-11-20).
  for (const m of data.report?.markers ?? []) {
    const unit = normaliseForMatch(m.unit ?? "").match(/^(mg|mcg|iu)(?![a-z])/)?.[1];
    if (unit) add(m.value, unit);
  }
  for (const micros of [data.targets.micros, data.today.totals.micros, data.diet.perDay?.micros]) {
    for (const [k, v] of Object.entries(micros ?? {})) {
      const unit = MICRO_UNIT(k);
      if (unit) add(Number(v), unit);
    }
  }
  return allowed;
}

// A dose written in words: "sixty thousand IU", "five hundred mg", "एक लाख IU" (after normalising).
const NUMBER_WORDS =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|lacs?|million|a|half|एक|दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|दस|बीस|पचास|साठ|सौ|हजार|हज़ार|लाख)";
const SPELLED_DOSE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${NUMBER_WORDS}[\\s-]+){0,3}(?:hundred|thousand|lakhs?|lacs?|million|सौ|हजार|हज़ार|लाख|(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))[\\s-]*(?:mg|mcg|iu)(?![a-z/])`, "u");

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
  if (SPELLED_DOSE.test(text)) {
    // "Sixty thousand IU": a dose in words is never one of their numbers.
    tripped.push("dose");
    parts.push("dose");
  } else if (doses.length) {
    const allowed = noDosesAtAll(o.data) ? new Set<string>() : allowedDoseNumbers(o.data);
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
