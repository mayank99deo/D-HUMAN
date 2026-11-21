// Ask's language checks (lib/domain/ask-language.ts): which language a question is in, the
// Marathi words, the "Speaking in" pick, the checks behind the one retry, and the lang tags
// the UI uses.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerLangTag, devanagariLanguage, looksMarathi, questionLanguage, scriptMismatch, wrongLanguage } from "../lib/domain/ask-language.ts";
import { LANG_CASES } from "./fixtures/ask-lang-eval.ts";

// Hindi as people type it and as phones write it: dropped chandrabindu and anusvara (करू,
// खाऊ, नही, मै, हु), English words mixed in, Mumbai Hindi's काय, a stray Marathi-looking word.
// Every one must stay Hindi. The first four went to Marathi before 2026-11-22.
const HINDI = [
  "प्रोटीन के क्या फायदे होते हैं",
  "मैं क्या करू",
  "रात को नींद नहीं आती क्या करू",
  "तुम्ही बताओ दौड़ने से पहले क्या खाना चाहिए",
  "काय रे, मेरा प्रोटीन कितना होना चाहिए",
  "विटामिन डी कम हो तो क्या करना चाहिए",
  "मुझे रोज कितना प्रोटीन खाना चाहिए?",
  "मेरा फेरिटिन कम है, क्या खाऊ?",
  "जिम के बाद क्या खाना सही रहता है",
  "नही पता मुझे कितना पानी पीना चाहिये",
  "मै वेजीटेरियन हु प्रोटीन कहा से लू",
  "मेरा HbA1c ज्यादा है तो क्या करना होगा",
  "gym के बाद muscles में दर्द होता है, क्या करें",
  "gym के बाद क्या खाऊ",
  "ऐप में खाना कैसे लॉग करते हैं",
  "पनीर में कितना प्रोटीन होता है",
  "डॉक्टर को कब दिखाना चाहिए मेरी रिपोर्ट के लिए",
  "मुझे भूक नही लगती",
  "क्या मै रोज दूध पी सकता हु",
  "मेरा vitamin D कम है क्या करूं",
  "काय यार नाही पता मुझे क्या करू",
  "नाही यार मुझे दूध पसंद नहीं",
  "किती प्रोटीन चाहिए मुझे",
  "साठी के बाद हड्डियों के लिए क्या खाएं",
  "दिखावे के लिए नहीं, सेहत के लिए",
  "निरंतर थकान रहती है",
  "आयरन की कमी हो तो क्या होता है",
  "मुझे आयरन के लिए क्या खाना चाहिए?",
  "मैं ऐप की भाषा कैसे बदलूँ?",
  "किती प्रोटीन?",
];

// Marathi as typed: the three questions measured on 2026-11-19 first, then more.
const MARATHI = [
  "धावण्याआधी काय खावे?",
  "मला रोज किती प्रोटीन लागते?",
  "माझे फेरिटिन कमी आहे, काय करू?",
  "मी शाकाहारी आहे, प्रोटीन कुठून मिळेल?",
  "रात्री झोप येत नाही, काय करावे?",
  "व्यायामानंतर काय खाणे चांगले?",
  "दिवसाला किती पाणी प्यावे?",
  "अॅपमध्ये जेवण कसे नोंदवायचे?",
  "जिम नंतर काय खाऊ?",
  "माझं वजन कमी कसं करू?",
  "व्हिटॅमिन डी कमी आहे तर काय खाऊ?",
  "चहा पिणे चांगले आहे का?",
  "माझा बी12 कमी आहे, कोणते पदार्थ खावे?",
  "मला थकवा जाणवतो",
  "मी काय खाऊ?",
  "सकाळी नाश्त्याला काय खावे?",
  "तुम्ही मला मदत करू शकता का?",
  "वजन कमी करायचे आहे",
  "काल मला ताप होता",
];

