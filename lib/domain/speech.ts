// The languages people can log a meal in, by voice or typing. The browser's speech
// recognition can't detect a language by itself, so the person picks the one they
// speak (defaulting to their app language); typed text is recognised by its script.
// Meal replies (title and tip) come back in the same language.
// Pure: used by the browser, the server and tests.

export type SpokenId = "en" | "hinglish" | "hi" | "bn" | "mr" | "te" | "ta" | "gu" | "kn" | "ml" | "pa" | "ur";

export type Spoken = {
  id: SpokenId;
  /** What the person sees, in the language itself. */
  label: string;
  /** English name, for prompts and logs. */
  name: string;
  /** The script replies are written in, for prompts. */
  script: string;
  /** Speech recognition language (BCP 47). */
  speech: string;
  /** Source language for the browser's translator; null when there's nothing to translate. */
  translateFrom: string | null;
};

export const SPOKEN: readonly Spoken[] = [
  { id: "en", label: "English", name: "English", script: "Latin", speech: "en-IN", translateFrom: null },
  { id: "hinglish", label: "Hinglish", name: "Hinglish", script: "Latin", speech: "hi-IN", translateFrom: null },
  { id: "hi", label: "हिंदी", name: "Hindi", script: "Devanagari", speech: "hi-IN", translateFrom: "hi" },
  { id: "bn", label: "বাংলা", name: "Bengali", script: "Bengali", speech: "bn-IN", translateFrom: "bn" },
  { id: "mr", label: "मराठी", name: "Marathi", script: "Devanagari", speech: "mr-IN", translateFrom: "mr" },
  { id: "te", label: "తెలుగు", name: "Telugu", script: "Telugu", speech: "te-IN", translateFrom: "te" },
  { id: "ta", label: "தமிழ்", name: "Tamil", script: "Tamil", speech: "ta-IN", translateFrom: "ta" },
  { id: "gu", label: "ગુજરાતી", name: "Gujarati", script: "Gujarati", speech: "gu-IN", translateFrom: "gu" },
  { id: "kn", label: "ಕನ್ನಡ", name: "Kannada", script: "Kannada", speech: "kn-IN", translateFrom: "kn" },
  { id: "ml", label: "മലയാളം", name: "Malayalam", script: "Malayalam", speech: "ml-IN", translateFrom: "ml" },
  { id: "pa", label: "ਪੰਜਾਬੀ", name: "Punjabi", script: "Gurmukhi", speech: "pa-Guru-IN", translateFrom: "pa" },
  { id: "ur", label: "اردو", name: "Urdu", script: "Urdu (Perso-Arabic)", speech: "ur-IN", translateFrom: "ur" },
];

export const SPOKEN_IDS = SPOKEN.map((s) => s.id) as [SpokenId, ...SpokenId[]];
export const spokenOf = (id: string | null | undefined): Spoken | undefined => SPOKEN.find((s) => s.id === id);
export const spokenById = (id: SpokenId): Spoken => SPOKEN.find((s) => s.id === id) ?? SPOKEN[0];

/** Longest meal description a person can type or say. */
export const MEAL_WORDS_MAX = 1000;
/** Room for the browser's English translation of the longest description. */
export const MEAL_ENGLISH_MAX = 2000;

/** The app language (en, hi, hinglish) as a starting choice for "Speaking in". */
export const spokenForAppLanguage = (language: string | null | undefined): SpokenId =>
  language === "hi" ? "hi" : language === "hinglish" ? "hinglish" : "en";

// Unicode blocks of the scripts above. Devanagari is shared by Hindi and Marathi:
// typed Devanagari is taken as Hindi, since only a spoken meal says which it is.
const SCRIPTS: [RegExp, SpokenId][] = [
  [/[ঀ-৿]/, "bn"],
  [/[਀-੿]/, "pa"],
  [/[઀-૿]/, "gu"],
  [/[஀-௿]/, "ta"],
  [/[ఀ-౿]/, "te"],
  [/[ಀ-೿]/, "kn"],
  [/[ഀ-ൿ]/, "ml"],
  [/[؀-ۿ]/, "ur"],
  [/[ऀ-ॿ]/, "hi"],
];

/** The language a text's script points to, or undefined for Latin script and text with no letters. */
export const scriptLanguage = (text: string): SpokenId | undefined => SCRIPTS.find(([re]) => re.test(text))?.[1];

/**
 * The language a reply is expected in: the model's starting hint, and the fallback
 * when its own call can't be used (see settleReply). Spoken meals: the language
 * chosen for speaking. Typed meals: the language of their script. Latin letters get
 * a Latin-letter reply: Hinglish for people whose app is in Hindi or Hinglish, else
 * English. No words at all (a photo alone) keeps the app language.
 */
