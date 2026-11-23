// Food weighed in grams is the cooked food on the plate, unless the person says it's raw (Mayank,
// 2026-11-22): rice first, then dal, whole pulses, quinoa, oats and daliya the same day.
//
// This finds the amounts in the person's own words, and the meal and usual-day requests then carry the
// raw grams worked out in code (rawFor and COOKED in food-table.ts). Only those requests change; the
// system prompt doesn't, because a rule there also moved rajma and biryani (lib/ai/food.ts says how).
// Before this, the model read these foods in grams as dry (200 g dal as 200 g dry dal, 680 kcal; 50 g
// oats as 190 kcal). With the line it copied the raw grams in all 72 runs across 24 phrasings, and in
// all 42 rice runs before that (live checks of 2026-11-22).
//
// Two calls of Mayank's on 2026-11-23:
// - Oats are the exception: grams of oats are dry oats from the packet, as people weigh them, unless the
//   same part says cooked, porridge, oatmeal, dalia-style or "pakaye hue" (OATS_COOKED). Plain "50 g
//   oats" gets no line, so its request is what it was before any of this (190 kcal).
// - Dal and pulse curries include the usual oil (TADKA in food-table.ts), unless the person says no oil,
//   plain, boiled, bina tadka or bina tel (NO_OIL), or names the oil or ghee themselves.
//
// - Latin letters (English, Hinglish) and Devanagari, with digits in either script and the everyday
//   Hindi number words for hundreds ("do sau", "ढाई सौ", "saadhe teen sau") and tens ("assi").
// - Plain foods only, with words like boiled, white, brown, kala, kabuli, sabut, ki in between: rice,
//   chawal, bhaat, basmati; dal of any kind (toor or arhar, moong, masoor, urad, chana); rajma, chole,
//   kala chana, lobia, whole moong, matki; quinoa; oats; daliya.
// - Dishes and products aren't matched, and the model reads them as before: dal makhani, chana masala
//   (both read as dishes already, about 0.3 dry, in the live check), dal chawal, khichdi, chole bhature,
//   sprouts, chaat, besan, sattu, flours, oats cookies, and the like.
// - How the grams turn raw: dal and pulse curries as served (a 150 g katori holds 30 g dry, and 4.5 g
//   or 6.75 g oil); whole pulses said to be boiled ("boiled chana", "uble chane") as drained, with no
//   oil; rice, quinoa, cooked oats and daliya as cooked in water.
// - Raw: a raw word (raw, uncooked, dry, kachcha, कच्चा, packet, soaked, "before cooking", "पकाने से
//   पहले") anywhere in the same part of the sentence, or in a part of its own right after it
//   ("80 g kabuli chana, dry weight"). Parts end at commas, full stops and "and", "aur", "और", "with".
import { rawFor, tadkaFor, type CookedWay, type FoodCode } from "./food-table";

/**
 * - raw: read as raw or dry, so the request gets no line for it.
 * - oil, for dal and curries: "tadka" adds the usual oil, "none" when they said there's none, "own"
 *   when they named oil, ghee or butter themselves.
 */
export type CookedAmount = { grams: number; code: FoodCode; way: CookedWay; label: string; raw: boolean; oil?: "tadka" | "none" | "own" };

const set = (...words: string[]) => new Set(words.map((w) => w.normalize("NFC")));
const map = <T>(entries: Record<string, T>) => new Map(Object.entries(entries).map(([k, v]) => [k.normalize("NFC"), v]));

