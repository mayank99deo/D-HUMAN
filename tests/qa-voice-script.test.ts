// QA on the voice-script changes (2026-11-22: 36909be, 3cecad8, d1783dd). Hinglish now listens
// in en-IN, and lib/domain/romanize.ts turns Devanagari into Latin letters for English and
// Hinglish picks (Fuel's Say card, Ask's mic, meal replies). These pin what holds, and mark
// with `todo` what QA found broken: the romanizer now sits in front of Ask's code-only safety
// lists, and en-IN writes Hindi crisis words in Latin letters the lists don't cover. Remove a
// `todo` once its fix lands; the test then has to pass.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { romanize } = await import("../lib/domain/romanize.ts");
const { mealWords, replyInScript, settleReply, spokenById } = await import("../lib/domain/speech.ts");
const { crisisMatch, emergencyMatch, asksVeryLittleFood, touchedFlags } = await import("../lib/domain/ask-floor.ts");
const { heardInScript } = await import("../components/platform/listen-state.ts");

const DEVANAGARI = /[ऀ-ॿ]/;

// A small seeded generator, so the fuzz is the same on every run.
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("romanize never throws and never leaves Devanagari", () => {
  it("odd input: empty, spaces, emoji, lone signs, joiners, nukta clusters", () => {
    for (const s of ["", "   ", "🍛🍛 दाल 🙂", "्", "ािीु", "क्", "ॐ", "ऽ", "क़्ख़्ग़", "‍‌रोटी‍", "।।", "०१२३"]) {
      const out = romanize(s);
      assert.equal(typeof out, "string", JSON.stringify(s));
      assert.equal(DEVANAGARI.test(out), false, `${JSON.stringify(s)} -> ${JSON.stringify(out)}`);
    }
  });

  it("20,000 random strings from the whole Devanagari block, with spaces, joiners and emoji", () => {
    const rand = prng(20261122);
    for (let n = 0; n < 20_000; n++) {
      let s = "";
      const len = Math.floor(rand() * 24);
      for (let k = 0; k < len; k++) {
        const r = rand();
        s += r < 0.8 ? String.fromCharCode(0x0900 + Math.floor(rand() * 128)) : r < 0.88 ? " " : r < 0.94 ? "‍" : String.fromCodePoint(0x1f600 + Math.floor(rand() * 50));
      }
      const out = romanize(s);
      assert.equal(DEVANAGARI.test(out), false, `${JSON.stringify(s)} -> ${JSON.stringify(out)}`);
      assert.doesNotMatch(out, /undefined|NaN|null/, JSON.stringify(s));
    }
  });

  it("very long input stays fast (a 1,000-character meal box many times over)", () => {
    const long = "दो रोटी और चने की सब्जी ".repeat(5000);
    const t0 = performance.now();
    const out = romanize(long);
    assert.ok(performance.now() - t0 < 1000);
    assert.equal(DEVANAGARI.test(out), false);
    assert.equal(romanize("क्".repeat(20_000) + "क").length > 0, true);
  });
});

describe("romanize leaves marker names, units and numbers alone", () => {
  it("Latin inside mixed text is untouched; Devanagari digits become digits", () => {
    assert.equal(romanize("HbA1c 6.1% है"), "HbA1c 6.1% hai");
    assert.equal(romanize("TSH 4.5 mIU/L"), "TSH 4.5 mIU/L");
    assert.equal(romanize("Vitamin D3 60000 IU सप्ताह में एक बार"), "Vitamin D3 60000 IU saptah mein ek baar");
    assert.equal(romanize("B12 200 pg/mL है"), "B12 200 pg/mL hai");
    assert.equal(romanize("२ रोटी, १ कटोरी दाल (१५० ग्राम)"), "2 roti, 1 katori dal (150 gram)");
    assert.equal(romanize("१२.५ ग्राम"), "12.5 gram");
  });

  it("a Hinglish meal reply loses its Devanagari but keeps marker names, units and numbers", () => {
    const reply = {
      title: "आपका खाना: दाल रोटी",
      tip: "Vitamin D 600 IU और B12 2.4 mcg के लिए दही जोड़ें। HbA1c 5.7% ठीक है।",
      items: [{ name: "दाल", portion: "1 कटोरी (150 g)" }, { name: "Roti", portion: "2 pieces" }],
    };
    const hl = replyInScript(reply, spokenById("hinglish"));
    assert.equal(hl.title, "Aapka khana: dal roti");
    assert.equal(hl.tip, "Vitamin D 600 IU aur B12 2.4 mcg ke liye dahi joden. HbA1c 5.7% theek hai.");
    assert.deepEqual(hl.items, [{ name: "dal", portion: "1 katori (150 g)" }, { name: "Roti", portion: "2 pieces" }]);
    // हिंदी and other scripts are left as they are.
    assert.deepEqual(replyInScript(reply, spokenById("hi")), reply);
    assert.deepEqual(replyInScript(reply, spokenById("ta")), reply);
  });
});

