// Rice weighed in grams: cooked rice on the plate, unless the person says it's raw (Mayank, 2026-11-22).
//
// This finds the amounts in the person's own words, and the meal and usual-day requests then carry the
// raw grams worked out in code (rawRice in food-table.ts). Only those requests change; the system prompt
// doesn't, because a rule there also moved rajma and biryani (lib/ai/food.ts says how). In the live
// check on 2026-11-22, the model copied the line's raw grams in all 42 runs across 9 phrasings (15 of
// them with the line alone, as shipped).
//
// - Latin letters (English, Hinglish) and Devanagari, with digits in either script and the everyday
//   Hindi number words for hundreds ("do sau", "ढाई सौ", "saadhe teen sau") and tens ("assi").
// - Plain rice only: rice, chawal, bhaat, basmati, with words like boiled, white, brown, jeera, ka in
//   between. Dishes (fried rice, curd rice, dal chawal, biryani) and rice products (flour, cakes,
//   noodles, kheer) aren't matched, and the model reads them as before.
// - Raw: a raw word (raw, uncooked, dry, kachcha, कच्चा, "before cooking", "पकाने से पहले") anywhere in
//   the same part of the sentence, or in a part of its own right after it ("100 g rice, uncooked").
//   Parts end at commas, full stops and "and", "aur", "और", "with".
import { rawRice, type RiceCode } from "./food-table";

export type RiceAmount = { grams: number; code: RiceCode; raw: boolean };

const set = (...words: string[]) => new Set(words.map((w) => w.normalize("NFC")));

const RICE = set("rice", "chawal", "chaawal", "chaval", "chaaval", "chawl", "chanwal", "bhaat", "bhat", "basmati", "basamti", "चावल", "चाँवल", "चांवल", "भात", "बासमती", "राइस");
const BROWN = set("brown", "ब्राउन");
const RAW = set(
  "raw", "uncooked", "dry", "kachcha", "kacha", "kachha", "kaccha", "kachche", "kache", "kachhe", "kacche", "kachchi", "kachi", "kachhi", "kacchi",
  "कच्चा", "कच्चे", "कच्ची", "कचा", "सूखा", "सूखे",
);
const RAW_PHRASES = ["before cooking", "before boiling", "not cooked", "pakane se pehle", "pakane se pahle", "pakaane se pehle", "bina paka", "पकाने से पहले", "बिना पका"].map((p) => p.normalize("NFC"));
// Words that can sit between the amount and the rice, or before the rice when the amount comes after it.
const BETWEEN = set(
  "of", "cooked", "boiled", "steamed", "plain", "white", "brown", "sona", "masoori", "masuri", "kolam", "jeera", "jira", "zeera", "ponni", "parboiled",
  "sela", "long", "grain", "regular", "normal", "simple", "ka", "ki", "ke", "wala", "wale", "wali", "paka", "pake", "paki", "pakaya", "pakaye",
  "ubla", "uble", "ubli", "ubale", "hua", "hue", "sada", "saada",
  "का", "की", "के", "वाला", "वाले", "वाली", "उबला", "उबले", "उबली", "पका", "पके", "पकी", "हुआ", "हुए", "सादा", "सफ़ेद", "सफेद", "ब्राउन", "जीरा",
);
// After the rice word: it's a rice product or a dish, not rice.
const NOT_RICE = set(
  "flour", "atta", "aata", "cake", "cakes", "cracker", "crackers", "noodle", "noodles", "paper", "bran", "flakes", "flake", "puff", "puffs", "kheer",
  "pudding", "milk", "water", "pani", "paani", "vermicelli", "sevai", "batter", "roti", "rotis", "bhakri", "papad", "wine", "vinegar", "chips", "idli",
  "dosa", "pulao", "biryani", "khichdi", "आटा", "खीर", "पानी", "रोटी", "पापड़", "इडली", "डोसा", "पुलाव", "बिरयानी", "खिचड़ी",
);
const OF = set("ka", "ki", "ke", "of", "का", "की", "के");
const UNITS = set("g", "gm", "gms", "gram", "grams", "gramme", "grammes", "grm", "grms", "gr", "grs", "ग्राम", "ग्रा", "ग्राम्स", "ग्रॅम");

const SMALL: Record<string, number> = Object.fromEntries(
  Object.entries({
    ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, panch: 5, paanch: 5, paach: 5, chhe: 6, chhah: 6, saat: 7, aath: 8, nau: 9, dhai: 2.5, dhaai: 2.5, dedh: 1.5, derh: 1.5,
    एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, ढाई: 2.5, डेढ़: 1.5, डेढ: 1.5,
  }).map(([k, v]) => [k.normalize("NFC"), v]),
);
// Tens said on their own: "assi gram chawal".
const TENS: Record<string, number> = Object.fromEntries(
  Object.entries({
    bees: 20, tees: 30, chalis: 40, chaalis: 40, pachas: 50, pachaas: 50, sattar: 70, assi: 80, nabbe: 90,
    बीस: 20, तीस: 30, चालीस: 40, पचास: 50, साठ: 60, सत्तर: 70, अस्सी: 80, नब्बे: 90,
  }).map(([k, v]) => [k.normalize("NFC"), v]),
);
const HUNDRED = set("sau", "सौ");
const PLUS_HALF = set("sadhe", "saadhe", "sade", "saade", "साढ़े", "साढे");
const PLUS_QUARTER = set("sava", "sawa", "सवा");
const LESS_QUARTER = set("paune", "pone", "पौने");

