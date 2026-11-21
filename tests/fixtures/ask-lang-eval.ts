// Ask's language eval (2026-11-22): does a Hindi question get a Hindi answer, a Marathi one a
// Marathi answer, and a question spoken with Hinglish picked an answer in Latin letters?
// Written after a Hindi question spoken into Ask's mic came back in Marathi. The live run is
// scripts/ask-lang-eval.mts. Questions are written the way phones type them: chandrabindu and
// anusvara dropped (करू, खाऊ, नही, मै, हु), English words mixed in, Mumbai Hindi's काय.
//
// The grader reads the answer with its own word lists, not the app's detector
// (lib/domain/ask-language.ts), so the eval checks the detector rather than repeating it.

import type { SpokenId } from "../../lib/domain/speech.ts";
import type { PersonId } from "./ask-people.ts";

export type LangCase = {
  id: string;
  person: PersonId;
  q: string;
  /** The "Speaking in" pick, for a question that came from the mic. */
  spoken?: SpokenId;
  want: "hi" | "mr" | "hinglish";
  note: string;
};

export const LANG_CASES: LangCase[] = [
  // ── Hindi, typed (the detector must not call these Marathi) ──
  { id: "hi-faayde", person: "riya", q: "प्रोटीन के क्या फायदे होते हैं", want: "hi", note: "होते was on the Marathi list" },
  { id: "hi-kya-karu", person: "riya", q: "मैं क्या करू", want: "hi", note: "करूँ typed without the chandrabindu" },
  { id: "hi-vitd", person: "riya", q: "विटामिन डी कम हो तो क्या करना चाहिए", want: "hi", note: "plain Hindi" },
  { id: "hi-protein", person: "arjun", q: "मुझे रोज कितना प्रोटीन खाना चाहिए?", want: "hi", note: "plain Hindi" },
  { id: "hi-ferritin", person: "riya", q: "मेरा फेरिटिन कम है, क्या खाऊ?", want: "hi", note: "खाऊँ without the chandrabindu" },
  { id: "hi-gym", person: "arjun", q: "जिम के बाद क्या खाना सही रहता है", want: "hi", note: "plain Hindi" },
  { id: "hi-neend", person: "riya", q: "रात को नींद नहीं आती क्या करू", want: "hi", note: "करू again" },
  { id: "hi-paani", person: "riya", q: "नही पता मुझे कितना पानी पीना चाहिये", want: "hi", note: "नहीं and चाहिए as phones misspell them" },
  { id: "hi-veg", person: "riya", q: "मै वेजीटेरियन हु प्रोटीन कहा से लू", want: "hi", note: "every nasal dropped" },
  { id: "hi-hba1c", person: "arjun", q: "मेरा HbA1c ज्यादा है तो क्या करना होगा", want: "hi", note: "English marker name inside" },
  { id: "hi-muscles", person: "arjun", q: "gym के बाद muscles में दर्द होता है, क्या करें", want: "hi", note: "English words mixed in" },
  { id: "hi-app", person: "riya", q: "ऐप में खाना कैसे लॉग करते हैं", want: "hi", note: "an app question" },
  { id: "hi-paneer", person: "riya", q: "पनीर में कितना प्रोटीन होता है", want: "hi", note: "plain Hindi" },
  { id: "hi-bambaiya", person: "arjun", q: "काय रे, मेरा प्रोटीन कितना होना चाहिए", want: "hi", note: "Mumbai Hindi's काय" },
  { id: "hi-tumhi", person: "riya", q: "तुम्ही बताओ दौड़ने से पहले क्या खाना चाहिए", want: "hi", note: "तुम्हीं without the bindu" },
  { id: "hi-doctor", person: "arjun", q: "डॉक्टर को कब दिखाना चाहिए मेरी रिपोर्ट के लिए", want: "hi", note: "plain Hindi" },
  // ── Marathi, typed (the 2026-11-19 win to keep: three from that spec, five new) ──
  { id: "mr-prerun", person: "riya", q: "धावण्याआधी काय खावे?", want: "mr", note: "spec §2.2" },
  { id: "mr-protein", person: "arjun", q: "मला रोज किती प्रोटीन लागते?", want: "mr", note: "spec §2.2" },
  { id: "mr-ferritin", person: "riya", q: "माझे फेरिटिन कमी आहे, काय करू?", want: "mr", note: "spec §2.2" },
  { id: "mr-veg", person: "riya", q: "मी शाकाहारी आहे, प्रोटीन कुठून मिळेल?", want: "mr", note: "मी, आहे" },
  { id: "mr-zop", person: "riya", q: "रात्री झोप येत नाही, काय करावे?", want: "mr", note: "only weaker words" },
  { id: "mr-after", person: "arjun", q: "व्यायामानंतर काय खाणे चांगले?", want: "mr", note: "चांगले" },
  { id: "mr-paani", person: "riya", q: "दिवसाला किती पाणी प्यावे?", want: "mr", note: "किती, पाणी" },
  { id: "mr-app", person: "riya", q: "अॅपमध्ये जेवण कसे नोंदवायचे?", want: "mr", note: "मध्ये and -ायचे attached to words" },
  // ── Spoken with Hinglish picked, came out in Devanagari: the answer must be in Latin letters ──
  { id: "pick-hinglish-protein", person: "arjun", spoken: "hinglish", q: "मुझे रोज कितना प्रोटीन चाहिए", want: "hinglish", note: "Hinglish pick" },
  { id: "pick-hinglish-gym", person: "arjun", spoken: "hinglish", q: "जिम के बाद क्या खाऊं", want: "hinglish", note: "Hinglish pick" },
  { id: "pick-hinglish-sugar", person: "arjun", spoken: "hinglish", q: "मेरा शुगर कंट्रोल कैसे होगा", want: "hinglish", note: "Hinglish pick" },
  { id: "pick-hinglish-dinner", person: "riya", spoken: "hinglish", q: "रात को क्या खाना चाहिए वजन कम करने के लिए", want: "hinglish", note: "Hinglish pick" },
  { id: "pick-hinglish-vitd", person: "riya", spoken: "hinglish", q: "विटामिन डी के लिए क्या करूं", want: "hinglish", note: "Hinglish pick" },
  { id: "pick-hinglish-chai", person: "riya", spoken: "hinglish", q: "चाय कितनी बार पी सकते हैं", want: "hinglish", note: "Hinglish pick" },
  // ── The pick outranks the words ──
  { id: "pick-hi-mala", person: "arjun", spoken: "hi", q: "मला किती प्रोटीन चाहिए", want: "hi", note: "Marathi-looking words, Hindi picked" },
  { id: "pick-hi-faayde", person: "riya", spoken: "hi", q: "प्रोटीन के क्या फायदे होते हैं", want: "hi", note: "Hindi picked" },
  { id: "pick-mr-kiti", person: "riya", spoken: "mr", q: "प्रोटीन किती?", want: "mr", note: "too little to tell by words; Marathi picked" },
  { id: "pick-mr-nashta", person: "riya", spoken: "mr", q: "नाश्त्यात काय खाऊ", want: "mr", note: "one weak word; Marathi picked" },
];

