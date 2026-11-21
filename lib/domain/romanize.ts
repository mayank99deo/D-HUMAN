// Hindi in Devanagari, written out in Latin letters the way people text it in India
// (Hinglish), not a scholarly transliteration: "दो रोटी और चने की सब्जी" becomes
// "do roti aur chane ki sabji". It's the safety net for a Hinglish or English pick that
// still comes back in Devanagari: a browser that ignored the listening language, or a
// meal reply in the wrong script (fitScript in lib/domain/speech.ts).
//
// How a word is read:
// - Letter by letter into syllables: consonants (joined by viramas into clusters), each
//   with its vowel sign, its own "a", or none.
// - The "a" Hindi doesn't say is dropped (schwa deletion): at the end of a word ("sabji",
//   "aur"), and in the middle where it sits between a vowel and a consonant that has its
//   own vowel ("rajma", "adrak", "khichdi"). A cluster ending in य, र or व keeps its last
//   "a" ("mitra", "satya").
// - Long vowels the common way: "aa" only to start a word ("aaj"), "ee" and "oo" inside
//   a word ("paneer", "doodh") but "i" and "u" at its end ("roti", "kaju").
// - A short list of common food, portion and health words, many of them English said in
//   Hindi ("चिकन", "प्रोटीन"), is spelt the way people write them.
// Pure: used by the browser, the server and tests.

const VIRAMA = "्";
const NUKTA = "़";
const ANUSVARA = "ं";
const CHANDRABINDU = "ँ";
const VISARGA = "ः";
const JOINERS = new Set(["‌", "‍"]);

const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n", ऩ: "n",
  प: "p", फ: "f", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ऱ: "r", ल: "l", ळ: "l", ऴ: "l", व: "v",
  श: "sh", ष: "sh", स: "s", ह: "h",
};
// With a nukta (the dot below), for Urdu and English sounds: ज़ is "z", फ़ "f". ड़ and ढ़
// are written "d" and "dh", as in "thoda" and "padhai".
const WITH_NUKTA: Record<string, string> = { ज: "z", फ: "f" };
const LABIALS = new Set(["प", "फ", "ब", "भ", "म"]);

type Vowel = "a" | "aa" | "i" | "ii" | "u" | "uu" | "ri" | "li" | "e" | "ai" | "o" | "au";

const VOWEL_LETTERS: Record<string, Vowel> = {
  अ: "a", आ: "aa", इ: "i", ई: "ii", उ: "u", ऊ: "uu", ऋ: "ri", ॠ: "ri", ऌ: "li",
  ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऍ: "e", ऎ: "e", ॲ: "e", ऑ: "o", ऒ: "o",
};
const VOWEL_SIGNS: Record<string, Vowel> = {
  "ा": "aa", "ि": "i", "ी": "ii", "ु": "u", "ू": "uu", "ृ": "ri", "ॄ": "ri", "ॢ": "li",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॅ": "e", "ॆ": "e", "ॉ": "o", "ॊ": "o",
};

/** One syllable: its consonants (one, or a cluster), and its vowel. */
type Syllable = {
  /** Base letters, in order; a nukta stays on its letter ("ज़"). Empty for a vowel letter. */
  cons: string[];
  /** "inherent": the consonant's own "a"; null: no vowel (a virama at the end of a word). */
  vowel: Vowel | "inherent" | null;
  nasal: boolean;
  visarga: boolean;
};

