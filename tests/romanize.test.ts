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
