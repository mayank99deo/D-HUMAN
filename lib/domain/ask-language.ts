// Ask's language checks: which language a question is in, as far as code can tell, and
// whether an answer came back in the right one. Pure, so tests and the browser can use it.
// The model writes the answer; code picks the expected language, checks the answer against
// it, and asks once more when it's wrong (lib/ai/ask.ts).
//
// The person's "Speaking in" pick decides for a question that came from the mic: हिंदी gets
// Hindi in Devanagari, Hinglish gets Latin letters, मराठी gets Marathi, whatever script the
// browser wrote the words in. Typed questions go by their script, and Devanagari is Hindi
// unless the words are clearly Marathi.
//
// Measured on 2026-11-19 (docs/team/specs/2026-11-19-ask-ai.md §2.2): without a hint,
// Marathi questions got Hindi answers 2 of 3 times; with "Their question looks like
// Marathi." 15 of 15 came back in Marathi. On 2026-11-22 the first word list turned out to
// hold words Hindi uses too (होते, करू, and तुम्ही, काय as phones and Mumbai Hindi write
// them), so "मैं क्या करू" got a Marathi answer in every run (tests/fixtures/ask-lang-eval.ts).

import { langTag, scriptLanguage, soundsLikeHindi, spokenById, spokenOf, type SpokenId } from "./speech.ts";

// Words in Devanagari, split on anything else (spaces, punctuation, the danda।).
const devanagariWords = (text: string) => text.match(/[ऀ-ॣ०-ॿ]+/g) ?? [];
const set = (words: string) => new Set(words.split(" "));

// Marathi words Hindi doesn't use. Strong ones count 2: one is enough to say Marathi.
// Weak ones count 1: Hindi typed on a phone, Mumbai Hindi or a misheard word can produce
// one of them (काय, नाही, तुम्ही), so it takes two. A native speaker should review the
// lists (contract §20). Never add a word Hindi uses: होते, करू, खाऊ, कमी, साठी (age sixty),
// आधी (half), तर (wet), हे, का, तो, हो and पण-like particles are out on purpose.
const MARATHI_STRONG = set(
  "आहे आहेत आहात आहेस आणि मला मी माझे माझा माझी माझ्या माझं आम्ही आम्हाला तुम्हाला तुमचे तुमचा तुमची तुमच्या तुमचं " +
    "मध्ये पाहिजे होईल किंवा म्हणजे कोणते कोणता कोणती कोणत्या खूप चांगले चांगला चांगली चांगलं शकतो शकते शकता असते असतो नाहीत मिळेल कुठे कुठून",
);
const MARATHI_WEAK = set(
  "नाही काय किती कसे कसा कशी कसं खावे करावे करावा करावी प्यावे घ्यावे लागते लागतो झाले झाला झाली तुम्ही नको जास्त दररोज पाणी झोप नंतर सकाळी रात्री जेवण काही",
);
// Endings Marathi attaches to a word: अॅपमध्ये, वजनासाठी, नोंदवायचे, व्यायामानंतर.
const MARATHI_STRONG_ENDINGS = ["मध्ये", "साठी", "ायचे", "ायचा", "ायची"];
const MARATHI_WEAK_ENDINGS = ["ानंतर", "ायला"];
// Hindi words Marathi doesn't use, one point each. They outvote a stray Marathi-looking word.
// Not होता/होते, जाता or ये: Marathi uses them too.
const HINDI = set(
  "है हैं हूँ हूं हु था थी थे और नहीं नही में आप आपको आपका आपकी आपके चाहिए चाहिये करें करूं करूँ लिए लिये मुझे मुझको मेरा मेरी मेरे मैं मै " +
    "क्या कैसे कैसा कैसी कितना कितनी कितने सकता सकती सकते बहुत भी यह वह वो कब कहाँ कहां कौन किस किसी रहा रही रहे " +
    "खाना खाएं खाऊं खाऊँ पीना लेना बताओ बताइए हम हमें तुम तुम्हें अगर लेकिन सिर्फ ज्यादा ज़्यादा कम पानी",
);

const ends = (word: string, endings: string[]) => endings.some((e) => word.length > e.length && word.endsWith(e));

/** Marathi and Hindi evidence in Devanagari text: each distinct word counts once. */
export function devanagariScores(text: string): { marathi: number; hindi: number } {
  const words = [...new Set(devanagariWords(text))];
  let marathi = 0;
  let hindi = 0;
  for (const w of words) {
    if (MARATHI_STRONG.has(w) || ends(w, MARATHI_STRONG_ENDINGS)) marathi += 2;
    else if (MARATHI_WEAK.has(w) || ends(w, MARATHI_WEAK_ENDINGS)) marathi += 1;
    if (HINDI.has(w)) hindi += 1;
  }
  return { marathi, hindi };
}

/**
 * Hindi or Marathi, for Devanagari text, or null when the words don't say. Marathi takes
 * one strong word or two weak ones, and more Marathi evidence than Hindi.
 */
export function devanagariLanguage(text: string): "hi" | "mr" | null {
  const { marathi, hindi } = devanagariScores(text);
  if (marathi >= 2 && marathi > hindi) return "mr";
  if (hindi >= 2 && hindi > marathi) return "hi";
  return null;
}

/** True when Devanagari text is clearly Marathi, not Hindi. */
export const looksMarathi = (text: string) => devanagariLanguage(text) === "mr";

/**
 * The language a question is in, as far as code can tell. A pick from the mic decides.
 * Otherwise an Indian script gives its language (Devanagari is Hindi unless it's clearly
 * Marathi); Latin letters give Hinglish when they read like Hindi, else English. The
 * model's own `lang` is checked against this, and this is the fallback when it's off the list.
 */
export function questionLanguage(question: string, spoken?: SpokenId | null): SpokenId {
  const picked = spokenOf(spoken);
  if (picked) return picked.id;
  const script = scriptLanguage(question);
  if (script === "hi" && looksMarathi(question)) return "mr";
  if (script) return script;
  return soundsLikeHindi(question) ? "hinglish" : "en";
}

/**
 * True when the answer isn't in the script it should be: the pick's script for a spoken
 * question (Latin for English and Hinglish), else the question's own script. A typed
 * Latin-letter question is never a mismatch: English and Hinglish answers both use Latin letters.
 */
export function scriptMismatch(question: string, answer: string, spoken?: SpokenId | null): boolean {
  const picked = spokenOf(spoken);
  const a = scriptLanguage(answer);
  if (picked) return picked.script === "Latin" ? !!a : !a || spokenById(a).script !== picked.script;
  const q = scriptLanguage(question);
  if (!q) return false;
  return !a || spokenById(a).script !== spokenById(q).script;
}

/**
 * True when the answer is in the wrong language: the wrong script, or Marathi where Hindi
 * was expected (and the other way round). Answers the word lists can't place are let through,
 * so a short answer never costs a second call.
 */
export function wrongLanguage(question: string, answer: string, spoken?: SpokenId | null): boolean {
  if (scriptMismatch(question, answer, spoken)) return true;
  const expected = questionLanguage(question, spoken);
  if (expected !== "hi" && expected !== "mr") return false;
  const said = devanagariLanguage(answer);
  return !!said && said !== expected;
}

/**
 * The BCP 47 tag for an answer's text ("en", "hi", "hi-Latn", "ta"), for the page's `lang`
 * attribute. No text (urgent and crisis replies carry only code's English notices) is "en".
 */
export function answerLangTag(lang: string | null | undefined, answer: string | null): string {
  if (!answer) return "en";
  const id = spokenOf(lang)?.id ?? questionLanguage(answer);
  return langTag(id, answer) ?? "en";
}
