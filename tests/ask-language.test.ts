// Ask's language checks (lib/domain/ask-language.ts): which language a question is in, the
// Marathi words, the script check behind the one retry, and the lang tags the UI uses.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerLangTag, looksMarathi, questionLanguage, scriptMismatch } from "../lib/domain/ask-language.ts";

describe("ask language", () => {
  it("tells Marathi from Hindi in Devanagari by Marathi-only words", () => {
    assert.equal(looksMarathi("धावण्याआधी काय खावे?"), true);
    assert.equal(looksMarathi("मला रोज किती प्रोटीन लागते?"), true);
    assert.equal(looksMarathi("माझे फेरिटिन कमी आहे, काय करू?"), true);
    assert.equal(looksMarathi("मुझे आयरन के लिए क्या खाना चाहिए?"), false);
    assert.equal(looksMarathi("मैं ऐप की भाषा कैसे बदलूँ?"), false);
    // A Marathi word inside a longer Devanagari word doesn't count.
    assert.equal(looksMarathi("कायदा"), false);
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
