// Hindi in Devanagari, written out in Latin letters the way people text it in India
// (Hinglish), not a scholarly transliteration: "दो रोटी और चने की सब्जी" becomes
// "do roti aur chane ki sabji". Hinglish listens in hi-IN, which hears Hindi right and writes
// it in Devanagari, so every spoken Hinglish meal and Ask question goes through here before
// anyone sees it (fitScript in lib/domain/speech.ts). It also catches a meal reply in the
// wrong script. tests/fixtures/hinglish-transcripts.ts is how it's judged.
//
// Three things never change: Latin text stays as it is, digits stay in order (Devanagari
// digits become 0–9), and number words stay words ("दो सौ ग्राम" is "do sau gram", never a
// dosa). Nothing comes out in Devanagari.
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
// - A list of common words is spelt the way people write them: everyday words the rules
//   get wrong ("raat", not "rat"), and food, portion, gym, health and app words, most of
//   them English said in Hindi ("चिकन", "प्रोटीन", "वर्कआउट", "एमएल"), including marker
//   names, so Ask can still tell which marker a romanized question is about ("विटामिन डी"
//   is "vitamin D"). English the rules can't spell (ै for the "a" in "snack", "-ed" and
//   "-ing" endings, letters said one by one) is on the list, or it comes out odd.
// - A few two-word phrases go first, where a word means something else alone: वे is "they"
//   but "वे प्रोटीन" is whey protein; बार is "baar" (times) but "प्रोटीन बार" a protein bar;
//   लो is "lo" (take) but "लो कार्ब" low carb; करी is "kari" but "चिकन करी" chicken curry.
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
// Output is lowercase except letter names and short forms ("D", "B12", "HDL").
const WORDS: Record<string, string> = {
  // Hindi words the rules would spell oddly.
  आलू: "aloo", घी: "ghee", में: "mein", हां: "haan", नहीं: "nahi", हूं: "hoon", मां: "maa",
  नान: "naan", चाट: "chaat", साग: "saag", चाय: "chai", पुलाव: "pulao", कचौरी: "kachori",
  पकौडा: "pakoda", पकोडा: "pakoda", पकौडे: "pakode", पकोडे: "pakode", मूंगफली: "moongfali",
  वाला: "wala", वाली: "wali", वाले: "wale",
  // Short words with a long "a" that people text as "aa" ("raat", not "rat"). Food names
  // keep one "a" ("dal", "pav"), as the rules write them.
  रात: "raat", बाद: "baad", बार: "baar", बारे: "baare", साथ: "saath", हाथ: "haath", जान: "jaan", बात: "baat",
  काम: "kaam", नाम: "naam", शाम: "shaam", साल: "saal", पास: "paas", चार: "chaar",
  पांच: "paanch", सात: "saat", गांव: "gaon",
  // Words people text with a vowel the rules drop, or a letter they write differently.
  दोपहर: "dopahar", खत्म: "khatam", जिंदगी: "zindagi", जिन्दगी: "zindagi", उडद: "urad",
  // Marker and health words said in Hindi, spelt as the report spells them, so Ask still
  // finds the marker a romanized question names ("बी12" is "B12": the digits stay apart).
  डी: "D", बी: "B", हीमोग्लोबिन: "hemoglobin", हिमोग्लोबिन: "hemoglobin", फेरिटिन: "ferritin",
  किडनी: "kidney", लिवर: "liver", लीवर: "liver", थायराइड: "thyroid", थायरॉइड: "thyroid",
  थाइरॉइड: "thyroid", थायरॉयड: "thyroid", थायरायड: "thyroid", कोलेस्ट्रॉल: "cholesterol",
  कोलेस्ट्रोल: "cholesterol", कोलेस्ट्राल: "cholesterol", मैग्नीशियम: "magnesium",
  मैग्नेशियम: "magnesium", सोडियम: "sodium", पोटैशियम: "potassium", पोटेशियम: "potassium",
  जिंक: "zinc", यूरिक: "uric", एसिड: "acid", फोलिक: "folic", फोलेट: "folate", यूरिया: "urea",
  क्रिएटिनिन: "creatinine", ग्लूकोज: "glucose", प्लेटलेट: "platelet", प्लेटलेट्स: "platelets",
  ट्राइग्लिसराइड: "triglyceride", ट्राइग्लिसराइड्स: "triglycerides", टेस्टोस्टेरोन: "testosterone",
  एनीमिया: "anemia", डायबिटीज: "diabetes", एचडीएल: "HDL", एलडीएल: "LDL", टीएसएच: "TSH", बीपी: "BP",
  लेवल: "level", लेवल्स: "levels", मल्टीविटामिन: "multivitamin", मल्टी: "multi",
  टैबलेट: "tablet", टेबलेट: "tablet", टैबलेट्स: "tablets", टेबलेट्स: "tablets",
  सप्लीमेंट: "supplement", सप्लीमेंट्स: "supplements", कैप्सूल: "capsule", डोज: "dose",
  कॉम्प्लेक्स: "complex", मिनरल्स: "minerals", फैट: "fat", कार्ब्स: "carbs", फाइबर: "fibre", गैस: "gas",
  // English said in Hindi, as hi-IN speech recognition writes it.
  चिकन: "chicken", मटन: "mutton", एग: "egg", एग्स: "eggs", ऑमलेट: "omelette", आमलेट: "omelette",
  प्रोटीन: "protein", व्हे: "whey", व्हेय: "whey", वेय: "whey", शेक: "shake", मिल्कशेक: "milkshake",
  राइस: "rice", ब्राउन: "brown", ब्रेस्ट: "breast", ब्रेड: "bread", कोल्ड: "cold", कोल्डड्रिंक: "cold drink",
  एनर्जी: "energy", फिल्टर: "filter", पाउडर: "powder", फ्रूट: "fruit", फ्रूट्स: "fruits",
  योगर्ट: "yogurt", मल्टीग्रेन: "multigrain", ब्लैक: "black", फ्री: "free", ग्रेनोला: "granola",
  मैकरोनी: "macaroni", फ्लैक्स: "flax", चिया: "chia",
  बटर: "butter", ओट्स: "oats", जूस: "juice", सूप: "soup", कॉफी: "coffee", टी: "tea",
  बिस्कुट: "biscuit", बिस्किट: "biscuit", केक: "cake", बर्गर: "burger", पिज्जा: "pizza",
  नूडल्स: "noodles", सैंडविच: "sandwich", फ्राइड: "fried", फ्राई: "fry", मैगी: "maggi",
  चॉकलेट: "chocolate", आइसक्रीम: "ice cream", पीनट: "peanut", कॉर्नफ्लेक्स: "cornflakes",
  स्प्राउट्स: "sprouts", कप: "cup", ग्लास: "glass", प्लेट: "plate", बाउल: "bowl", स्लाइस: "slice", पीस: "piece",
  लीटर: "litre", कैलोरी: "calorie", कैलोरीज: "calories", कैल्शियम: "calcium", आयरन: "iron",
  शुगर: "sugar", डॉक्टर: "doctor", ब्लड: "blood", रिपोर्ट: "report", जिम: "gym", डाइट: "diet",
  // Everyday words people text one way: "pehle", "roz".
  पहले: "pehle", पहला: "pehla", पहली: "pehli", रोज: "roz",
  // Food, drink and cooking words said in English.
  एप्पल: "apple", ऐपल: "apple", एपल: "apple", ऑरेंज: "orange", मैंगो: "mango", ग्रेप्स: "grapes",
  स्ट्रॉबेरी: "strawberry", ब्लूबेरी: "blueberry", एवोकाडो: "avocado", कीवी: "kiwi", डेट्स: "dates",
  ब्रोकली: "broccoli", ब्रोकोली: "broccoli", मशरूम: "mushroom", मशरूम्स: "mushrooms", बीन्स: "beans",
  लेमन: "lemon", प्रॉन: "prawn", प्रॉन्स: "prawns", चंक्स: "chunks", ऑयल: "oil", ऑइल: "oil", ऑलिव: "olive",
  कोक: "coke", स्प्राइट: "sprite", बियर: "beer", वाइन: "wine", व्हिस्की: "whisky", रम: "rum",
  लाटे: "latte", कैपुचीनो: "cappuccino", कैपेचीनो: "cappuccino", एस्प्रेसो: "espresso", स्मूदी: "smoothie",
  हॉर्लिक्स: "horlicks", बॉर्नविटा: "bournvita", इलेक्ट्रॉल: "electral",
  कुकी: "cookie", कुकीज: "cookies", पेस्ट्री: "pastry", ब्राउनी: "brownie", डोनट: "donut", पॉपकॉर्न: "popcorn",
  नगेट्स: "nuggets", फ्राइज: "fries", फ्राईज: "fries", रैप: "wrap", रैप्स: "wraps", रोल: "roll",
  मोमोज: "momos", मोमोस: "momos", चाउमीन: "chowmein", चौमीन: "chowmein", मंचूरियन: "manchurian",
  म्यूसली: "muesli", मूसली: "muesli", टोस्ट: "toast", जैम: "jam", पैनकेक: "pancake",
  सॉस: "sauce", केचप: "ketchup", मेयोनीज: "mayonnaise", मेयो: "mayo", क्रीम: "cream",
  व्हाइट: "white", ग्रिल: "grill", ग्रिल्ड: "grilled", बॉयल: "boil", बॉइल: "boil", बॉयल्ड: "boiled", बॉइल्ड: "boiled",
  रोस्ट: "roast", रोस्टेड: "roasted", स्टीम्ड: "steamed", बेक्ड: "baked", प्लेन: "plain", स्पाइसी: "spicy",
  वेज: "veg", नॉनवेज: "nonveg", वेजिटेरियन: "vegetarian", वेजीटेरियन: "vegetarian", वीगन: "vegan", विगन: "vegan",
  लंच: "lunch", डिनर: "dinner", ब्रेकफास्ट: "breakfast", स्नैक: "snack", स्नैक्स: "snacks", वीकेंड: "weekend",
  विद: "with", विथ: "with", विदाउट: "without", एंड: "and", प्लस: "plus", हाफ: "half", फुल: "full", डबल: "double",
  सिंगल: "single", एक्स्ट्रा: "extra", लार्ज: "large", मीडियम: "medium", स्मॉल: "small", रेगुलर: "regular",
  होममेड: "homemade", मिक्स: "mix", होल: "whole", व्हीट: "wheat", गार्लिक: "garlic", डाइजेस्टिव: "digestive",
  रस्क: "rusk", हेल्दी: "healthy", चीट: "cheat", प्री: "pre",
  // "maik" read as makki (corn) in the live check: mac and cheese came back as makki roti.
  मैक: "mac", मैकडॉनल्ड्स: "mcdonald's", मैकडोनाल्ड्स: "mcdonald's", मैकडी: "mcd",
  // Units, and short forms said letter by letter.
  स्कूप: "scoop", स्कूप्स: "scoops", कप्स: "cups", प्लेट्स: "plates", पीसेस: "pieces", स्लाइसेस: "slices",
  टेबलस्पून: "tablespoon", टीस्पून: "teaspoon", पैकेट: "packet", बॉटल: "bottle", मग: "mug",
  एमएल: "ml", मिलीलीटर: "ml", केजी: "kg", एमजी: "mg", एमसीजी: "mcg", आईयू: "IU", ओआरएस: "ORS",
  // Gym, health and app words said in English.
  वर्कआउट: "workout", वर्क: "work", आउट: "out", क्रिएटिन: "creatine", क्रिएटीन: "creatine", क्रेटिन: "creatine",
  ट्रेनिंग: "training", कार्डियो: "cardio", वॉक: "walk", वॉकिंग: "walking", रन: "run", रनिंग: "running",
  साइकलिंग: "cycling", साइक्लिंग: "cycling", स्विमिंग: "swimming", एक्सरसाइज: "exercise", डेडलिफ्ट: "deadlift",
  स्क्वाट: "squat", स्क्वैट: "squat", पुशअप: "pushup", पुशअप्स: "pushups", मैराथन: "marathon", रेस: "race",
  मसल: "muscle", मसल्स: "muscles", गेन: "gain", लॉस: "loss", वेट: "weight", सेफ: "safe", हाई: "high",
  रिकवरी: "recovery", इंजरी: "injury", कार्ब: "carb", कार्बोहाइड्रेट: "carbohydrate", मेडिसिन: "medicine",
  प्रेग्नेंट: "pregnant", प्रेगनेंट: "pregnant", प्रेग्नेंसी: "pregnancy", प्रेगनेंसी: "pregnancy",
  पीरियड: "period", पीरियड्स: "periods", पीसीओडी: "PCOD", पीसीओएस: "PCOS", बीएमआई: "BMI", एचबी: "Hb",
  सीबीसी: "CBC", ईसीजी: "ECG",
  ऐप: "app", स्टैक: "stack", अपलोड: "upload", कंट्रोल: "control", फ्यूल: "fuel", लॉगिन: "login",
  सेटिंग्स: "settings", पेमेंट: "payment",
};

