// Ask's "Jump to": finding a screen from a few typed words, with no AI and no question
// spent (UX spec §6). It still works once the day's questions are used.
// Pure, so the keyword table can be tested.
import type { AskLinkId } from "@/lib/ask/types";

/** The row shows only for short text: at most this many words. */
export const JUMP_MAX_WORDS = 5;
/** Every keyword word is at least this long, so two-letter scraps never match. */
export const JUMP_MIN_LETTERS = 3;
export const JUMP_MAX = 2;

/**
 * Keywords per destination: English, Hinglish and Hindi, matched as whole words (a phrase
 * matches its words in a row). The UX spec's "49" and "कल" are left out: under three letters.
 */
export const JUMP_KEYWORDS: readonly { id: AskLinkId; words: readonly string[] }[] = [
  { id: "past_meals", words: ["past", "yesterday", "history", "earlier", "kal", "purane", "पिछले"] },
  { id: "log_meal", words: ["log", "snap", "photo", "khana", "खाना"] },
  { id: "usual_day", words: ["usual", "normal", "typical", "roz"] },
  { id: "upload", words: ["upload", "pdf", "रिपोर्ट", "daalna", "dalna"] },
  { id: "reports", words: ["reports", "delete report", "manage"] },
  { id: "stack", words: ["stack", "supplement", "supplements", "budget", "स्टैक"] },
  { id: "wraps", words: ["wrap", "wraps", "summary", "recap"] },
  { id: "plan", words: ["pass", "pay", "payment", "plan", "upgrade", "limit", "₹49", "paisa"] },
  {
    id: "settings",
    words: ["profile", "settings", "weight", "diet", "medicine", "language", "bhasha", "भाषा", "name", "sign out", "logout", "delete account"],
  },
  { id: "emails", words: ["email", "emails", "unsubscribe", "mail"] },
];

/** Words as matched: NFC, lower case, letters with their marks, digits and ₹ (so "₹49" stays whole). */
export function jumpWords(text: string): string[] {
  return text.normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}₹]+/gu) ?? [];
}

function phraseAt(words: string[], phrase: string[]) {
  outer: for (let i = 0; i + phrase.length <= words.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (words[i + j] !== phrase[j]) continue outer;
    return i;
  }
  return -1;
}

const TABLE = JUMP_KEYWORDS.flatMap((row) => row.words.map((w) => ({ id: row.id, phrase: jumpWords(w) })));

/** Up to two screens the text points to, in the order they come up in it. Empty for long text. */
export function jumpTargets(text: string): AskLinkId[] {
  const words = jumpWords(text);
  if (!words.length || words.length > JUMP_MAX_WORDS) return [];
  const hits = TABLE.map(({ id, phrase }) => ({ id, at: phraseAt(words, phrase) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  return [...new Set(hits.map((h) => h.id))].slice(0, JUMP_MAX);
}
