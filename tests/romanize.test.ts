// Devanagari in Latin letters the way people text Hindi (lib/domain/romanize.ts): the safety
// net for a Hinglish pick that still comes back in Devanagari.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasDevanagari, ROMAN_PHRASES, ROMAN_WORDS, romanize } from "../lib/domain/romanize.ts";
import { HELD_OUT, readsNaturally, TRANSCRIPTS } from "./fixtures/hinglish-transcripts.ts";

const check = (pairs: [string, string][]) => {
  for (const [devanagari, latin] of pairs) assert.equal(romanize(devanagari), latin, devanagari);
};

describe("Devanagari in Latin letters", () => {
  it("writes Mayank's meal the way he texts it", () => {
    check([["दो रोटी और चने की सब्जी", "do roti aur chane ki sabji"]]);
  });

  it("drops the 'a' Hindi doesn't say, at the end and in the middle of a word", () => {
    check([
      ["और", "aur"],
      ["नमक", "namak"],
      ["राजमा", "rajma"],
      ["अदरक", "adrak"],
      ["खिचड़ी", "khichdi"],
      ["इडली", "idli"],
      ["समझना", "samajhna"],
      ["नमकीन", "namkeen"],
      ["संतरा", "santra"],
      ["बिरयानी", "biryani"],
      ["रसगुल्ला", "rasgulla"],
    ]);
  });

  it("keeps the 'a' where Hindi says it", () => {
    check([
      ["सुबह", "subah"],
      ["गाजर", "gajar"],
      ["अस्पताल", "aspatal"],
      ["समस्या", "samasya"],
      ["प्रिय", "priya"],
      ["भारतीय", "bhartiya"],
      ["मटर", "matar"],
    ]);
  });

  it("writes common meal words the way people do", () => {
    check([
      ["दाल चावल", "dal chawal"],
      ["पनीर की सब्ज़ी", "paneer ki sabzi"],
      ["एक गिलास दूध", "ek gilas doodh"],
      ["अदरक वाली चाय", "adrak wali chai"],
      ["आलू पराठा", "aloo paratha"],
      ["दो अंडे", "do ande"],
      ["इडली सांभर", "idli sambhar"],
      ["मूंग दाल", "moong dal"],
      ["हल्दी वाला दूध", "haldi wala doodh"],
      ["रायता", "raita"],
      ["पाव भाजी", "pav bhaji"],
      ["दो कटोरी दाल और एक कटोरी चावल", "do katori dal aur ek katori chawal"],
      ["मैंने आज सुबह पोहा खाया", "maine aaj subah poha khaya"],
      ["थोड़ा गुड़", "thoda gud"],
      ["चाय में चीनी", "chai mein cheeni"],
      ["काजू बादाम अखरोट", "kaju badam akhrot"],
      ["खीर पूरी", "kheer poori"],
      ["लस्सी छाछ", "lassi chhachh"],
      ["अच्छा", "achha"],
      ["स्वाद", "swad"],
      ["ज्ञान", "gyan"],
      ["क़ीमा", "keema"],
    ]);
  });

  it("spells English said in Hindi as English", () => {
    check([
      ["प्रोटीन शेक", "protein shake"],
      ["चिकन राइस", "chicken rice"],
      ["दो कप चाय", "do cup chai"],
      ["ब्रेड बटर", "bread butter"],
      ["ओट्स और मिल्क", "oats aur milk"],
      ["विटामिन", "vitamin"],
      ["कैल्शियम", "calcium"],
    ]);
  });

  it("writes short everyday words with the long 'a' people text", () => {
    check([
      ["रात को दाल चावल", "raat ko dal chawal"],
      ["खाने के बाद", "khane ke baad"],
      ["दिन में दो बार", "din mein do baar"],
      ["इसके बारे में", "iske baare mein"],
      ["दूध के साथ", "doodh ke saath"],
      ["हाथ से खाया", "haath se khaya"],
      ["जान", "jaan"],
      ["बात", "baat"],
      ["काम के बाद", "kaam ke baad"],
      ["नाम", "naam"],
      ["शाम की चाय", "shaam ki chai"],
      ["एक साल", "ek saal"],
      ["पास", "paas"],
      ["चार रोटी, पांच बादाम, सात काजू", "chaar roti, paanch badam, saat kaju"],
      ["पाँच", "paanch"],
      ["गांव का खाना", "gaon ka khana"],
      ["गाँव", "gaon"],
    ]);
  });

  it("writes words people text with a vowel the rules would drop", () => {
    check([
      ["दोपहर का खाना", "dopahar ka khana"],
      ["खत्म", "khatam"],
      ["ख़त्म", "khatam"],
      ["खतम", "khatam"],
      ["ज़िंदगी", "zindagi"],
      ["जिंदगी", "zindagi"],
      ["जिन्दगी", "zindagi"],
      ["उड़द की दाल", "urad ki dal"],
    ]);
  });

  it("spells marker names said in Hindi as reports do, in a sentence", () => {
    check([
      ["मेरा विटामिन डी कम है", "mera vitamin D kam hai"],
      ["विटामिन डी3", "vitamin D3"],
      ["बी12 कम है क्या करूं", "B12 kam hai kya karun"],
      ["विटामिन बी12", "vitamin B12"],
      ["बी कॉम्प्लेक्स", "B complex"],
      ["मेरा हीमोग्लोबिन कम है", "mera hemoglobin kam hai"],
      ["हिमोग्लोबिन", "hemoglobin"],
      ["फेरिटिन कम है", "ferritin kam hai"],
      ["किडनी के लिए क्या खाऊं", "kidney ke liye kya khaun"],
      ["लिवर", "liver"],
      ["थायराइड की दवा", "thyroid ki dawa"],
      ["थायरॉइड", "thyroid"],
      ["कोलेस्ट्रॉल बढ़ा है", "cholesterol badha hai"],
      ["कोलेस्ट्रोल", "cholesterol"],
      ["शुगर लेवल", "sugar level"],
      ["यूरिक एसिड", "uric acid"],
      ["मैग्नीशियम और जिंक", "magnesium aur zinc"],
      ["एचडीएल कम, एलडीएल ज्यादा", "HDL kam, LDL jyada"],
      ["टीएसएच", "TSH"],
    ]);
  });

  it("spells English said in Hindi as English, in a sentence", () => {
    check([
      ["मल्टीविटामिन टैबलेट", "multivitamin tablet"],
      ["दो टेबलेट्स", "do tablets"],
      ["ब्राउन राइस", "brown rice"],
      ["चिकन ब्रेस्ट", "chicken breast"],
      ["गरम मसाला", "garam masala"],
      ["मसाले", "masale"],
      ["गैस बनती है", "gas banti hai"],
      ["कोल्ड ड्रिंक", "cold drink"],
      ["एनर्जी ड्रिंक", "energy drink"],
      ["फ़िल्टर कॉफी", "filter coffee"],
      ["व्हे प्रोटीन", "whey protein"],
      ["मिल्क", "milk"],
      ["मिल्कशेक", "milkshake"],
      ["प्रोटीन पाउडर", "protein powder"],
    ]);
  });

  it("reads two-word phrases together, and their words alone as Hindi", () => {
    check([
      ["वे प्रोटीन शेक", "whey protein shake"],
      ["वे  प्रोटीन", "whey protein"],
      ["वे लोग", "ve log"],
      ["एक प्रोटीन बार", "ek protein bar"],
      ["ग्रेनोला बार", "granola bar"],
      ["विटामिन सी और डी3", "vitamin C aur D3"],
      ["थोड़ी सी चीनी", "thodi si cheeni"],
      ["विटामिन सीधा", "vitamin seedha"],
      ["विटामिन ए", "vitamin A"],
      ["विटामिन ई", "vitamin E"],
    ]);
  });

  it("handles 'ye', nasal sounds, digits and full stops", () => {
    check([
      ["प्रोटीन के लिए दही जोड़ें।", "protein ke liye dahi joden."],
      ["चाहिए", "chahiye"],
      ["गए", "gaye"],
      ["रोटियाँ", "rotiyan"],
      ["हाँ", "haan"],
      ["नहीं", "nahi"],
      ["भिंडी", "bhindi"],
      ["२ रोटी", "2 roti"],
      ["खाना खाया ।", "khana khaya."],
    ]);
  });

  it("leaves Latin letters, numbers and other scripts alone", () => {
    assert.equal(romanize("2 roti aur 50 g dal"), "2 roti aur 50 g dal");
    assert.equal(romanize("2 रोटी, 1 katori (150 mL)"), "2 roti, 1 katori (150 mL)");
    assert.equal(romanize("இரண்டு இட்லி"), "இரண்டு இட்லி");
    assert.equal(romanize(""), "");
  });

  it("knows Devanagari when it sees it", () => {
    assert.ok(hasDevanagari("2 रोटी"));
    assert.equal(hasDevanagari("2 roti"), false);
    assert.equal(hasDevanagari("ਦੋ ਰੋਟੀਆਂ"), false);
  });
});