// ── Grading ────────────────────────────────────────────────────────────────

// Function words that answers in each language can't do without. Hindi: है, और, आप, में, के लिए.
// Marathi: आहे, आणि, तुम्हाला, करा, खा, मध्ये, साठी.
const HI_WORDS = new Set("है हैं था थी और आप आपको आपका आपकी आपके में के की से लिए चाहिए नहीं करें खाएं लें पिएं भी यह ये बहुत सकते सकती होता होती मदद".split(" "));
const MR_WORDS = new Set("आहे आहेत आणि तुम्ही तुम्हाला तुमचे तुमचा तुमची तुमच्या करा खा घ्या प्या किंवा होईल नका शकता चांगले चांगला असे नाही पण जास्त खूप म्हणून मिळेल मदत".split(" "));
// Endings Marathi attaches to the word (अॅपमध्ये, वजनासाठी). Not -ाला or -ाने: Hindi has वाला, खाने.
const MR_SUFFIX = ["मध्ये", "साठी", "ामुळे"];
const words = (text: string) => text.match(/[ऀ-ॣ०-ॿ]+/g) ?? [];

/** The answer's language by the grader's own lists: "latin", "hi", "mr" or "unclear". */
export function answerLanguage(answer: string): { lang: "latin" | "hi" | "mr" | "unclear"; hi: number; mr: number } {
  const ws = words(answer);
  if (!ws.length) return { lang: /[^\x00-ɏ\s\d.,!?%₹–—'"()/:;-]/.test(answer) ? "unclear" : "latin", hi: 0, mr: 0 };
  const hi = new Set(ws.filter((w) => HI_WORDS.has(w))).size;
  const mr = new Set(ws.filter((w) => MR_WORDS.has(w) || MR_SUFFIX.some((s) => w.length > s.length && w.endsWith(s)))).size;
  // "मदद" is in both lists on purpose: it counts for neither side.
  return { lang: hi > mr ? "hi" : mr > hi ? "mr" : "unclear", hi, mr };
}

/** Pass or fail for one answer, with why. `lang` is the model's own `lang` field. */
export function gradeLang(c: LangCase, answer: string, lang: string): { ok: boolean; why: string } {
  const a = answerLanguage(answer);
  if (c.want === "hinglish") {
    if (a.lang !== "latin") return { ok: false, why: `script ${a.lang} (hi ${a.hi}, mr ${a.mr}), want Latin` };
    return lang === "hinglish" ? { ok: true, why: "Latin, hinglish" } : { ok: true, why: `Latin, model said ${lang} (minor)` };
  }
  if (a.lang === "latin") return { ok: false, why: `Latin answer, want ${c.want}` };
  if (a.lang !== c.want) return { ok: false, why: `reads as ${a.lang} (hi ${a.hi}, mr ${a.mr}), model said ${lang}, want ${c.want}` };
  return { ok: true, why: `${a.lang} (hi ${a.hi}, mr ${a.mr}), model said ${lang}` };
}