describe("the pick decides the meal reply's script", () => {
  it("voice + Hinglish + Devanagari words: Hinglish, and the Say card shows Latin", () => {
    const w = mealWords({ text: "दो रोटी और चने की सब्जी", spoken: "hinglish", appLanguage: "en" });
    assert.equal(w.byPick, true);
    assert.equal(settleReply("hi", w).id, "hinglish");
    const h = heardInScript({ final: "दो रोटी और चने की सब्जी", interim: " खाई" }, spokenById("hinglish"));
    assert.equal(h.final + h.interim, "do roti aur chane ki sabji khai");
  });

  it("voice + हिंदी + Latin words: Hindi, whatever the model says; the card keeps the words", () => {
    const w = mealWords({ text: "do roti aur dal", spoken: "hi", appLanguage: "en" });
    assert.equal(settleReply("hinglish", w).id, "hi");
    const raw = { final: "दो रोटी", interim: "" };
    assert.equal(heardInScript(raw, spokenById("hi")), raw);
  });

  it("typed words ignore a spoken pick (the route only passes it for voice)", () => {
    const typed = mealWords({ text: "दो रोटी और दाल", spoken: null, appLanguage: "hinglish" });
    assert.equal(typed.byPick, false);
    assert.equal(settleReply("hi", typed).id, "hi");
  });
});

// ── Found by QA: the safety lists after the script change ─────────────────
// Ask's code-only crisis, emergency and low-food checks (lib/domain/ask-floor.ts) list Hindi in
// Devanagari and Hinglish in Latin letters. Before 36909be a Hinglish pick listened in hi-IN, so a
// spoken "आत्महत्या" reached them in Devanagari and was caught by code. Now (a) Hinglish listens in
// en-IN, which writes Latin letters, and (b) when a browser still writes Devanagari, Ask's mic
// romanizes it before it reaches the box. Neither Latin form is on the lists. The model's own
// crisis label is still the second net; these are about code's first net.

describe("QA: Ask's crisis net after romanizing (todo until fixed)", () => {
  const caughtInDevanagari = ["मैं आत्महत्या करना चाहता हूँ", "आत्महत्या के बारे में सोच रहा हूं", "जान दे दूंगा", "खुद को खत्म कर दूंगी", "उल्टी करके वजन कम करना है"];

  it("each of these is caught in Devanagari today (the baseline)", () => {
    for (const q of caughtInDevanagari) assert.equal(crisisMatch(q), true, q);
  });

  it("the same words, romanized by Ask's mic for an English or Hinglish pick, are still caught", { todo: "crisis list has no Latin form the romanizer writes: aatmahatya, jan de doonga, khatm, ulti karke vajan" }, () => {
    const missed = caughtInDevanagari.filter((q) => !crisisMatch(romanize(q))).map((q) => `${q} -> ${romanize(q)}`);
    assert.deepEqual(missed, []);
  });

  it("Hinglish as en-IN writes it is caught", { todo: "no Latin 'aatmahatya'/'atmahatya', 'jaan dena', 'khatam kar' patterns in CRISIS" }, () => {
    const missed = ["main aatmahatya karna chahta hoon", "main atmahatya karna chahta hu", "aatmhatya ke baare mein soch raha hu", "jaan dena chahta hoon"].filter((q) => !crisisMatch(q));
    assert.deepEqual(missed, []);
  });

  it("emergencies survive romanizing (these hold today)", () => {
    for (const q of ["सीने में दर्द हो रहा है", "छाती में दर्द है", "सांस नहीं आ रही", "मैं बेहोश हो गया था", "दिल का दौरा पड़ा क्या"]) {
      assert.equal(emergencyMatch(q), true, q);
      assert.equal(emergencyMatch(romanize(q)), true, romanize(q));
    }
  });

  it("'only one meal a day' survives romanizing", { todo: "VERY_LITTLE_FOOD has सिर्फ एक बार खाना in Devanagari but no 'sirf ek bar khana'" }, () => {
    const q = "सिर्फ एक बार खाना खाऊं क्या";
    assert.equal(asksVeryLittleFood(q), true);
    assert.equal(asksVeryLittleFood(romanize(q)), true, romanize(q));
  });

  it("a flagged marker named in Hindi is still found after romanizing", () => {
    const flagged = [
      { key: "vitamin_d", name: "Vitamin D", status: "low" as const, flag: "doctor" as const },
      { key: "b12", name: "Vitamin B12", status: "low" as const, flag: "doctor" as const },
      { key: "hemoglobin", name: "Haemoglobin", status: "low" as const, flag: "urgent" as const },
      { key: "ferritin", name: "Ferritin", status: "low" as const, flag: "doctor" as const },
      { key: "egfr", name: "eGFR", status: "low" as const, flag: "urgent" as const },
    ];
    const pairs = [
      ["मेरा विटामिन डी कम है", "vitamin_d"],
      ["बी12 कम है क्या करूं", "b12"],
      ["मेरा हीमोग्लोबिन कम है", "hemoglobin"],
      ["फेरिटिन कम है", "ferritin"],
      ["किडनी के लिए क्या खाऊं", "egfr"],
    ] as const;
    for (const [q, key] of pairs) {
      assert.equal(touchedFlags(q, flagged, { related: true }).some((f) => f.key === key), true, q);
      assert.equal(touchedFlags(romanize(q), flagged, { related: true }).some((f) => f.key === key), true, romanize(q));
    }
  });
});
