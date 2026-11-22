// Rice weighed in grams is cooked rice on the plate unless the person says it's raw (Mayank,
// 2026-11-22): the amounts found in their words, in Latin letters, Hinglish and Devanagari; the raw
// grams worked out from USDA's cooked and raw energy; and the line in the meal and usual-day requests,
// which only those requests get: the system prompt, and every other request, stay as they were.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { riceAmounts, cookedRiceLine } = await import("../lib/domain/rice-grams.ts");
const { COOKED_RICE, FOODS, rawRice } = await import("../lib/domain/food-table.ts");
const { SYSTEM, mealPrompt, usualDayPrompt } = await import("../lib/ai/food.ts");
const { mealWords } = await import("../lib/domain/speech.ts");

const one = (text: string) => {
  const found = riceAmounts(text);
  assert.equal(found.length, 1, `${text}: ${JSON.stringify(found)}`);
  return found[0];
};

describe("rice in grams in the person's words", () => {
  it("finds cooked rice in English, Hinglish and Devanagari", () => {
    for (const [text, grams] of [
      ["300 gram chawal aur chicken curry", 300],
      ["200 g rice and dal", 200],
      ["300 ग्राम चावल और राजमा", 300],
      ["300g rice", 300],
      ["300gm chawal, 1 bowl dal", 300],
      ["300 grams of cooked basmati rice", 300],
      ["400 g basmati rice", 400],
      ["300 g jeera rice", 300],
      ["200 gram boiled chawal", 200],
      ["chawal 300 gram", 300],
      ["rice: 250 g", 250],
      ["३०० ग्राम चावल", 300],
      ["300ग्राम उबले हुए चावल", 300],
      ["150 g bhaat", 150],
      ["एक कटोरी दाल और दो सौ ग्राम चावल", 200],
      ["do sau gram chawal", 200],
      ["sadhe teen sau gram basamti chawal", 350],
      ["डेढ़ सौ ग्राम चावल", 150],
      ["assi gram chawal", 80],
    ] as const) {
      const a = one(text);
      assert.deepEqual([a.grams, a.code, a.raw], [grams, "rice_white", false], text);
    }
  });
  it("tells brown rice from white", () => {
    assert.equal(one("250 gram brown rice").code, "rice_brown");
    assert.equal(one("ढाई सौ ग्राम ब्राउन राइस").code, "rice_brown");
    assert.equal(one("dhai sau gram brown rice").grams, 250);
  });
  it("reads raw words in all three scripts", () => {
    for (const text of [
      "100 g raw rice",
      "80 gram kachcha chawal",
      "150 g uncooked basmati",
      "100 g un-cooked rice",
      "100 g rice (raw)",
      "100 g rice, uncooked",
      "100 g dry rice",
      "100 g rice before cooking",
      "80 gram chawal kacha wala",
      "80 ग्राम कच्चा चावल",
      "100 ग्राम चावल पकाने से पहले",
      "100 gram chawal pakane se pehle",
    ]) {
      assert.equal(one(text).raw, true, text);
      assert.equal(cookedRiceLine(text), "", text);
    }
  });
  it("keeps a raw word to its own part of the sentence", () => {
    const found = riceAmounts("100 g raw paneer and 300 g rice");
    assert.deepEqual(found, [{ grams: 300, code: "rice_white", raw: false }]);
    assert.deepEqual(riceAmounts("80 g kachcha chawal aur 200 g chawal").map((a) => a.raw), [true, false]);
  });
  it("leaves dishes, rice products and other foods to the model", () => {
    for (const text of [
      "1 plate chawal",
      "2 katori chawal",
      "300 g chicken biryani",
      "300 g fried rice",
      "300 g egg fried rice",
      "300 g curd rice",
      "300 g lemon rice",
      "300 g dal chawal",
      "300 g rajma chawal",
      "dal chawal 300 g",
      "100 g rice flour",
      "100 g chawal ka atta",
      "100 ग्राम चावल का आटा",
      "50 g rice cakes",
      "200 g rice noodles",
      "200 g rice kheer",
      "50 g puffed rice",
      "rice and 300 g chicken",
      "300 g chicken and rice",
      "100 g green gram",
      "50 g dal",
      "50 g oats",
      "200 g quinoa",
      "300 ml rice water",
      "do gram chawal",
      "5 g rice",
      "5000 g rice",
    ]) assert.deepEqual(riceAmounts(text), [], text);
  });
});