const RICE = set("rice", "chawal", "chaawal", "chaval", "chaaval", "chawl", "chanwal", "bhaat", "bhat", "basmati", "basamti", "चावल", "चाँवल", "चांवल", "भात", "बासमती", "राइस");
const DAL = set("dal", "daal", "dhal", "dhaal", "दाल");
// The dal a variety word names, with "dal" or alone ("150 g arhar").
const DAL_KIND = map<FoodCode>({
  toor: "toor_dal", tur: "toor_dal", tuar: "toor_dal", tuvar: "toor_dal", toovar: "toor_dal", arhar: "toor_dal", तूर: "toor_dal", तुअर: "toor_dal", तुवर: "toor_dal", अरहर: "toor_dal",
  masoor: "masoor_dal", masur: "masoor_dal", मसूर: "masoor_dal",
  urad: "urad", udad: "urad", urid: "urad", उड़द: "urad", उरद: "urad",
});
// Whole pulses, eaten as a curry unless they're said to be boiled. With "dal", moong and chana are dals.
const PULSE = map<{ code: FoodCode; label: string; boiled: CookedWay }>({
  rajma: { code: "rajma", label: "rajma", boiled: "rajma_boiled" }, rajmah: { code: "rajma", label: "rajma", boiled: "rajma_boiled" }, राजमा: { code: "rajma", label: "rajma", boiled: "rajma_boiled" },
  chole: { code: "chana", label: "chole", boiled: "chana_boiled" }, chhole: { code: "chana", label: "chole", boiled: "chana_boiled" }, choley: { code: "chana", label: "chole", boiled: "chana_boiled" }, छोले: { code: "chana", label: "chole", boiled: "chana_boiled" },
  chana: { code: "chana", label: "chana", boiled: "chana_boiled" }, chane: { code: "chana", label: "chana", boiled: "chana_boiled" }, channa: { code: "chana", label: "chana", boiled: "chana_boiled" }, चना: { code: "chana", label: "chana", boiled: "chana_boiled" }, चने: { code: "chana", label: "chana", boiled: "chana_boiled" },
  lobia: { code: "lobia", label: "lobia", boiled: "lobia_boiled" }, lobiya: { code: "lobia", label: "lobia", boiled: "lobia_boiled" }, chawli: { code: "lobia", label: "lobia", boiled: "lobia_boiled" }, लोबिया: { code: "lobia", label: "lobia", boiled: "lobia_boiled" },
  moong: { code: "moong", label: "whole moong", boiled: "moong_boiled" }, mung: { code: "moong", label: "whole moong", boiled: "moong_boiled" }, मूंग: { code: "moong", label: "whole moong", boiled: "moong_boiled" }, मूँग: { code: "moong", label: "whole moong", boiled: "moong_boiled" },
  matki: { code: "moth", label: "matki", boiled: "moth_boiled" }, moth: { code: "moth", label: "matki", boiled: "moth_boiled" }, मटकी: { code: "moth", label: "matki", boiled: "moth_boiled" }, मोठ: { code: "moth", label: "matki", boiled: "moth_boiled" },
});
const DAL_LABEL: Partial<Record<FoodCode, string>> = { toor_dal: "toor dal", moong: "moong dal", masoor_dal: "masoor dal", urad: "urad dal", chana: "chana dal" };
const GRAIN = map<{ code: FoodCode; way: CookedWay; label: string }>({
  quinoa: { code: "quinoa", way: "quinoa", label: "quinoa" }, kinwa: { code: "quinoa", way: "quinoa", label: "quinoa" }, keenwa: { code: "quinoa", way: "quinoa", label: "quinoa" }, kwinoa: { code: "quinoa", way: "quinoa", label: "quinoa" }, क्विनोआ: { code: "quinoa", way: "quinoa", label: "quinoa" }, किनोआ: { code: "quinoa", way: "quinoa", label: "quinoa" },
  oats: { code: "oats", way: "oats", label: "oats" }, oat: { code: "oats", way: "oats", label: "oats" }, oatmeal: { code: "oats", way: "oats", label: "oats" }, ओट्स: { code: "oats", way: "oats", label: "oats" },
  daliya: { code: "dalia", way: "dalia", label: "daliya" }, dalia: { code: "dalia", way: "dalia", label: "daliya" }, dalliya: { code: "dalia", way: "dalia", label: "daliya" }, bulgur: { code: "dalia", way: "dalia", label: "daliya" }, दलिया: { code: "dalia", way: "dalia", label: "daliya" },
});
// "broken wheat" and "cracked wheat" are daliya: the first word is let through, the second names it.
const WHEAT = set("wheat", "गेहूं", "गेहूँ");
const BROKEN = set("broken", "cracked");
const BROWN = set("brown", "ब्राउन");
const KALA = set("kala", "kale", "kaala", "kaale", "काला", "काले");
const KABULI = set("kabuli", "safed", "काबुली", "सफ़ेद", "सफेद");
const BOILED = set("boiled", "ubla", "uble", "ubli", "ubale", "उबला", "उबले", "उबली");
// Oats in grams are dry oats from the packet unless one of these says they're cooked (Mayank, 2026-11-23).
const OATS_COOKED = set(
  "cooked", "boiled", "steamed", "porridge", "oatmeal", "dalia", "daliya", "dalliya", "pakaye", "pakaya", "pakaaye", "pakaaya", "pake", "paka", "paki",
  "ubla", "uble", "ubli", "ubale", "दलिया", "पकाए", "पकाये", "पकाया", "पके", "पका", "पकी", "उबले", "उबला", "उबली", "पॉरिज", "पोरिज", "ओटमील",
);
const PORRIDGE = set("porridge", "पॉरिज", "पोरिज");
// No oil in the dal or curry. "boiled" and "plain" count; for whole pulses, boiled is drained anyway.
const NO_OIL = set("plain", "sada", "saada", "sadi", "saadi", "boiled", "ubla", "uble", "ubli", "ubali", "ubale", "सादा", "सादी", "उबला", "उबले", "उबली");
const NO_OIL_PHRASES = [
  "no oil", "without oil", "oil free", "zero oil", "no tadka", "without tadka", "no ghee", "without ghee", "bina tel", "bina tadka", "bina tadke",
  "bina ghee", "bina ghi", "tel ke bina", "tadke ke bina", "बिना तेल", "बिना तड़का", "बिना तड़के", "बिना घी", "तेल के बिना", "तड़के के बिना",
].map((p) => p.normalize("NFC"));
// Words of a no-oil phrase that can sit before the food: "200 g oil-free dal", "200 g bina tel ki dal".
const NO_OIL_LEAD = set("no", "zero", "without", "oil", "free", "bina", "tel", "ghee", "tadka", "tadke", "बिना", "तेल", "घी", "तड़का", "तड़के");
// Oil, ghee or butter they named themselves: the line then adds none of its own.
const FAT = set("oil", "ghee", "ghi", "butter", "tel", "makhan", "makkhan", "घी", "तेल", "मक्खन", "मखन");