// Two words read together, where one of them means something else alone (वे is "they", सी
// "like", बार "times", लो "take", करी "did", पाव the bread). Keys are written like word-list
// keys, with one space and no nukta or ँ; they match with or without them.
const PHRASES: Record<string, string> = {
  "वे प्रोटीन": "whey protein",
  "प्रोटीन बार": "protein bar",
  "ग्रेनोला बार": "granola bar",
  "चॉकलेट बार": "chocolate bar",
  "विटामिन ए": "vitamin A",
  "विटामिन सी": "vitamin C",
  "विटामिन ई": "vitamin E",
  // Letters said one by one.
  "एम एल": "ml",
  "एम जी": "mg",
  // पाव as a quarter, not the bread.
  "पाव किलो": "paav kilo",
  "पाव भर": "paav bhar",
  "पाव लीटर": "paav litre",
  "लो कार्ब": "low carb",
  "लो फैट": "low fat",
  "लो शुगर": "low sugar",
  "लो कैलोरी": "low calorie",
  "लो बीपी": "low BP",
  "चिकन करी": "chicken curry",
  "एग करी": "egg curry",
  "अंडा करी": "anda curry",
  "मटन करी": "mutton curry",
  "फिश करी": "fish curry",
  "वेज करी": "veg curry",
  "पनीर करी": "paneer curry",
  "करी पत्ता": "curry patta",
  "करी पत्ते": "curry patte",
  "चीज सैंडविच": "cheese sandwich",
  "चीज टोस्ट": "cheese toast",
  "चीज पिज्जा": "cheese pizza",
  "चीज बर्गर": "cheese burger",
  "चीज स्लाइस": "cheese slice",
  // मील alone is a mile.
  "वर्कआउट मील": "workout meal",
  "चीट मील": "cheat meal",
  "हेल्दी मील": "healthy meal",
  "मील प्लान": "meal plan",
  "मील प्रेप": "meal prep",
};