export function replyLanguage(text: string, opts: { spoken?: SpokenId | null; appLanguage?: string | null } = {}): SpokenId {
  if (opts.spoken && spokenOf(opts.spoken)) return opts.spoken;
  const script = scriptLanguage(text);
  if (script === "hi" && opts.appLanguage === "hinglish") return "hinglish";
  if (script) return script;
  const app = spokenForAppLanguage(opts.appLanguage);
  if (!/\p{L}/u.test(text)) return app;
  return app === "en" ? "en" : "hinglish";
}

// Hindi words that rarely turn up in English sentences, for spotting Hindi heard or
// typed in Latin letters ("do roti aur dal khayi"). Food names are left out on
// purpose: "2 rotis and dal" is English the way Indians speak it.
const HINDI_IN_LATIN = new Set(
  ("aur maine mene mainne humne hamne khaya khayi khaye khaaya khaai khana khane piya piyi piye liya liye " +
    "thoda thodi thode saath sath ke ka ki hai hain tha thi aaj subah dopahar shaam sham raat nashta nashte " +
    "kuch bhi wala wali wale ek teen chaar paanch aadha adha aadhi mein se gilaas doodh ande anda bas sirf").split(" "),
);

/**
 * True when Latin-letter words look like Hindi: at least two of the words above,
 * making up at least a quarter of the words. Used to suggest listening in Hindi
 * when English is picked; it never switches anything by itself.
 */
export function soundsLikeHindi(text: string): boolean {
  if (scriptLanguage(text)) return false;
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = words.filter((w) => HINDI_IN_LATIN.has(w)).length;
  return hits >= 2 && hits / words.length >= 0.25;
}

/**
 * The language the browser should translate a meal's words from, or null to send
 * them as they are. Only words in an Indian script are translated: English and
 * Hinglish (Latin script) go as typed. A spoken meal uses the language chosen for
 * speaking (so Marathi isn't taken for Hindi); typed words go by their script.
 */
export function translateSource(text: string, spoken?: SpokenId | null): string | null {
  const script = scriptLanguage(text);
  if (!script) return null;
  return (spokenOf(spoken) ?? spokenById(script)).translateFrom;
}

export type MealWords = {
  /** What the person said or typed, in their own words. Empty for a photo alone. */
  said: string;
  /** The browser's English translation of it, when one was made. */
  english: string | null;
  /** The language they said it in (for the prompt when there's a translation). */
  saidIn: Spoken;
  /** The language the title and tip are expected in: the model's hint, and the fallback. */
  reply: Spoken;
};

/**
 * What the server makes of a meal's words. `original` is what the person said when
 * the browser translated it, and `text` is then the translation; otherwise `text`
 * is what they said. `spoken` counts only for meals logged by voice.
 */
export function mealWords(input: { text?: string; original?: string; spoken?: SpokenId | null; appLanguage?: string | null }): MealWords {
  const said = (input.original || input.text || "").trim();
  const text = input.text?.trim();
  const english = input.original && text && text !== said ? text : null;
  const reply = spokenById(replyLanguage(said, { spoken: input.spoken, appLanguage: input.appLanguage }));
  const saidIn = spokenOf(input.spoken) ?? spokenOf(scriptLanguage(said)) ?? reply;
  return { said, english, saidIn, reply };
}

/**
 * The language a meal's reply was written in. The model says which (it follows the
 * words actually used, with the expected language as a hint); its call stands when
 * it's one of ours and, for words in an Indian script, uses that same script, so
 * people get a reply in a script they wrote or heard. Otherwise the expected one.
 */
export function settleReply(claimed: unknown, words: MealWords): Spoken {
  const said = typeof claimed === "string" ? spokenOf(claimed) : undefined;
  if (!said) return words.reply;
  const script = scriptLanguage(words.said);
  if (script && spokenById(script).script !== said.script) return words.reply;
  return said;
}

/**
 * The HTML lang tag for text written in a reply language, so screen readers and
 * fonts treat it right. Hinglish, and any Indian language written in Latin letters,
 * gets the -Latn script subtag.
 */
export function langTag(id: string | null | undefined, text: string): string | undefined {
  const s = spokenOf(id);
  if (!s) return undefined;
  if (s.id === "en") return "en";
  if (s.id === "hinglish") return "hi-Latn";
  const base = s.speech.split("-")[0];
  return scriptLanguage(text) ? base : `${base}-Latn`;
}
