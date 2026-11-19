// Ask's language checks: which language a question is in, as far as code can tell, and
// whether an answer came back in the question's script. Pure, so tests and the browser
// can use it. The model writes in the question's language; code only checks the script
// and asks once more when it's wrong (lib/ai/ask.ts).
//
// Measured on 2026-11-19 (docs/team/specs/2026-11-19-ask-ai.md §2.2): without a hint,
// Marathi questions got Hindi answers 2 of 3 times; with "Their question looks like
// Marathi." 15 of 15 came back in Marathi. One Telugu question in 116 got an English
// answer, which the script check catches.

import { langTag, scriptLanguage, soundsLikeHindi, spokenById, spokenOf, type SpokenId } from "./speech.ts";

// Typed Devanagari is Hindi or Marathi. These words are common in Marathi and rare in
// Hindi. A native speaker should review the list (contract §20).
const MARATHI = /(^|[^ऀ-ॿ])(आहे|आहेत|आणि|नाही|काय|मला|माझे|माझा|माझी|माझ्या|तुम्ही|किती|पाहिजे|लागते|खावे|करावे|करू|कसे|होते|झाले|आम्ही)($|[^ऀ-ॿ])/;

/** True when Devanagari text uses Marathi-only words. */
export const looksMarathi = (text: string) => MARATHI.test(text);

/**
 * The language a question is written in, as far as code can tell: an Indian script
 * gives its language (Devanagari with Marathi words gives Marathi); Latin letters give
 * Hinglish when they read like Hindi, else English. The model's own `lang` is checked
 * against this, and this is the fallback when it's off the list.
 */
export function questionLanguage(question: string): SpokenId {
  const script = scriptLanguage(question);
  if (script === "hi" && looksMarathi(question)) return "mr";
  if (script) return script;
  return soundsLikeHindi(question) ? "hinglish" : "en";
}

/**
 * True when the question is written in an Indian script and the answer isn't in that
 * script (an English answer to a Telugu question, say). Latin-letter questions are never
 * a mismatch: English and Hinglish answers both use Latin letters.
 */
export function scriptMismatch(question: string, answer: string): boolean {
  const q = scriptLanguage(question);
  if (!q) return false;
  const a = scriptLanguage(answer);
  return !a || spokenById(a).script !== spokenById(q).script;
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