// A Devanagari word: letters and signs, and joiners inside them, but not dandas or digits.
const LETTERS = "ऀ-ॣॱ-ॿ‌‍";
const WORD = new RegExp(`[${LETTERS}]+`, "g");

const lookupKey = (word: string) => word.replaceAll(CHANDRABINDU, ANUSVARA).replaceAll(NUKTA, "").replace(/[‌‍]/g, "");

// A phrase key as a pattern: any spacing between its words, a nukta allowed after any
// consonant, and ँ wherever it has ं, so "चीज़ सैंडविच" finds "चीज सैंडविच" as word lookups do.
const loose = (key: string) =>
  [...key].map((c) => (c === " " ? "\\s+" : c === ANUSVARA ? `[${ANUSVARA}${CHANDRABINDU}]` : c in CONSONANTS ? `${c}${NUKTA}?` : c)).join("");
// Any of the phrases as whole words, longest first.
const PHRASE = new RegExp(
  `(?<![${LETTERS}])(?:${Object.keys(PHRASES)
    .sort((a, b) => b.length - a.length)
    .map(loose)
    .join("|")})(?![${LETTERS}])`,
  "g",
);

/** The word list and the phrases, for tests: no value may hold a digit or Devanagari. */
export const ROMAN_WORDS: Readonly<Record<string, string>> = WORDS;
export const ROMAN_PHRASES: Readonly<Record<string, string>> = PHRASES;

/** True when the text has any Devanagari in it. */
export const hasDevanagari = (text: string) => /[ऀ-ॿ]/.test(text);

/**
 * Devanagari in Latin letters, the way people text Hindi; everything else is left as it
 * is. Lowercase, except letter names and short forms ("vitamin D", "HDL"): callers that
 * want a capital (a title) add it.
 */
export function romanize(text: string): string {
  if (!hasDevanagari(text)) return text;
  return (
    text
      // NFC splits क़, ज़, फ़ (and the rest of U+0958–U+095F) into a letter and a nukta.
      // Only Devanagari is normalized, so Latin text keeps every code point it came with.
      .replace(/[ऀ-ॿ‌‍]+/g, (run) => run.normalize("NFC"))
      .replace(PHRASE, (phrase) => PHRASES[lookupKey(phrase).replace(/\s+/g, " ")])
      .replace(WORD, (word) => WORDS[lookupKey(word)] ?? spellWord(word))
      .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
      .replace(/\s*[।॥]+/g, ".")
      .replace(/॰/g, ".")
  );
}
