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
import { hasDevanagari, romanize } from "./romanize.ts";
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

/**
 * Roughly how a text sounds, in Latin letters, for the Hinglish lists below. Devanagari is
 * written out first (romanize.ts), then: long vowels made short (aa→a, ee→i, oo→u),
 * doubled letters made single, z→j, w→v, ph→f, q→k, chh→ch, an "h" after a vowel at a
 * word's end dropped, and anything but letters, digits and . ? ! turned into spaces. So
 * "jaan de doonga", "jan de dunga" and "जान दे दूंगा" all read "jan de dunga", and
 * "zindagi khatam" and "jindgi khatm" differ only where the patterns allow it. The
 * converter's "tea3" and "tea4" (टी3, टी4) read "t3" and "t4".
 */
export function soundKey(s: string): string {
  const t = foldText(s);
  return (hasDevanagari(t) ? romanize(t) : t)
    .toLowerCase()
    .replace(/\btea(?=[34]\b)/g, "t")
    .replace(/[^a-z0-9.?!]+/g, " ")
    .replace(/ph/g, "f")
    .replace(/z/g, "j")
    .replace(/w/g, "v")
    .replace(/q/g, "k")
    .replace(/ck/g, "k")
    .replace(/chh/g, "ch")
    .replace(/ee|ii/g, "i")
    .replace(/oo|uu/g, "u")
    .replace(/([a-z])\1+/g, "$1")
    .replace(/([aeiou])h(?![a-z])/g, "$1")
    .replace(/ +/g, " ")
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

// ── The same lists for Hinglish in Latin letters, by sound ─────────────────
// Since 2026-11-22 a Hinglish pick listens in en-IN, and Ask's mic writes Devanagari in
// Latin letters for English and Hinglish picks (romanize.ts). So Hindi said out loud often
// arrives as "main aatmahatya karna chahta hoon", which the lists above miss, and people
// type the same words many ways (jaan/jan, khatam/khatm/khtm, zindagi/jindgi, wajan/vazan).
// These are written against soundKey(), not spelling, so one pattern holds the converter's
// spelling (whichever word list it has) and the hand-typed ones. Devanagari is written out
// before they run, so they back up the Devanagari lists above, which stay as they were.
// The same lean towards help, and the same exclusions: hunger, gym talk, plain vomiting and
// breathing hard on a run are left alone. A native speaker reviews them with the rest (§20).

// Pieces, in soundKey's spelling. NAHI: nahi, nahin, nhi, nai. MEIN: mein, me, main, mai, men.
const NAHI = "n(?:a|ah|h)?in?";
const MEIN = "m[ae]i?n?";
// "The wish to": man (mann), dil, ichha (iccha), khayal, vichar, soch, irada.
const WISH = "(?:man|dil|icha|khayal|khyal|vichar|soch|irada)";
const PILLS = "(?:goli[a-z]*|tabl?et[a-z]*|pils?)";
const WEIGHT = "(?:vajan|veight)";
const THIN = "(?:patl[ai]|dubl[ai]|slim|thin)";

const sounds = (sources: string[]) => sources.map((s) => new RegExp(s));

export const CRISIS_SOUNDS: RegExp[] = sounds([
  // aatmahatya, atmahatya, aatmhatya, atamhatya, aatma hatya, atmahatiya.
  "\\bata?m[ae]? ?ha?t(?:i?y|i)a",
  // khudkushi, khudkhushi, khud kushi.
  "\\bkhud ?kh?[ua]sh?i",
  // "suicide" as it's often typed: sucide, suiside, suside. Not "succeed(ed)".
  "\\bsu[ie]?[cs]ide(?!d)",
  // marna chahta/chahti, mar jaana chahta, marne ka man/dil, mujhe marna hai.
  "\\bmar(?:na| ?jana) ch",
  `\\bmarne k[ai] ${WISH}`,
  "\\b(?:mujhe|muje|mjhe) mar(?:na| ?jana) h(?:ai|e)\\b",
  // jeena nahi (chahta), nahi jeena chahti, jeene ka man nahi, zinda nahi rehna.
  `\\bjina ${NAHI}\\b`,
  `\\b${NAHI} jina (?:ch|h(?:ai|e)\\b)`,
  `\\bjine k[ai] (?:[a-z]+ ){0,2}${NAHI}\\b`,
  `\\bjinda ${NAHI} r[ea]h?n`,
  // jaan de dunga/dungi/du/doon, jaan de dena, jaan dena chahta, jaan dene ka man, apni jaan le/de.
  "\\bjan de ?(?:d[ou]n?g?[ai]?|dena)\\b",
  "\\bjan dena ch",
  `\\bjan dene k[ai] ${WISH}`,
  "\\bapni jan (?:le|de)",
  // khud ko / apne aap ko: khatam (khatm, khtm), nuksan, chot, hurt, kill, maar, kaat.
  "\\b(?:khud|apne ?ap) ?ko (?:[a-z]+ )?(?:kha?ta?m|nuk?sa?n|chot|hurt|kil\\b|mar(?:na|ne|du|dal|\\b)|kat(?:na|ne|\\b))",
  "\\bkha?ta?m ka?r (?:[a-z]+ )?(?:khud|apne ?ap) ?ko\\b",
  // Vomiting to lose weight: ulti karke vajan, vajan kam karne ke liye ulti, patli hone ko ulti,
  // jaan boojh ke ulti, ungli daal ke ulti. Plain "ulti ho rahi hai" is a symptom and stays out.
  `\\bult?i ka?r(?:ke| ke|na|ne|ti|ta|vake|vana)? (?:[a-z]+ ){0,3}(?:${WEIGHT}|${THIN})`,
  `\\b${WEIGHT} (?:kam|ghat)[a-z ]{0,25}\\bult?i\\b`,
  `\\b${THIN} (?:[a-z]+ ){0,4}ult?i\\b`,
  "\\b(?:khud|jan ?buj?h? ?(?:ke|kar)|ungl?i) (?:[a-z]+ ){0,3}ult?i",
  // sab khatam kar du/dun/dena (as the list above), zindagi khatam, zindagi se thak/tang.
  "\\bsab kha?ta?m ka?r(?:na|dena|du|dun|dunga|dungi|lu|lun)?\\b",
  "\\bjinda?gi (?:[a-z]+ )?(?:kha?ta?m|se tang|se thak|ka ant)",
  // kitni goliyan ek saath (lu to mar jaunga), bahut saari goliyan kha ke mar.
  `\\bkit(?:ni|ne) (?:[a-z]+ ){0,2}${PILLS}[^.?!]{0,30}\\b(?:mar|maut|ek sath)`,
  `\\b(?:jyada|bahut|sari|sab) (?:[a-z]+ )?${PILLS}\\b[^.?!]{0,25}\\bmar`,
]);

export const EMERGENCY_SOUNDS: RegExp[] = sounds([
  // seene mein dard (sine me dard, sene main tez dard), also pressure, heaviness, tightness.
  `\\bs[ie]ne? ${MEIN} (?:[a-z]+ )?(?:dard|dabav|bhari|jakad)`,
  `\\bchati (?:${MEIN} )?(?:[a-z]+ )?(?:dard|dabav|bhari|jakad)`,
  `\\bchest (?:${MEIN} )?(?:[a-z]+ )?dard\\b`,
  `\\bchest ${MEIN} (?:[a-z]+ )?pain`,
  // saans lene mein (dikkat), saans nahi aa rahi, saans ruk/atak rahi.
  `\\bsans (?:lene ${MEIN}\\b|${NAHI}\\b|ruk|atak)`,
  "\\bbeho?sh?\\b",
  "\\bdil ka d(?:au|o)ra\\b",
  "\\bh(?:e|ea|a)rt atak",
  // Blood: khoon ki ulti, khoon in stool or urine (as the English list).
  "\\bkhun ki ult?i",
  `\\b(?:poti|poty|latrin|toilet|stul|pishab|peshab|urine) (?:${MEIN} )?khun\\b`,
]);

const VERY_LITTLE_FOOD_SOUNDS: RegExp[] = sounds([
  // bina khaye (khae, khaaye), bina khana khaye.
  "\\bbina (?:kuch |khana |kuch bhi )?kha(?:ye|e|y)\\b",
  // sirf ek baar (ek hi baar, ek time, ek waqt) khana, din mein ek baar khana.
  "\\bs[ie]?rf ek (?:hi )?(?:bar|time|vakt|meal) kha",
  `\\bdin (?:${MEIN} |bhar ${MEIN} )?(?:s[ie]?rf )?ek (?:hi )?(?:bar|time|vakt|meal) kha`,
  // char din se kuchh nahi khaya, ek hafte se khana nahi khaya.
  `\\b(?:\\d+|ek|do|tin|char|panch|kai) (?:din|dino|hafte|hafton) se (?:kuch |khana |kuch bhi )?${NAHI} kha(?:ya|yi|ia|i)\\b`,
  // Skipping meals to lose weight, as the English list: dinner skip karke vajan kam, vajan ke liye khana chhod du.
  `\\b(?:khana|nashta|diner|dinar|lunch|lanch|breakfast|brekfast|meals?) (?:[a-z]+ ){0,2}(?:chod|skip)[a-z ]{0,30}\\b(?:${WEIGHT}|${THIN})`,
  `\\b${WEIGHT} (?:kam|ghat)[a-z ]{0,30}\\b(?:khana|nashta|diner|dinar|lunch|lanch|breakfast|brekfast|meals?) (?:[a-z]+ ){0,2}(?:chod|skip)`,
]);

// While pregnant (PREGNANCY_RISKY below): सप्लीमेंट, विटामिन, आयरन, गोली, व्रत, उपवास, डाइट and dawa as written out.
const PREGNANCY_SOUNDS = new RegExp(
  `\\b(?:s[au]pl[ie]m[ae]nt[a-z]*|v[iy]ta?m[ie]n[a-z]*|iron|a?yran|airan|${PILLS}|dav(?:a|ai|aiy[a-z]*)|vrath?|upva?s|diet|dait|dayet)\\b`,
);

const folded = (re: RegExp) => new RegExp(re.source.normalize("NFKC").replace(/़/g, "").replace(/ँ/g, "ं"), "u");
const CRISIS_F = CRISIS.map(folded);
const EMERGENCY_F = EMERGENCY.map(folded);

const listed = (lists: RegExp[], sounded: RegExp[]) => (question: string) => {
  const text = foldText(question);
  if (lists.some((re) => re.test(text))) return true;
  const key = soundKey(question);
  return sounded.some((re) => re.test(key));
};

/** The crisis list, in any script: the lists above on the folded text, the sound lists on its soundKey. */
export const crisisMatch = listed(CRISIS_F, CRISIS_SOUNDS);
/** The emergency list, the same way. */
export const emergencyMatch = listed(EMERGENCY_F, EMERGENCY_SOUNDS);

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

// Marker names as Hinglish writes them, in soundKey's spelling: a Hindi "विटामिन डी" comes out
// of the mic as "vitamin di", "हीमोग्लोबिन" as "heemoglobin", "बी12" as "bi12". These count
// as the marker's own name, so they apply to answers too.
const CHOLESTEROL = "\\b[ck]h?ol[ea]?st[ea]?r[oa]?l";
export const NAME_SOUNDS: Record<string, RegExp> = Object.fromEntries(
  Object.entries({
    vitamin_d: "\\bv[iy]ta?m[ie]ne? ?(?:d|di)(?![a-z])|\\bvit (?:d|di)(?![a-z])",
    b12: "\\bbi? ?12\\b",
    hemoglobin: "\\bh(?:a?e|i|a)mo?g[lo]{1,3}b?l?in",
    ferritin: "\\bf[ea]r[ie]t[ie]n",
    creatinine: "\\b[ck]r(?:i?y?e|ea|ia|i)a?t[ie]nin",
    platelets: "\\bpl[ae]i?te?l[ea]?ts?\\b",
    glucose_fasting: "\\bgl[ua]?[ck]o[sj]e?\\b",
    sodium: "\\bsodi?y?[ua]m\\b",
    potassium: "\\bpot(?:a|ai|e)?sh?i?y?[ua]m\\b",
    calcium: "\\b[ck](?:a|ai|e)l(?:s|sh|c)i?y?[ua]m\\b",
    total_cholesterol: CHOLESTEROL,
    triglycerides: "\\btr(?:a?i|y)gl(?:i|y)s(?:e|a)?r(?:a?i|y)d",
  }).map(([k, src]) => [k, new RegExp(src)]),
);

// The everyday words in RELATED, as Hinglish writes them: khoon, rakt, anaemia; iron, loha;
// sugar, diabetes, madhumeh; kidney, gurda; and thyroid (for TSH) and cholesterol (for LDL),
// which RELATED doesn't have in any script yet.
const SUGAR = "\\bsh?ug[ae]r\\b|\\bd(?:i|a)(?:a|i|y)+b[ei]t|\\bmadhume";
const KIDNEY = "\\bkidn[eiy]|\\bgurd[ae]\\b|\\bmutrapind";
export const RELATED_SOUNDS: Record<string, RegExp> = Object.fromEntries(
  Object.entries({
    ferritin: "\\b(?:iron|ayran|airan|loha)\\b",
    hemoglobin:
      "\\bkhun\\b(?! ?(?:ki janch|ki jach|ka test|test|report))|\\brakt\\b(?! ?(?:ki |ka )?(?:janch|jach|test|report|pariksha|chap|dab))|\\b[ae]n[aei]{0,2}mi(?:y?a|k|c)\\b",
    hba1c: SUGAR,
    glucose_fasting: SUGAR,
    egfr: KIDNEY,
    creatinine: KIDNEY,
    tsh: "\\bth(?:a|ai|ay|y)r(?:o|a)?i?d",
    ldl: CHOLESTEROL,
    non_hdl: CHOLESTEROL,
  }).map(([k, src]) => [k, new RegExp(src)]),
);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Short names that are also units or words ("mg", "ca", "k", Hinglish "na") never count.
const termsOf = (f: FlaggedMarker) => {
  const def = markerDef(f.key);
  const raw = [f.key?.replace(/_/g, " "), f.name, def?.name, def?.short, ...(def?.aliases ?? [])].filter((t): t is string => !!t);
  return [...new Set(raw.map(foldText))].filter((t) => t.length >= 3 || t === "hb");
};
// The same names in soundKey's spelling ("feritin", "potasium"), 4 letters or more so a
// name like "na+" can never turn into Hinglish "na".
const soundTermsOf = (f: FlaggedMarker) => [...new Set(termsOf(f).map(soundKey))].filter((t) => t.length >= 4);
const named = (text: string, term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(term)}(?![\\p{L}])`, "u").test(text);

/**
 * Flagged markers a text names: catalogue key, name, short name or alias, in any spelling
 * soundKey evens out or NAME_SOUNDS lists; and with `related`, the everyday words in RELATED
 * and RELATED_SOUNDS.
 */
export function touchedFlags(text: string, flagged: FlaggedMarker[], o: { related: boolean }): FlaggedMarker[] {
  const t = foldText(text);
  const k = soundKey(text);
  return flagged.filter(
    (f) =>
      termsOf(f).some((term) => named(t, term)) ||
      soundTermsOf(f).some((term) => named(k, term)) ||
      (!!f.key && !!NAME_SOUNDS[f.key]?.test(k)) ||
      (o.related && !!f.key && (!!RELATED_F[f.key]?.test(t) || !!RELATED_SOUNDS[f.key]?.test(k))),
  );
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

// A medicine, then within two words a Hinglish verb for changing it, in soundKey's spelling:
// "dawaiyan band kar du", "goli kam kar du", "metformin chhod du", "dose double kar lu". The
// lists in ask-filters.ts hold "dawa band" and "दवा बंद"; these add plurals (दवाइयां and
// गोलियां as the mic writes them), chhod, rok and skip. Questions only: the answers' filter
// has its own lists, with negation.
const MED_SOUNDS = [
  "dav(?:a|ai|aiy[a-z]*)", "goli[a-z]*", "tabl?et[a-z]*", "pils?", "medi[cs]in[a-z]*", "meds", "dos(?:e|age)", "insulin", "metformin",
  "thyroxin[e]?", "levothyroxin[e]?", "eltroxin", "thyronorm", "telmisartan", "amlodipin[e]?", "statins?", "atorvastatin", "rosuvastatin",
  "aspirin", "glimepirid[e]?", "losartan",
];
const MED_CHANGE_SOUND = "(?:band|bandh|kam|jyada|jada|dabal|double|chod|rok|skip)";
const medicineChangeSound = (medications: string | null) => {
  const theirs = ownMedicines(medications).map(soundKey).filter((w) => w.length >= 5).map(esc);
  return new RegExp(`\\b(?:${[...MED_SOUNDS, ...theirs].join("|")})\\b (?:[a-z0-9]+ ){0,2}?${MED_CHANGE_SOUND}\\b`);
};

/** The question asks to start, stop, skip or change a medicine, or names one they take. */
export function asksMedicineChange(question: string, medications: string | null): boolean {
  const text = normaliseForMatch(question);
  if (medicineChangeRes(medications).some((re) => re.test(text))) return true;
  if (ownMedicines(medications).some((w) => new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u").test(text))) return true;
  return medicineChangeSound(medications).test(soundKey(question));
}

/** While pregnant: supplements, fasting, dieting or hard training (threats spec D7), in English, Hindi and Hinglish. */
export const PREGNANCY_RISKY =
  /\b(?:supplements?|vitamins?|iron|folic|folate|calcium|b12|omega|fish oil|protein powder|whey|creatine|tablets?|capsules?|dose|doses|fast|fasting|diet|dieting|lose weight|weight loss|calories?|hiit|crossfit|heavy|intense|marathon)\b|सप्लीमेंट|विटामिन|आयरन|गोली|व्रत|उपवास|डाइट|\b(?:vrat|upvaas|goli|dawa|vitamin)\b/u;

/** PREGNANCY_RISKY on the folded question, or its Hinglish forms on the soundKey. */
export const asksPregnancyRisk = (question: string) => PREGNANCY_RISKY.test(foldText(question)) || PREGNANCY_SOUNDS.test(soundKey(question));

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
const veryLittleFoodMatch = listed(VERY_LITTLE_FOOD, VERY_LITTLE_FOOD_SOUNDS);

/** The question asks how to eat very little: the low-calorie phrases, asked rather than answered. */
export function asksVeryLittleFood(question: string): boolean {
  const text = normaliseForMatch(question);
  return LOW_CALORIE.some((re) => re.test(text)) || veryLittleFoodMatch(question);
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
  if (pregnant && (topics.has("supplements") || topics.has("pregnancy") || asksPregnancyRisk(question))) {
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