describe("ask language: Hindi or Marathi", () => {
  for (const q of HINDI) it(`Hindi: ${q}`, () => assert.equal(questionLanguage(q), "hi"));
  for (const q of MARATHI) it(`Marathi: ${q}`, () => assert.equal(questionLanguage(q), "mr"));

  it("agrees with every case in the live language eval", () => {
    for (const c of LANG_CASES) assert.equal(questionLanguage(c.q, c.spoken), c.want, c.id);
  });

  it("places answers too, and leaves short ones it can't place alone", () => {
    assert.equal(devanagariLanguage("आपको रोज़ लगभग 134 ग्राम प्रोटीन चाहिए। दाल, पनीर और दही से यह पूरा करें।"), "hi");
    assert.equal(devanagariLanguage("तुमच्या कामासाठी दिवसाला सुमारे 134 ग्रॅम प्रोटीन हे लक्ष्य आहे, आणि आज तुम्ही 130 ग्रॅम घेतले आहेत."), "mr");
    assert.equal(devanagariLanguage("केळे खा."), null);
  });
});

describe("ask language: the Speaking in pick decides", () => {
  it("outranks the words and their script", () => {
    assert.equal(questionLanguage("मला किती प्रोटीन चाहिए", "hi"), "hi");
    assert.equal(questionLanguage("प्रोटीन किती?", "mr"), "mr");
    assert.equal(questionLanguage("मुझे रोज कितना प्रोटीन चाहिए", "hinglish"), "hinglish");
    assert.equal(questionLanguage("How much protein?", "en"), "en");
    // Typed (no pick) and a pick off the list both fall back to the words.
    assert.equal(questionLanguage("मुझे रोज कितना प्रोटीन चाहिए", null), "hi");
    assert.equal(questionLanguage("मुझे रोज कितना प्रोटीन चाहिए", "klingon" as never), "hi");
  });

  it("Hinglish and English picks want Latin letters, whatever script the question came out in", () => {
    const q = "मुझे रोज कितना प्रोटीन चाहिए";
    assert.equal(scriptMismatch(q, "Aapko roz 134 g protein chahiye.", "hinglish"), false);
    assert.equal(scriptMismatch(q, "आपको रोज़ 134 ग्राम प्रोटीन चाहिए।", "hinglish"), true);
    assert.equal(scriptMismatch(q, "You need about 134 g a day.", "en"), false);
    assert.equal(scriptMismatch("Mujhe kitna protein chahiye", "आपको 134 ग्राम चाहिए।", "en"), true);
    // Typed, the same Devanagari question wants Devanagari.
    assert.equal(scriptMismatch(q, "Aapko roz 134 g protein chahiye."), true);
  });

  it("Indian-language picks want their own script", () => {
    assert.equal(scriptMismatch("Mujhe kitna protein chahiye", "आपको 134 ग्राम चाहिए।", "hi"), false);
    assert.equal(scriptMismatch("Mujhe kitna protein chahiye", "Aapko 134 g chahiye.", "hi"), true);
    assert.equal(scriptMismatch("ఎంత ప్రోటీన్?", "రోజుకు 134 గ్రాములు.", "te"), false);
  });
});

describe("ask language: the answer check behind the one retry", () => {
  const MARATHI_ANSWER = "तुमच्या कामासाठी दिवसाला सुमारे 134 ग्रॅम प्रोटीन हे लक्ष्य आहे, आणि आज तुम्ही 130 ग्रॅम घेतले आहेत.";
  const HINDI_ANSWER = "आपको रोज़ लगभग 134 ग्राम प्रोटीन चाहिए। दाल, पनीर और दही से यह पूरा करें।";
  it("catches Marathi for a Hindi question, and Hindi for a Marathi one", () => {
    assert.equal(wrongLanguage("मैं क्या करू", MARATHI_ANSWER), true);
    assert.equal(wrongLanguage("मैं क्या करू", HINDI_ANSWER), false);
    assert.equal(wrongLanguage("मला रोज किती प्रोटीन लागते?", HINDI_ANSWER), true);
    assert.equal(wrongLanguage("मला रोज किती प्रोटीन लागते?", MARATHI_ANSWER), false);
    // The pick decides which is right.
    assert.equal(wrongLanguage("मला किती प्रोटीन चाहिए", MARATHI_ANSWER, "hi"), true);
    assert.equal(wrongLanguage("प्रोटीन किती?", MARATHI_ANSWER, "mr"), false);
  });

  it("never asks again over an answer the word lists can't place, or across other languages", () => {
    assert.equal(wrongLanguage("धावण्याआधी काय खावे?", "केळे खा."), false);
    assert.equal(wrongLanguage("జిమ్ తర్వాత ఏమి తినాలి?", "పప్పు అన్నం తినండి."), false);
    assert.equal(wrongLanguage("What should I eat?", "Dal and rice."), false);
    assert.equal(wrongLanguage("Kya khaun?", "Dal chawal khao."), false);
  });
});