// Since 2026-11-22 (later) Hinglish listens in hi-IN again: everything a Hinglish pick says
// comes through romanize(), so what hi-IN writes for spoken meals and questions has to read
// the way people text it. en-IN had written "do sau gram chawal" as "Dosa gram chawal".
describe("Hinglish heard in hi-IN", () => {
  it("reads every transcript in the corpus, and the held-out set, the way people text it", () => {
    for (const t of [...TRANSCRIPTS, ...HELD_OUT]) {
      const r = readsNaturally(romanize(t.hi), t.want);
      assert.ok(r.ok, `${t.id}: ${t.hi} → ${romanize(t.hi)} (${r.why})`);
    }
  });

  it("writes Mayank's two meals right", () => {
    check([
      ["300 ग्राम चावल और चिकन", "300 gram chawal aur chicken"],
      ["एक कटोरी दाल और दो सौ ग्राम चावल", "ek katori dal aur do sau gram chawal"],
    ]);
  });

  it("writes numbers, fractions and units as people say them", () => {
    check([
      ["ढाई सौ ग्राम", "dhai sau gram"],
      ["डेढ़ कटोरी", "dedh katori"],
      ["साढ़े तीन सौ एमएल", "sadhe teen sau ml"],
      ["300 एम एल छाछ", "300 ml chhachh"],
      ["सवा सौ ग्राम", "sawa sau gram"],
      ["आधा किलो", "aadha kilo"],
      ["एक केजी", "ek kg"],
      ["पांच ग्राम क्रिएटिन", "paanch gram creatine"],
    ]);
  });

  it("reads a word by its neighbour where it means two things", () => {
    check([
      ["पाव किलो चिकन", "paav kilo chicken"],
      ["पाव भाजी", "pav bhaji"],
      ["लो कार्ब डाइट", "low carb diet"],
      ["दवा लो", "dawa lo"],
      ["चिकन करी", "chicken curry"],
      ["एग करी", "egg curry"],
      ["पोस्ट वर्कआउट मील", "post workout meal"],
      ["दो मील चला", "do meel chala"],
      ["चीज़ सैंडविच", "cheese sandwich"],
      ["कोई चीज़ नहीं", "koi cheez nahi"],
    ]);
  });

  it("keeps the word list's keys findable and its values in Latin letters, without digits", () => {
    for (const [key, value] of Object.entries(ROMAN_WORDS)) {
      assert.match(key, /^[ऀ-ॣॱ-ॿ]+$/, `${key}: one Devanagari word`);
      assert.doesNotMatch(key, /[़ँ]/, `${key}: no nukta or ँ, as lookups have none`);
      assert.doesNotMatch(value, /[0-9ऀ-ॿ]/, `${key} → ${value}`);
    }
    for (const [key, value] of Object.entries(ROMAN_PHRASES)) {
      assert.match(key, /^[ऀ-ॣॱ-ॿ]+(?: [ऀ-ॣॱ-ॿ]+)+$/, `${key}: words with one space`);
      assert.doesNotMatch(key, /[़ँ]/, `${key}: no nukta or ँ`);
      assert.doesNotMatch(value, /[0-9ऀ-ॿ]/, `${key} → ${value}`);
      assert.equal(romanize(key), value, `${key} matches itself`);
    }
  });
});