/** Amounts outside this range aren't a meal's rice; the model reads them. */
const MIN_G = 20;
const MAX_G = 1500;

function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/un[\s-]+cooked/g, "uncooked")
    .replace(/(\d)(?=\p{L})/gu, "$1 ")
    .replace(/([\p{L}\p{M}])(?=\d)/gu, "$1 ");
}

const PART_BREAK = /[,;+&|।\n]|\.(?!\d)|\s(?:and|aur|or|with|plus|then|phir|और|या|तथा|फिर)\s/u;
const WORD_BREAK = /[\s:()[\]{}"'“”‘’\-–—/*!?]+/u;

/** A number at t[i]: digits, or Hindi number words. Number words count only as hundreds or tens. */
function numberAt(t: string[], i: number): { value: number; next: number } | null {
  let k = i;
  let adjust = 0;
  if (PLUS_HALF.has(t[k])) adjust = 0.5;
  else if (PLUS_QUARTER.has(t[k])) adjust = 0.25;
  else if (LESS_QUARTER.has(t[k])) adjust = -0.25;
  if (adjust) k++;
  const word = t[k];
  if (word === undefined) return null;
  if (HUNDRED.has(word)) return adjust ? null : { value: 100, next: k + 1 };
  if (!adjust && Object.hasOwn(TENS, word)) return { value: TENS[word], next: k + 1 };
  const digits = /^\d+(?:\.\d+)?$/.test(word);
  const value = digits ? Number(word) : Object.hasOwn(SMALL, word) ? SMALL[word] : null;
  if (value === null) return null;
  if (HUNDRED.has(t[k + 1]) && value < 10) return { value: (value + adjust) * 100, next: k + 2 };
  return digits && !adjust ? { value, next: k + 1 } : null;
}

/** Plain rice starting at t[j], after any words that can sit before it: whether it's brown, and where it ends. */
function riceAt(t: string[], j: number): { brown: boolean; end: number } | null {
  let brown = false;
  for (let steps = 0; j < t.length && steps < 5; j++, steps++) {
    const w = t[j];
    if (RICE.has(w)) {
      let end = j + 1;
      while (RICE.has(t[end])) end++;
      if (NOT_RICE.has(t[end]) || (OF.has(t[end]) && NOT_RICE.has(t[end + 1]))) return null;
      return { brown: brown || t.slice(j, end).some((x) => BROWN.has(x)), end };
    }
    if (!BETWEEN.has(w) && !RAW.has(w)) return null;
    brown ||= BROWN.has(w);
  }
  return null;
}

function amountsIn(t: string[]): { grams: number; code: RiceCode }[] {
  const found: { grams: number; code: RiceCode }[] = [];
  const code = (brown: boolean): RiceCode => (brown ? "rice_brown" : "rice_white");
  // The amount first: "300 gram chawal", "300 g of cooked basmati rice".
  for (let i = 0; i < t.length; i++) {
    const n = numberAt(t, i);
    if (!n || !UNITS.has(t[n.next])) continue;
    const rice = riceAt(t, n.next + 1);
    if (rice) {
      found.push({ grams: n.value, code: code(rice.brown) });
      i = rice.end - 1;
    }
  }
  // The rice first, at the start of its part: "chawal 300 gram", "brown rice: 250 g".
  const rice = riceAt(t, 0);
  const n = rice && numberAt(t, rice.end);
  if (rice && n && UNITS.has(t[n.next])) found.push({ grams: n.value, code: code(rice.brown) });
  return found;
}

/** Every amount of rice given in grams in the person's words, and whether they said it's raw. */
export function riceAmounts(text: string): RiceAmount[] {
  const found: RiceAmount[] = [];
  let previous: RiceAmount[] = [];
  for (const part of normalize(text).split(PART_BREAK)) {
    const t = part.split(WORD_BREAK).filter(Boolean);
    const raw = t.some((w) => RAW.has(w)) || RAW_PHRASES.some((p) => part.includes(p));
    const here = amountsIn(t).map((a) => ({ ...a, raw }));
    // "100 g rice, uncooked": a raw word in a part of its own belongs to the rice before it.
    if (!here.length && raw && !/\d/.test(part)) for (const a of previous) a.raw = true;
    found.push(...here);
    previous = here;
  }
  return found.filter((a) => a.grams >= MIN_G && a.grams <= MAX_G);
}

const formatG = (g: number) => String(Math.round(g * 10) / 10);

/** The line for the request when the words give cooked rice in grams, or "" when they don't. */
export function cookedRiceLine(text: string): string {
  const cooked = riceAmounts(text).filter((a) => !a.raw);
  if (!cooked.length) return "";
  const each = cooked.map((a) => {
    const raw = rawRice(a.grams, a.code);
    return `their ${formatG(a.grams)} g of ${a.code === "rice_brown" ? "brown rice" : "rice"} is ${raw.g} g raw ${a.code}, about ${raw.kcal} kcal`;
  });
  return `Rice in grams is cooked rice on the plate, not a raw amount: ${each.join("; ")}.`;
}