describe("ask language", () => {
  it("tells Marathi from Hindi in Devanagari by Marathi-only words", () => {
    assert.equal(looksMarathi("धावण्याआधी काय खावे?"), true);
    assert.equal(looksMarathi("मला रोज किती प्रोटीन लागते?"), true);
    assert.equal(looksMarathi("माझे फेरिटिन कमी आहे, काय करू?"), true);
    assert.equal(looksMarathi("मुझे आयरन के लिए क्या खाना चाहिए?"), false);
    assert.equal(looksMarathi("मैं ऐप की भाषा कैसे बदलूँ?"), false);
    // A Marathi word inside a longer Devanagari word doesn't count.
    assert.equal(looksMarathi("कायदा"), false);
    // One weak word isn't enough, and words Hindi uses never count.
    assert.equal(looksMarathi("काय रे"), false);
    assert.equal(looksMarathi("होते करू खाऊ कमी"), false);
  });

  it("reads a question's language from its script, and Hinglish from Hindi words in Latin letters", () => {
    assert.equal(questionLanguage("मुझे आयरन के लिए क्या खाना चाहिए?"), "hi");
    assert.equal(questionLanguage("धावण्याआधी काय खावे?"), "mr");
    assert.equal(questionLanguage("జిమ్ తర్వాత ఏమి తినాలి?"), "te");
    assert.equal(questionLanguage("காலை உணவுக்கு என்ன சாப்பிடலாம்?"), "ta");
    assert.equal(questionLanguage("রোজ কতটা জল খাওয়া উচিত?"), "bn");
    assert.equal(questionLanguage("کیا مجھے روزانہ ورزش کرنی چاہیے؟"), "ur");
    assert.equal(questionLanguage("Kal subah nashte mein kya khaun taaki sugar control rahe?"), "hinglish");
    assert.equal(questionLanguage("How much protein do I still need today?"), "en");
  });

  it("flags an answer in another script than an Indian-script question, and nothing else", () => {
    assert.equal(scriptMismatch("జిమ్ తర్వాత ఏమి తినాలి?", "After the gym, eat dal and rice."), true);
    assert.equal(scriptMismatch("జిమ్ తర్వాత ఏమి తినాలి?", "జిమ్ తర్వాత పప్పు అన్నం తినండి."), false);
    assert.equal(scriptMismatch("मुझे आयरन के लिए क्या खाना चाहिए?", "पालक और चना खाएं, साथ में नींबू।"), false);
    // Marathi and Hindi share a script: never a mismatch between them.
    assert.equal(scriptMismatch("धावण्याआधी काय खावे?", "दौड़ से पहले केला खाएं।"), false);
    assert.equal(scriptMismatch("காலை உணவுக்கு என்ன?", "सुबह इडली खाएं।"), true);
    // Latin-letter questions: English and Hinglish answers both fine.
    assert.equal(scriptMismatch("Kya khaun?", "Dal chawal khao."), false);
    assert.equal(scriptMismatch("What should I eat?", "Dal and rice."), false);
  });

  it("tags answer text for the page's lang attribute", () => {
    assert.equal(answerLangTag("en", "Dal and rice."), "en");
    assert.equal(answerLangTag("hinglish", "Dal chawal khao."), "hi-Latn");
    assert.equal(answerLangTag("hi", "दाल चावल खाएं।"), "hi");
    assert.equal(answerLangTag("ta", "இட்லி சாப்பிடுங்கள்."), "ta");
    assert.equal(answerLangTag("mr", "केळे खा."), "mr");
    // Off the list: read from the text itself.
    assert.equal(answerLangTag("klingon", "దాల్ తినండి"), "te");
    // No text (urgent and crisis): code's notices are English.
    assert.equal(answerLangTag("hi", null), "en");
  });
});