// The three things romanize() never does, on seeded random text: words from the corpus, the
// word list and random Devanagari, mixed with Latin words, digits, punctuation and spaces.
describe("what romanize never does", () => {
  // mulberry32: the same strings every run, so a failure can be reproduced.
  function random(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = random(20261122);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const corpusWords = [...new Set([...TRANSCRIPTS, ...HELD_OUT].flatMap((t) => t.hi.split(/\s+/)).filter(hasDevanagari))];
  const listWords = [...Object.keys(ROMAN_WORDS), ...Object.keys(ROMAN_PHRASES)];
  // Any code point in the Devanagari block except dandas, so the piecewise check below holds.
  const anyDevanagari = () =>
    Array.from({ length: 1 + Math.floor(rand() * 6) }, () => {
      const c = 0x0900 + Math.floor(rand() * 0x80);
      return c === 0x0964 || c === 0x0965 ? "क" : String.fromCodePoint(c);
    }).join("");
  const latinWords = ["2", "200", "1.5", "KFC", "Domino's", "protein", "shake", "50%", "₹49", "café", "café", "B12", "x2", "(150 mL)", "-", "/", "😀", "naïve", "e.g.", "100g"];
  const digits = () =>
    Array.from({ length: 1 + Math.floor(rand() * 4) }, () => (rand() < 0.5 ? String(Math.floor(rand() * 10)) : String.fromCodePoint(0x0966 + Math.floor(rand() * 10)))).join("");
  const space = () => pick([" ", " ", " ", "  ", "\n", "\t", ", ", "? "]);
  const sample = (n: number) =>
    Array.from({ length: n }, () => {
      const r = rand();
      return r < 0.3 ? pick(corpusWords) : r < 0.5 ? pick(listWords) : r < 0.6 ? anyDevanagari() : r < 0.85 ? pick(latinWords) : digits();
    }).join(space());
  const texts = Array.from({ length: 3000 }, () => sample(1 + Math.floor(rand() * 10)));

  // A stretch of Devanagari with the spaces inside it, as phrases span them.
  const RUN = /[ऀ-ॿ‌‍]+(?:\s+[ऀ-ॿ‌‍]+)*/g;
  const digitsOf = (s: string) =>
    [...s]
      .filter((c) => /[0-9०-९]/.test(c))
      .map((c) => (c >= "०" && c <= "९" ? String(c.charCodeAt(0) - 0x0966) : c))
      .join("");

  it("never changes Latin text: only the Devanagari in it is rewritten", () => {
    for (const t of texts) assert.equal(romanize(t), t.replace(RUN, (run) => romanize(run)), JSON.stringify(t));
    for (const t of latinWords) assert.equal(romanize(t), t);
    assert.equal(romanize("café और चाय"), "café aur chai", "a decomposed é stays decomposed");
  });

  it("never loses or reorders a digit", () => {
    for (const t of texts) assert.equal(digitsOf(romanize(t)), digitsOf(t), JSON.stringify(t));
  });

  it("never leaves Devanagari behind", () => {
    for (const t of texts) assert.equal(hasDevanagari(romanize(t)), false, JSON.stringify(t));
    for (const t of ["दो रोटी।", "खाना॥", "२॰५", "ॐ", "ऽ", "क्‍ष"]) assert.equal(hasDevanagari(romanize(t)), false, t);
  });

  it("never reads दो सौ as anything but do sau", () => {
    for (let i = 0; i < 500; i++) {
      const before = sample(Math.floor(rand() * 4));
      const after = sample(Math.floor(rand() * 4));
      const out = romanize(`${before} दो सौ ${after}`.trim());
      assert.match(out, /(?:^|\s)do sau(?:\s|$)/, JSON.stringify(out));
    }
    check([
      ["दो सौ", "do sau"],
      ["दो  सौ ग्राम", "do  sau gram"],
      ["दो सौ।", "do sau."],
      ["२ सौ ग्राम", "2 sau gram"],
      ["दो सौ पचास ग्राम चावल", "do sau pachas gram chawal"],
      ["ढाई सौ", "dhai sau"],
    ]);
  });
});