describe("cooked rice to raw", () => {
  it("uses USDA's cooked and raw energy", () => {
    assert.deepEqual(COOKED_RICE.rice_white, { kcal: 130, src: "fdc:169757" });
    assert.deepEqual(COOKED_RICE.rice_brown, { kcal: 123, src: "fdc:169704" });
    assert.deepEqual([FOODS.rice_white.kcal, FOODS.rice_brown.kcal], [365, 367]);
  });
  it("makes 300 g cooked white rice 107 g raw at 390 kcal, as the cup portion makes 158 g 56 g", () => {
    assert.deepEqual(rawRice(300, "rice_white"), { g: 107, kcal: 390 });
    assert.deepEqual(rawRice(158, "rice_white"), { g: 56, kcal: 205 });
    assert.deepEqual(rawRice(250, "rice_brown"), { g: 84, kcal: 308 });
    // The other way round, 100 g raw rice stays 365 kcal: 281 g cooked.
    assert.equal(rawRice(281, "rice_white").g, 100);
  });
  it("writes the raw grams for the request", () => {
    assert.equal(cookedRiceLine("300 gram chawal aur chicken curry"), "Rice in grams is cooked rice on the plate, not a raw amount: their 300 g of rice is 107 g raw rice_white, about 390 kcal.");
    assert.equal(cookedRiceLine("250 gram brown rice"), "Rice in grams is cooked rice on the plate, not a raw amount: their 250 g of brown rice is 84 g raw rice_brown, about 308 kcal.");
    assert.equal(
      cookedRiceLine("200 g rice for lunch, 150 g rice for dinner"),
      "Rice in grams is cooked rice on the plate, not a raw amount: their 200 g of rice is 71 g raw rice_white, about 260 kcal; their 150 g of rice is 53 g raw rice_white, about 195 kcal.",
    );
    assert.equal(cookedRiceLine("1 plate chawal"), "");
  });
});

describe("the line in the requests", () => {
  const context = { language: "en", diet: "veg", focus: [] };
  it("leaves the system prompt as it was, so dal, oats, rajma and dishes read as before", () => {
    // A rice rule here also turned 150 g rajma into cooked rajma in 2 of 7 live runs (2026-11-22).
    assert.match(SYSTEM, /Copy it from the portions below; when the person gives a raw amount, use it as given\. Write each weight once; don't convert it again\./);
    assert.doesNotMatch(SYSTEM, /cooked rice on the plate|kachcha/);
    assert.match(SYSTEM, /- 1 plate boiled rice: 100 g raw rice\n- 1 cup cooked rice \(158 g\): 56 g raw rice/);
  });
  it("adds the raw grams to a meal only when the words give cooked rice in grams", () => {
    const typed = mealPrompt({ words: mealWords({ text: "300 gram chawal aur chicken curry", appLanguage: "en" }), voice: false, context });
    assert.match(typed, /In my words: "300 gram chawal aur chicken curry"\nRice in grams is cooked rice on the plate, not a raw amount: their 300 g of rice is 107 g raw rice_white, about 390 kcal\.\n/);
    const spoken = mealPrompt({ words: mealWords({ text: "300 ग्राम चावल और राजमा", spoken: "hi", appLanguage: "en" }), voice: true, context });
    assert.match(spoken, /their 300 g of rice is 107 g raw rice_white/);
    for (const text of ["100 g raw rice", "80 gram kachcha chawal", "1 plate chawal", "300 g chicken biryani", "50 g dal", "150 gram rajma", "50 g oats"]) {
      assert.doesNotMatch(mealPrompt({ words: mealWords({ text, appLanguage: "en" }), voice: false, context }), /Rice in grams/, text);
    }
    const photo = mealPrompt({ image: { mime: "image/jpeg", bytes: Buffer.from("") }, words: mealWords({ appLanguage: "en" }), voice: false, context });
    assert.doesNotMatch(photo, /Rice in grams/);
  });
  it("adds them to a usual day too", () => {
    assert.match(usualDayPrompt("Lunch: 300 g rice and dal. Dinner: 3 rotis", context), /"Lunch: 300 g rice and dal\. Dinner: 3 rotis"\nRice in grams is cooked rice on the plate, not a raw amount: their 300 g of rice is 107 g raw rice_white/);
    assert.doesNotMatch(usualDayPrompt("dal chawal, roti sabzi, chai", context), /Rice in grams/);
  });
});