function syllables(word: string): Syllable[] {
  const out: Syllable[] = [];
  const chars = [...word];
  let cluster: string[] = [];
  const last = () => out[out.length - 1];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c in CONSONANTS) {
      let letter = c;
      if (chars[i + 1] === NUKTA) letter += chars[++i];
      cluster.push(letter);
      if (chars[i + 1] === VIRAMA) {
        i++;
        while (JOINERS.has(chars[i + 1])) i++;
        continue;
      }
      const sign = VOWEL_SIGNS[chars[i + 1]];
      if (sign) i++;
      out.push({ cons: cluster, vowel: sign ?? "inherent", nasal: false, visarga: false });
      cluster = [];
    } else if (c in VOWEL_LETTERS) {
      if (cluster.length) out.push({ cons: cluster, vowel: null, nasal: false, visarga: false });
      cluster = [];
      out.push({ cons: [], vowel: VOWEL_LETTERS[c], nasal: false, visarga: false });
    } else if ((c === ANUSVARA || c === CHANDRABINDU) && last() && !cluster.length) last().nasal = true;
    else if (c === VISARGA && last() && !cluster.length) last().visarga = true;
    // Anything else (a stray sign, avagraha, a joiner) says nothing.
  }
  if (cluster.length) out.push({ cons: cluster, vowel: null, nasal: false, visarga: false });
  return out;
}

const base = (letter: string) => letter[0];

/** Which syllables say their own "a". Others are dropped, right to left. */
function spokenA(s: Syllable[]): boolean[] {
  const said = s.map((x) => x.vowel === "inherent");
  const end = s.length - 1;
  const fin = s[end];
  const prev = s[end - 1];
  const keepsFinal =
    (fin.cons.length > 1 && ["य", "र", "व"].includes(base(fin.cons[fin.cons.length - 1]))) ||
    // -iya: "priya", "bhartiya".
    (fin.cons.length === 1 && base(fin.cons[0]) === "य" && (prev?.vowel === "i" || prev?.vowel === "ii"));
  if (end > 0 && fin.vowel === "inherent" && !fin.nasal && !fin.visarga && !keepsFinal) said[end] = false;
  for (let i = end - 1; i >= 1; i--) {
    const x = s[i];
    const next = s[i + 1];
    if (x.vowel !== "inherent" || x.cons.length !== 1 || x.nasal || x.visarga || s[i - 1].vowel === null) continue;
    const nextSaysVowel = next.cons.length === 1 && next.vowel !== null && (next.vowel !== "inherent" || said[i + 1]);
    if (nextSaysVowel) said[i] = false;
  }
  return said;
}

function spellWord(word: string): string {
  const s = syllables(word);
  if (!s.length) return "";
  const said = spokenA(s);
  const end = s.length - 1;
  // The vowel sound a syllable ends on, or null after a dropped "a" or a virama.
  const vowelOf = (i: number): Vowel | null => {
    const v = s[i].vowel;
    if (v === "inherent") return said[i] ? "a" : null;
    return v;
  };
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const x = s[i];
    const own = vowelOf(i);
    const before = i > 0 ? vowelOf(i - 1) : undefined;
    // chai, raita: an unsaid य after "aa" is heard as "i".
    if (x.cons.length === 1 && base(x.cons[0]) === "य" && own === null && before === "aa") {
      out += "i";
      continue;
    }
    for (let k = 0; k < x.cons.length; k++) {
      const letter = x.cons[k];
      const b = base(letter);
      const nextLetter = x.cons[k + 1];
      if (b === "ज" && nextLetter && base(nextLetter) === "ञ") {
        out += "gy";
        k++;
        continue;
      }
      // च्छ is written "chh" ("achha"), not "chchh".
      if (b === "च" && nextLetter && base(nextLetter) === "छ") continue;
      if (b === "व") {
        // "w" after a consonant or "a" and before "a": chawal, hawa, swad, janwar. Else "v": vitamin, seva, ravi, pav.
        const afterSound = k > 0 || before === null || before === "a" || before === "aa";
        const wide = k > 0 || (i > 0 && afterSound && (own === "a" || own === "aa"));
        out += wide ? "w" : "v";
        continue;
      }
      out += letter.length > 1 ? (WITH_NUKTA[b] ?? CONSONANTS[b]) : CONSONANTS[b];
    }
    // ए after a vowel is "ye": liye, gaye, chahiye.
    if (own === "e" && i > 0 && x.cons.length === 0) out += "y";
    if (own) out += spellVowel(own, { first: i === 0 && x.cons.length === 0, last: i === end, beforeY: s[i + 1]?.cons[0] === "य" });
    if (x.nasal) {
      const next = s[i + 1]?.cons[0];
      // मैंने is "maine"; सांभर "sambhar"; हैं "hain".
      out += next && base(next) === "न" ? "" : next && LABIALS.has(base(next)) ? "m" : "n";
    }
    if (x.visarga) out += "h";
  }
  return out;
}