const RAW = set(
  "raw", "uncooked", "dry", "kachcha", "kacha", "kachha", "kaccha", "kachche", "kache", "kachhe", "kacche", "kachchi", "kachi", "kachhi", "kacchi",
  "sookha", "sukha", "sookhe", "sukhe", "sookhi", "sukhi", "packet", "pack", "packed", "soaked", "bhigoye", "bhigoya", "bhige", "bheege",
  "कच्चा", "कच्चे", "कच्ची", "कचा", "सूखा", "सूखे", "सूखी", "पैकेट", "भीगे", "भिगोए",
);
const RAW_PHRASES = [
  "before cooking", "before boiling", "before soaking", "not cooked", "pakane se pehle", "pakane se pahle", "pakaane se pehle", "bhigone se pehle", "bina paka",
  "पकाने से पहले", "भिगोने से पहले", "बिना पका",
].map((p) => p.normalize("NFC"));
// Words that can sit between the amount and the food, or among the food's own words.
const BETWEEN = set(
  "of", "cooked", "boiled", "steamed", "plain", "white", "brown", "sona", "masoori", "masuri", "kolam", "jeera", "jira", "zeera", "ponni", "parboiled",
  "sela", "long", "grain", "regular", "normal", "simple", "ka", "ki", "ke", "wala", "wale", "wali", "paka", "pake", "paki", "pakaya", "pakaye", "pakaaye", "sadi", "saadi",
  "ubla", "uble", "ubli", "ubale", "hua", "hue", "sada", "saada",
  "kala", "kale", "kaala", "kaale", "kabuli", "safed", "sabut", "whole", "dhuli", "chilka", "chilke", "split", "yellow", "peeli", "pili", "hari", "green",
  "rolled", "steel", "cut", "quick", "instant", "style", "jaisa", "jaise", "jaisi", "type",
  "का", "की", "के", "जैसा", "जैसे", "स्टाइल", "सादी", "पकाए", "पकाये", "वाला", "वाले", "वाली", "उबला", "उबले", "उबली", "पका", "पके", "पकी", "हुआ", "हुए", "सादा", "सफ़ेद", "सफेद", "ब्राउन", "जीरा",
  "काला", "काले", "काबुली", "साबुत", "धुली", "छिलका", "छिलके", "पीली", "हरी",
);
// Right after the food's words: it's a dish or a product, not the food. "masala" and "makhani": the live
// check of 2026-11-22 read "200 g chana masala" and "200 g dal makhani" as dishes already (0.28-0.3 dry).
const NOT_FOOD = set(
  "flour", "atta", "aata", "cake", "cakes", "cracker", "crackers", "noodle", "noodles", "paper", "bran", "flakes", "flake", "puff", "puffs", "kheer",
  "pudding", "milk", "water", "pani", "paani", "vermicelli", "sevai", "batter", "roti", "rotis", "bhakri", "papad", "wine", "vinegar", "chips", "idli",
  "dosa", "pulao", "biryani", "khichdi", "khichri", "makhani", "makhni", "masala", "bhature", "bhatura", "kulche", "kulcha", "puri", "chaat", "salad",
  "sprouts", "sprout", "chilla", "cheela", "chila", "dhokla", "vada", "wada", "pakora", "pakode", "pakoda", "halwa", "laddoo", "ladoo", "namkeen",
  "bhujia", "paratha", "kachori", "samosa", "tikki", "kebab", "cutlet", "soup", "cookie", "cookies", "biscuit", "biscuits", "bar", "bars", "bread",
  "muffin", "pancake", "pancakes", "upma", "smoothie", "shake", "porridge", "granola", "sattu", "besan", "bati", "baati",
  "आटा", "खीर", "पानी", "रोटी", "पापड़", "इडली", "डोसा", "पुलाव", "बिरयानी", "खिचड़ी", "मखनी", "मखानी", "मसाला", "भटूरे", "चाट", "चीला", "हलवा", "पराठा", "सत्तू", "बेसन",
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

/** Amounts outside this range aren't one meal's food; the model reads them. */
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

const isFoodWord = (w: string) => RICE.has(w) || DAL.has(w) || DAL_KIND.has(w) || PULSE.has(w) || GRAIN.has(w) || WHEAT.has(w);
const canSit = (w: string) => BETWEEN.has(w) || RAW.has(w) || BROKEN.has(w) || NO_OIL_LEAD.has(w);

type Food = Omit<CookedAmount, "grams" | "raw">;

/** What a run of food words and the words among them name, or null for none, a mix, or a dish. */
function nameOf(run: string[]): Food | null {
  const food = run.filter(isFoodWord);
  if (!food.length) return null;
  const rice = food.some((w) => RICE.has(w));
  const pulse = food.some((w) => DAL.has(w) || DAL_KIND.has(w) || PULSE.has(w));
  const grains = new Set(food.filter((w) => GRAIN.has(w)).map((w) => GRAIN.get(w)!.code));
  // "oats dalia", "dalia style oats": oats cooked like daliya.
  if (grains.has("oats") && grains.has("dalia")) return { ...GRAIN.get("oats")! };
  const wheat = food.some((w) => WHEAT.has(w));
  // Two foods ("dal chawal", "rajma chawal", "quinoa rice") are a dish, left to the model.
  if ([rice, pulse, grains.size > 0, wheat].filter(Boolean).length > 1 || grains.size > 1) return null;
  if (rice) {
    const brown = run.some((w) => BROWN.has(w));
    return brown ? { code: "rice_brown", way: "rice_brown", label: "brown rice" } : { code: "rice_white", way: "rice_white", label: "rice" };
  }
  if (wheat) return run.some((w) => BROKEN.has(w)) ? { code: "dalia", way: "dalia", label: "daliya" } : null;
  if (grains.size) return { ...GRAIN.get(food.find((w) => GRAIN.has(w))!)! };
  const kinds = new Set(food.map((w) => DAL_KIND.get(w) ?? PULSE.get(w)?.code).filter(Boolean));
  if (kinds.size > 1) return null;
  // A dal: "dal", "moong dal", "arhar ki dal", "150 g arhar".
  if (food.some((w) => DAL.has(w)) || food.some((w) => DAL_KIND.has(w))) {
    const code = [...kinds][0];
    return code ? { code, way: "dal", label: DAL_LABEL[code] ?? "dal" } : { code: "toor_dal", way: "dal", label: "dal" };
  }
  const pulseWord = food.find((w) => PULSE.has(w))!;
  const p = PULSE.get(pulseWord)!;
  const said = (words: Set<string>) => run.some((w) => words.has(w));
  const label = p.code !== "chana" ? p.label : said(KALA) ? "kala chana" : said(KABULI) ? "chole" : p.label;
  return run.some((w) => BOILED.has(w)) ? { code: p.code, way: p.boiled, label: `boiled ${label}` } : { code: p.code, way: "curry", label };
}

/** The food named from t[j] on, after any words that can sit before it, and where its words end. */
function foodAt(t: string[], j: number): (Food & { end: number }) | null {
  let end = j;
  while (end < t.length && end - j < 6 && (isFoodWord(t[end]) || canSit(t[end]))) end++;
  // Words that can sit before or among the food's words don't end it ("rice cooked"), but a run ends
  // at its last food word, so "chawal ka atta" still sees "atta".
  while (end > j && !isFoodWord(t[end - 1])) end--;
  if (end === j) return null;
  const name = nameOf(t.slice(j, end));
  if (!name) return null;
  // Oats porridge is oats, cooked; every other dish word ends the match.
  if (name.code === "oats" && PORRIDGE.has(t[end])) return { ...name, end: end + 1 };
  if (NOT_FOOD.has(t[end]) || (OF.has(t[end]) && NOT_FOOD.has(t[end + 1]))) return null;
  return { ...name, end };
}

function amountsIn(t: string[]): (Food & { grams: number })[] {
  const found: (Food & { grams: number })[] = [];
  // The amount first: "300 gram chawal", "200 g of cooked moong dal".
  for (let i = 0; i < t.length; i++) {
    const n = numberAt(t, i);
    if (!n || !UNITS.has(t[n.next])) continue;
    const food = foodAt(t, n.next + 1);
    if (food) {
      found.push({ code: food.code, way: food.way, label: food.label, grams: n.value });
      i = food.end - 1;
    }
  }
  // The food first, at the start of its part: "chawal 300 gram", "rajma: 200 g".
  const food = foodAt(t, 0);
  const n = food && numberAt(t, food.end);
  if (food && n && UNITS.has(t[n.next])) found.push({ code: food.code, way: food.way, label: food.label, grams: n.value });
  return found;
}

const hasPhrase = (t: string[], phrases: string[]) => {
  const joined = ` ${t.join(" ")} `;
  return phrases.some((p) => joined.includes(` ${p} `));
};

/**
 * Every amount in grams of a food on the list, in the person's words: whether it's read as raw, and for
 * dal and curries, the oil. Oats are dry unless the same part says they're cooked.
 */
export function cookedAmounts(text: string): CookedAmount[] {
  const parts = normalize(text)
    .split(PART_BREAK)
    .map((part) => {
      const t = part.split(WORD_BREAK).filter(Boolean);
      const saidNoOil = hasPhrase(t, NO_OIL_PHRASES);
      const noOil = saidNoOil || t.some((w) => NO_OIL.has(w));
      return {
        part, t, noOil, saidNoOil,
        raw: t.some((w) => RAW.has(w)) || RAW_PHRASES.some((p) => part.includes(p)),
        oatsCooked: t.some((w) => OATS_COOKED.has(w)),
        fat: !noOil && t.some((w) => FAT.has(w)),
      };
    });
  const ownFat = parts.some((p) => p.fat);
  const found: CookedAmount[] = [];
  let previous: { amount: CookedAmount; saidRaw: boolean }[] = [];
  for (const { part, t, raw, oatsCooked, noOil, saidNoOil } of parts) {
    const here = amountsIn(t).map((a) => {
      const oil: CookedAmount["oil"] = a.way === "dal" || a.way === "curry" ? (noOil ? "none" : ownFat ? "own" : "tadka") : undefined;
      const amount: CookedAmount = { ...a, raw: raw || (a.code === "oats" && !oatsCooked), ...(oil ? { oil } : {}) };
      return { amount, saidRaw: raw };
    });
    // A part of its own right after the food: "80 g kabuli chana, dry weight" is raw; "200 g oats, cooked" is cooked.
    if (!here.length && !/\d/.test(part)) {
      for (const p of previous) {
        if (raw) p.amount.raw = true;
        else if (oatsCooked && t.every((w) => OATS_COOKED.has(w) || BETWEEN.has(w)) && p.amount.code === "oats" && !p.saidRaw) p.amount.raw = false;
        // Only a phrase ("no oil", "bina tel") reaches back: "200 g dal, boiled egg" keeps its oil.
        if (saidNoOil && p.amount.oil) p.amount.oil = "none";
      }
    }
    found.push(...here.map((h) => h.amount));
    previous = here;
  }
  return found.filter((a) => a.grams >= MIN_G && a.grams <= MAX_G);
}

const formatG = (g: number) => String(Math.round(g * 10) / 10);

/** What the line says about oil, for dal and curries. */
function oilWords(a: CookedAmount): string {
  if (a.way !== "dal" && a.way !== "curry") return "";
  if (a.oil === "none") return ", with no oil";
  if (a.oil === "own") return a.way === "dal" ? " for the dal alone" : " for the beans alone";
  const oil = tadkaFor(a.grams, a.way);
  return `, plus ${formatG(oil.g)} g oil or ghee for the ${a.way === "dal" ? "tadka" : "masala"}, about ${oil.kcal} kcal`;
}
const isRice = (a: CookedAmount) => a.code === "rice_white" || a.code === "rice_brown";

/** The line for the request when the words give cooked food in grams, or "" when they don't. */
export function cookedLine(text: string): string {
  const cooked = cookedAmounts(text).filter((a) => !a.raw);
  if (!cooked.length) return "";
  const each = cooked.map((a) => {
    const raw = rawFor(a.grams, a.code, a.way);
    const state = isRice(a) || a.code === "quinoa" ? "raw" : "dry";
    const label = a.code === "oats" ? "cooked oats" : a.label;
    return `their ${formatG(a.grams)} g of ${label} is ${raw.g} g ${state} ${a.code}, about ${raw.kcal} kcal${oilWords(a)}`;
  });
  // Rice alone keeps the words it shipped with (150cedc), measured in 42 runs.
  const lead = cooked.every(isRice) ? "Rice in grams is cooked rice on the plate, not a raw amount" : "Food in grams is cooked food as served, not a raw amount";
  return `${lead}: ${each.join("; ")}.`;
}

