// Devanagari in Latin letters the way people text Hindi (lib/domain/romanize.ts): the safety
// net for a Hinglish pick that still comes back in Devanagari.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasDevanagari, romanize } from "../lib/domain/romanize.ts";

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
