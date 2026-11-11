// Meals in any Indian language: which language a reply comes back in, what the
// browser translates, what the server makes of the words, and what Claude is asked.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";
import {
  SPOKEN,
  SPOKEN_IDS,
  mealWords,
  replyLanguage,
  scriptLanguage,
  spokenById,
  spokenForAppLanguage,
  translateSource,
  type SpokenId,
} from "../lib/domain/speech.ts";

allowAppImports();
const { languageRule } = await import("../lib/ai/client.ts");
const { mealPrompt } = await import("../lib/ai/food.ts");

describe("the language list", () => {
  it("has one entry per id and valid speech tags", () => {
    assert.equal(new Set(SPOKEN_IDS).size, SPOKEN.length);
    for (const s of SPOKEN) assert.doesNotThrow(() => Intl.getCanonicalLocales(s.speech), s.speech);
  });
  it("shows each Indian language's label in its own script", () => {
    for (const s of SPOKEN.filter((s) => s.translateFrom)) {
      const found = scriptLanguage(s.label);
      assert.ok(found, `${s.name} label has no Indian script`);
      assert.equal(spokenById(found).script, s.script, s.name);
    }
  });
  it("starts from the app language", () => {
    assert.equal(spokenForAppLanguage("hi"), "hi");
    assert.equal(spokenForAppLanguage("hinglish"), "hinglish");
    assert.equal(spokenForAppLanguage("en"), "en");
    assert.equal(spokenForAppLanguage(null), "en");
  });
});

describe("reply language", () => {
  it("answers a spoken meal in the language chosen for speaking", () => {
    assert.equal(replyLanguage("दो रोटी", { spoken: "mr", appLanguage: "en" }), "mr");
    assert.equal(replyLanguage("two rotis", { spoken: "ta", appLanguage: "hi" }), "ta");
  });
  it("ignores a language it doesn't know", () => {
    assert.equal(replyLanguage("இட்லி", { spoken: "xx" as SpokenId }), "ta");
  });
  it("answers typed words in the language of their script", () => {
    const cases: [string, SpokenId][] = [
      ["দুটো রুটি আর ডাল", "bn"],
      ["இரண்டு இட்லி, சாம்பார்", "ta"],
      ["రెండు దోసెలు", "te"],
      ["બે રોટલી અને દાળ", "gu"],
      ["ಎರಡು ಇಡ್ಲಿ", "kn"],
      ["രണ്ട് ദോശ", "ml"],
      ["ਦੋ ਰੋਟੀਆਂ ਤੇ ਦਾਲ", "pa"],
      ["دو روٹی اور دال", "ur"],
      ["दो रोटी और दाल", "hi"],
    ];
    for (const [text, id] of cases) assert.equal(replyLanguage(text, { appLanguage: "en" }), id, text);
  });
  it("keeps Hinglish people in Hinglish when they type Devanagari", () => {
    assert.equal(replyLanguage("दो रोटी", { appLanguage: "hinglish" }), "hinglish");
  });
  it("keeps the app language for Latin script and for no words, as before", () => {
    assert.equal(replyLanguage("2 rotis and dal", { appLanguage: "en" }), "en");
    assert.equal(replyLanguage("do roti aur dal", { appLanguage: "hinglish" }), "hinglish");
    assert.equal(replyLanguage("do roti aur dal", { appLanguage: "hi" }), "hi");
    assert.equal(replyLanguage("", { appLanguage: "hi" }), "hi");
  });
  it("falls back to English when nothing can be judged", () => {
    assert.equal(replyLanguage("2 🍌"), "en");
    assert.equal(replyLanguage("", { appLanguage: "fr" }), "en");
  });
});

describe("what the browser translates", () => {
  it("leaves English and Hinglish alone", () => {
    assert.equal(translateSource("2 rotis and dal"), null);
    assert.equal(translateSource("do roti aur dal", "hi"), null);
    assert.equal(translateSource("दो रोटी", "hinglish"), null);
    assert.equal(translateSource("", "ta"), null);
  });
  it("translates typed words from their script's language", () => {
    assert.equal(translateSource("दो रोटी"), "hi");
    assert.equal(translateSource("இட்லி"), "ta");
    assert.equal(translateSource("ਦੋ ਰੋਟੀਆਂ"), "pa");
  });
  it("uses the spoken language, so Marathi isn't taken for Hindi", () => {
    assert.equal(translateSource("दोन पोळ्या आणि वरण", "mr"), "mr");
  });
});

describe("what the server makes of the words", () => {
  it("reads the translation and keeps their own words", () => {
    const w = mealWords({ text: "Two idlis with sambar", original: "இரண்டு இட்லி சாம்பார்", spoken: "ta", appLanguage: "en" });
    assert.equal(w.said, "இரண்டு இட்லி சாம்பார்");
    assert.equal(w.english, "Two idlis with sambar");
    assert.equal(w.saidIn.name, "Tamil");
    assert.equal(w.reply.id, "ta");
  });
  it("has no translation when only words were sent, or both are the same", () => {
    assert.equal(mealWords({ text: "poha" }).english, null);
    assert.equal(mealWords({ text: "poha", original: "poha" }).english, null);
    assert.equal(mealWords({ original: "पोहा" }).said, "पोहा");
  });
  it("names typed Devanagari as Hindi and a photo alone has no words", () => {
    assert.equal(mealWords({ text: "Two rotis", original: "दो रोटी" }).saidIn.name, "Hindi");
    const photo = mealWords({ appLanguage: "hinglish" });
    assert.equal(photo.said, "");
    assert.equal(photo.reply.id, "hinglish");
  });
});

describe("what Claude is asked", () => {
  const context = { language: "en", diet: "veg", focus: [] };
  it("sends the translation with their words and asks for the reply in their language", () => {
    const words = mealWords({ text: "Two idlis with sambar", original: "இரண்டு இட்லி சாம்பார்", spoken: "ta" });
    const prompt = mealPrompt({ words, voice: true, context });
    assert.match(prompt, /In my words, in Tamil \(spoken, so speech recognition may have misheard a word\): "இரண்டு இட்லி சாம்பார்"/);
    assert.match(prompt, /My browser translated that into English: "Two idlis with sambar"/);
    assert.match(prompt, /Write the title and the tip in Tamil\./);
    assert.match(prompt, /everyday Tamil, in Tamil script/);
  });
  it("sends typed words as they are", () => {
    const prompt = mealPrompt({ words: mealWords({ text: "2 rotis and dal", appLanguage: "en" }), voice: false, context });
    assert.match(prompt, /In my words: "2 rotis and dal"/);
    assert.doesNotMatch(prompt, /translated|speech recognition/);
    assert.match(prompt, /Write the title and the tip in English\./);
  });
  it("keeps the app languages' rules as they were for reads, wraps and stacks", () => {
    assert.match(languageRule("hi"), /^Write every sentence meant for the person in simple, everyday Hindi \(Devanagari\)\./);
    assert.match(languageRule("hinglish"), /^Write every sentence meant for the person in Hinglish: Hindi in Latin script/);
    assert.match(languageRule("en"), /^Write in plain, simple English/);
    assert.equal(languageRule(null), languageRule("en"));
    assert.match(languageRule("ur"), /everyday Urdu, in Urdu \(Perso-Arabic\) script/);
  });
});