function spellVowel(v: Vowel, at: { first: boolean; last: boolean; beforeY: boolean }): string {
  switch (v) {
    case "aa":
      return at.first ? "aa" : "a";
    case "ii":
      return at.last || at.beforeY ? "i" : "ee";
    case "uu":
      return at.last ? "u" : "oo";
    default:
      return v;
  }
}

// Spelt the way people write them. Keys have no nukta and use ं for ँ, as lookups do.
const WORDS: Record<string, string> = {
  // Hindi words the rules would spell oddly.
  आलू: "aloo", घी: "ghee", में: "mein", हां: "haan", नहीं: "nahi", हूं: "hoon", मां: "maa",
  नान: "naan", चाट: "chaat", साग: "saag", चाय: "chai", पुलाव: "pulao", कचौरी: "kachori",
  पकौडा: "pakoda", पकोडा: "pakoda", पकौडे: "pakode", पकोडे: "pakode", मूंगफली: "moongfali",
  वाला: "wala", वाली: "wali", वाले: "wale",
  // English said in Hindi, as hi-IN speech recognition writes it.
  चिकन: "chicken", मटन: "mutton", एग: "egg", एग्स: "eggs", ऑमलेट: "omelette", आमलेट: "omelette",
  प्रोटीन: "protein", व्हे: "whey", व्हेय: "whey", शेक: "shake", राइस: "rice", ब्रेड: "bread",
  बटर: "butter", ओट्स: "oats", जूस: "juice", सूप: "soup", कॉफी: "coffee", टी: "tea",
  बिस्कुट: "biscuit", बिस्किट: "biscuit", केक: "cake", बर्गर: "burger", पिज्जा: "pizza",
  नूडल्स: "noodles", सैंडविच: "sandwich", फ्राइड: "fried", फ्राई: "fry", मैगी: "maggi",
  चॉकलेट: "chocolate", आइसक्रीम: "ice cream", पीनट: "peanut", कॉर्नफ्लेक्स: "cornflakes",
  स्प्राउट्स: "sprouts", कप: "cup", ग्लास: "glass", प्लेट: "plate", बाउल: "bowl", स्लाइस: "slice", पीस: "piece",
  लीटर: "litre", कैलोरी: "calorie", कैलोरीज: "calories", कैल्शियम: "calcium", आयरन: "iron",
  शुगर: "sugar", डॉक्टर: "doctor", ब्लड: "blood", रिपोर्ट: "report", जिम: "gym", डाइट: "diet",
};

const lookupKey = (word: string) => word.replaceAll(CHANDRABINDU, ANUSVARA).replaceAll(NUKTA, "").replace(/[‌‍]/g, "");

/** True when the text has any Devanagari in it. */
export const hasDevanagari = (text: string) => /[ऀ-ॿ]/.test(text);

/**
 * Devanagari in Latin letters, the way people text Hindi; everything else is left as it
 * is. Lowercase: callers that want a capital (a title) add it.
 */
export function romanize(text: string): string {
  if (!hasDevanagari(text)) return text;
  return (
    text
      // NFC splits क़, ज़, फ़ (and the rest of U+0958–U+095F) into a letter and a nukta.
      .normalize("NFC")
      .replace(/[ऀ-ॣॱ-ॿ‌‍]+/g, (word) => WORDS[lookupKey(word)] ?? spellWord(word))
      .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
      .replace(/\s*[।॥]+/g, ".")
      .replace(/॰/g, ".")
  );
}
