// Food weighed in grams is the cooked food on the plate unless the person says it's raw (Mayank,
// 2026-11-22): rice, dal, whole pulses, quinoa, oats and daliya. The amounts found in their words, in
// Latin letters, Hinglish and Devanagari; the raw grams worked out from USDA and the textbook bowl; and
// the line in the meal and usual-day requests, which only those requests get: the system prompt, and
// every other request, stay as they were.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { cookedAmounts, cookedLine } = await import("../lib/domain/cooked-grams.ts");
const { COOKED, FOODS, PORTIONS, rawFor } = await import("../lib/domain/food-table.ts");
const { SYSTEM, mealPrompt, usualDayPrompt } = await import("../lib/ai/food.ts");
const { mealWords } = await import("../lib/domain/speech.ts");

const one = (text: string) => {
  const found = cookedAmounts(text);
  assert.equal(found.length, 1, `${text}: ${JSON.stringify(found)}`);
  return found[0];
};
const read = (text: string) => {
  const a = one(text);
  return [a.grams, a.code, a.way, a.raw];
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
      ["300 g rice cooked", 300],
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
    ] as const) assert.deepEqual(read(text), [grams, "rice_white", "rice_white", false], text);
  });
  it("tells brown rice from white", () => {
    assert.equal(one("250 gram brown rice").code, "rice_brown");
    assert.equal(one("ढाई सौ ग्राम ब्राउन राइस").code, "rice_brown");
    assert.equal(one("dhai sau gram brown rice").grams, 250);
  });
});

describe("dal, pulses, quinoa, oats and daliya in grams", () => {
  it("finds every dal, as served", () => {
    for (const [text, grams, code] of [
      ["200 g dal", 200, "toor_dal"],
      ["200 gram daal", 200, "toor_dal"],
      ["200 ग्राम दाल", 200, "toor_dal"],
      ["150 gram arhar dal", 150, "toor_dal"],
      ["150 g toor dal", 150, "toor_dal"],
      ["150 ग्राम अरहर दाल", 150, "toor_dal"],
      ["arhar ki dal 150 gram", 150, "toor_dal"],
      ["150 g tuar dal", 150, "toor_dal"],
      ["200 g moong dal", 200, "moong"],
      ["200 g dhuli moong dal", 200, "moong"],
      ["200 ग्राम मूंग की दाल", 200, "moong"],
      ["200 ग्राम मसूर दाल", 200, "masoor_dal"],
      ["200 gram masoor dal", 200, "masoor_dal"],
      ["150 g urad dal", 150, "urad"],
      ["150 ग्राम उड़द दाल", 150, "urad"],
      ["150 g chana dal", 150, "chana"],
      ["150 ग्राम चना दाल", 150, "chana"],
      ["200 g dal tadka", 200, "toor_dal"],
      ["200 g boiled moong dal", 200, "moong"],
      ["do sau gram dal", 200, "toor_dal"],
    ] as const) assert.deepEqual(read(text), [grams, code, "dal", false], text);
  });
  it("finds whole pulses as a curry, and as drained when they're said to be boiled", () => {
    for (const [text, grams, code, way] of [
      ["200 gram rajma", 200, "rajma", "curry"],
      ["200 ग्राम राजमा", 200, "rajma", "curry"],
      ["250 g chole", 250, "chana", "curry"],
      ["250 ग्राम छोले", 250, "chana", "curry"],
      ["250 g kabuli chana", 250, "chana", "curry"],
      ["150 g kala chana", 150, "chana", "curry"],
      ["150 ग्राम काले चने", 150, "chana", "curry"],
      ["200 g lobia", 200, "lobia", "curry"],
      ["200 ग्राम लोबिया", 200, "lobia", "curry"],
      ["150 g matki", 150, "moth", "curry"],
      ["150 ग्राम मटकी", 150, "moth", "curry"],
      ["200 g sabut moong", 200, "moong", "curry"],
      ["200 g whole moong", 200, "moong", "curry"],
      ["200 ग्राम साबुत मूंग", 200, "moong", "curry"],
      ["150 g boiled kala chana", 150, "chana", "chana_boiled"],
      ["150 gram uble kale chane", 150, "chana", "chana_boiled"],
      ["150 ग्राम उबले काले चने", 150, "chana", "chana_boiled"],
      ["200 g boiled rajma", 200, "rajma", "rajma_boiled"],
      ["100 g boiled lobia", 100, "lobia", "lobia_boiled"],
      ["100 g ubla hua moong", 100, "moong", "moong_boiled"],
      ["100 g boiled matki", 100, "moth", "moth_boiled"],
    ] as const) assert.deepEqual(read(text), [grams, code, way, false], text);
  });
  it("finds quinoa, oats and daliya, as cooked in water", () => {
    for (const [text, grams, code] of [
      ["200 g quinoa", 200, "quinoa"],
      ["200 gram kinwa", 200, "quinoa"],
      ["200 ग्राम क्विनोआ", 200, "quinoa"],
      ["50 g oats", 50, "oats"],
      ["50 g rolled oats", 50, "oats"],
      ["50 ग्राम ओट्स", 50, "oats"],
      ["200 g oatmeal", 200, "oats"],
      ["200 g daliya", 200, "dalia"],
      ["200 gram dalia", 200, "dalia"],
      ["200 ग्राम दलिया", 200, "dalia"],
      ["200 g broken wheat", 200, "dalia"],
    ] as const) assert.deepEqual(read(text), [grams, code, code, false], text);
  });
});

describe("raw words", () => {
  it("read raw in all three scripts, for every food", () => {
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
      "50 g dry moong dal",
      "50 gram kachchi dal",
      "40 g raw toor dal",
      "60 ग्राम कच्ची मसूर दाल",
      "50 g chana dal before cooking",
      "60 g uncooked rajma",
      "60 g rajma (dry weight)",
      "80 g kabuli chana, dry weight",
      "50 gram kachcha kala chana",
      "100 g soaked chana",
      "100 g chana before soaking",
      "100 ग्राम चने भिगोने से पहले",
      "60 g uncooked quinoa",
      "50 g oats dry weight",
      "50 g oats from the packet",
      "50 g packet oats",
      "50 ग्राम सूखे ओट्स",
      "50 gram kachcha daliya",
    ]) {
      assert.equal(one(text).raw, true, text);
      assert.equal(cookedLine(text), "", text);
    }
  });
  it("keep to their own part of the sentence", () => {
    assert.deepEqual(cookedAmounts("100 g raw paneer and 300 g rice"), [{ grams: 300, code: "rice_white", way: "rice_white", label: "rice", raw: false }]);
    assert.deepEqual(cookedAmounts("80 g kachcha chawal aur 200 g chawal").map((a) => a.raw), [true, false]);
    assert.deepEqual(cookedAmounts("50 g oats dry weight, 200 g dal").map((a) => [a.code, a.raw]), [["oats", true], ["toor_dal", false]]);
  });
});

describe("dishes, products and other foods", () => {
  it("are left to the model, as before", () => {
    for (const text of [
      "1 plate chawal",
      "2 katori chawal",
      "1 katori dal",
      "1 bowl rajma chawal",
      "300 g chicken biryani",
      "300 g fried rice",
      "300 g egg fried rice",
      "300 g curd rice",
      "300 g lemon rice",
      "300 g dal chawal",
      "300 g rajma chawal",
      "dal chawal 300 g",
      "300 g rice dal",
      "100 g rice flour",
      "100 g chawal ka atta",
      "100 ग्राम चावल का आटा",
      "50 g rice cakes",
      "200 g rice noodles",
      "200 g rice kheer",
      "50 g puffed rice",
      "rice and 300 g chicken",
      "300 g chicken and rice",
      // Read as dishes already (about 0.3 dry, live 2026-11-22).
      "200 g dal makhani",
      "200 ग्राम दाल मखनी",
      "200 g chana masala",
      "200 g rajma masala",
      "200 g kali dal",
      "200 g chole bhature",
      "200 g dal khichdi",
      "200 g moong dal halwa",
      "100 g moong dal chilla",
      "200 g chana chaat",
      "200 g moong sprouts",
      "200 g sprouted moong",
      "100 g roasted chana",
      "100 g bhune chane",
      "100 g besan",
      "100 g sattu",
      "100 g chana atta",
      "50 g oats cookies",
      "50 g oats biscuits",
      "200 g oats porridge",
      "50 g masala oats",
      "100 g oats chilla",
      "100 g wheat flour",
      "100 g wheat",
      "100 g green gram",
      "200 g rajma chole",
      "300 ml rice water",
      "do gram chawal",
      "5 g rice",
      "5000 g dal",
    ]) assert.deepEqual(cookedAmounts(text), [], text);
  });
});

describe("cooked food to raw", () => {
  it("uses USDA's cooked and raw energy where the food is drained or cooked in water", () => {
    const factor = (way: keyof typeof COOKED) => Math.round(COOKED[way].factor * 1000) / 1000;
    assert.deepEqual([FOODS.rice_white.kcal, FOODS.rice_brown.kcal, FOODS.quinoa.kcal, FOODS.oats.kcal, FOODS.dalia.kcal], [365, 367, 368, 379, 342]);
    assert.deepEqual(
      (["rice_white", "rice_brown", "chana_boiled", "rajma_boiled", "moong_boiled", "lobia_boiled", "moth_boiled", "quinoa", "oats", "dalia"] as const).map((w) => [w, factor(w), COOKED[w].src]),
      [
        ["rice_white", 0.356, "fdc:169757"],
        ["rice_brown", 0.335, "fdc:169704"],
        ["chana_boiled", 0.434, "fdc:173757"],
        ["rajma_boiled", 0.377, "fdc:175194"],
        ["moong_boiled", 0.303, "fdc:174257"],
        ["lobia_boiled", 0.345, "fdc:173759"],
        ["moth_boiled", 0.341, "fdc:172426"],
        ["quinoa", 0.326, "fdc:168917"],
        ["oats", 0.187, "fdc:173905"],
        ["dalia", 0.243, "fdc:170287"],
      ],
    );
  });
  it("uses the textbook bowl for dal and pulse curries, as the portions in the prompt do", () => {
    assert.equal(COOKED.dal.factor, 0.2);
    assert.equal(COOKED.curry.factor, 0.2);
    // A 150 mL katori of dal holds the 30 g the prompt's portions give a bowl.
    assert.equal(PORTIONS.find((p) => p.serving === "1 bowl dal, rajma or chole")?.raw, "30 g dry dal or beans");
    assert.equal(rawFor(150, "toor_dal", "dal").g, 30);
  });
  it("makes 300 g cooked white rice 107 g raw at 390 kcal, as the cup portion makes 158 g 56 g", () => {
    assert.deepEqual(rawFor(300, "rice_white", "rice_white"), { g: 107, kcal: 390 });
    assert.deepEqual(rawFor(158, "rice_white", "rice_white"), { g: 56, kcal: 205 });
    assert.deepEqual(rawFor(250, "rice_brown", "rice_brown"), { g: 84, kcal: 308 });
    assert.equal(rawFor(281, "rice_white", "rice_white").g, 100);
  });
  it("makes 50 g cooked oats 9 g dry at 36 kcal; 50 g dry oats stays 190", () => {
    assert.deepEqual(rawFor(50, "oats", "oats"), { g: 9, kcal: 36 });
    assert.equal(Math.round((50 * FOODS.oats.kcal) / 100), 190);
  });
  it("writes the raw grams for the request", () => {
    assert.equal(cookedLine("300 gram chawal aur chicken curry"), "Rice in grams is cooked rice on the plate, not a raw amount: their 300 g of rice is 107 g raw rice_white, about 390 kcal.");
    assert.equal(cookedLine("250 gram brown rice"), "Rice in grams is cooked rice on the plate, not a raw amount: their 250 g of brown rice is 84 g raw rice_brown, about 308 kcal.");
    assert.equal(
      cookedLine("200 g rice for lunch, 150 g rice for dinner"),
      "Rice in grams is cooked rice on the plate, not a raw amount: their 200 g of rice is 71 g raw rice_white, about 260 kcal; their 150 g of rice is 53 g raw rice_white, about 195 kcal.",
    );
    assert.equal(cookedLine("200 g dal"), "Food in grams is cooked food as served, not a raw amount: their 200 g of dal is 40 g dry toor_dal, about 137 kcal for the dal alone.");
    assert.equal(cookedLine("250 g chole"), "Food in grams is cooked food as served, not a raw amount: their 250 g of chole is 50 g dry chana, about 189 kcal for the beans alone.");
    assert.equal(cookedLine("150 g boiled kala chana"), "Food in grams is cooked food as served, not a raw amount: their 150 g of boiled kala chana is 65 g dry chana, about 246 kcal.");
    assert.equal(cookedLine("200 g quinoa"), "Food in grams is cooked food as served, not a raw amount: their 200 g of quinoa is 65 g raw quinoa, about 240 kcal.");
    assert.equal(cookedLine("50 g oats"), "Food in grams is cooked food as served, not a raw amount: their 50 g of oats is 9 g dry oats, about 36 kcal.");
    assert.equal(cookedLine("200 g daliya"), "Food in grams is cooked food as served, not a raw amount: their 200 g of daliya is 49 g dry dalia, about 166 kcal.");
    assert.equal(
      cookedLine("300 g rice and 200 g moong dal"),
      "Food in grams is cooked food as served, not a raw amount: their 300 g of rice is 107 g raw rice_white, about 390 kcal; their 200 g of moong dal is 40 g dry moong, about 139 kcal for the dal alone.",
    );
    assert.equal(cookedLine("1 plate chawal"), "");
  });
});

describe("the line in the requests", () => {
  const context = { language: "en", diet: "veg", focus: [] };
  it("leaves the system prompt as it was", () => {
    // A rice rule here also turned 150 g rajma into cooked rajma in 2 of 7 live runs (2026-11-22).
    assert.match(SYSTEM, /Copy it from the portions below; when the person gives a raw amount, use it as given\. Write each weight once; don't convert it again\./);
    assert.doesNotMatch(SYSTEM, /cooked rice on the plate|cooked food as served|kachcha/);
    assert.match(SYSTEM, /- 1 plate boiled rice: 100 g raw rice\n- 1 cup cooked rice \(158 g\): 56 g raw rice/);
  });
  it("adds the raw grams to a meal only when the words give cooked food in grams", () => {
    const typed = mealPrompt({ words: mealWords({ text: "300 gram chawal aur chicken curry", appLanguage: "en" }), voice: false, context });
    assert.match(typed, /In my words: "300 gram chawal aur chicken curry"\nRice in grams is cooked rice on the plate, not a raw amount: their 300 g of rice is 107 g raw rice_white, about 390 kcal\.\n/);
    const spoken = mealPrompt({ words: mealWords({ text: "300 ग्राम चावल और राजमा", spoken: "hi", appLanguage: "en" }), voice: true, context });
    assert.match(spoken, /their 300 g of rice is 107 g raw rice_white/);
    const dal = mealPrompt({ words: mealWords({ text: "200 gram dal", spoken: "hinglish", appLanguage: "en" }), voice: true, context });
    assert.match(dal, /\nFood in grams is cooked food as served, not a raw amount: their 200 g of dal is 40 g dry toor_dal/);
    for (const text of ["100 g raw rice", "80 gram kachcha chawal", "1 plate chawal", "1 katori dal", "1 bowl rajma chawal", "300 g chicken biryani", "200 g dal makhani", "50 g oats dry weight"]) {
      assert.doesNotMatch(mealPrompt({ words: mealWords({ text, appLanguage: "en" }), voice: false, context }), /not a raw amount/, text);
    }
    const photo = mealPrompt({ image: { mime: "image/jpeg", bytes: Buffer.from("") }, words: mealWords({ appLanguage: "en" }), voice: false, context });
    assert.doesNotMatch(photo, /not a raw amount/);
  });
  it("adds them to a usual day too", () => {
    assert.match(usualDayPrompt("Lunch: 300 g rice and dal. Dinner: 3 rotis", context), /"Lunch: 300 g rice and dal\. Dinner: 3 rotis"\nRice in grams is cooked rice on the plate, not a raw amount: their 300 g of rice is 107 g raw rice_white/);
    assert.match(usualDayPrompt("Breakfast: 50 g oats. Lunch: 200 g rajma and 2 roti", context), /their 50 g of oats is 9 g dry oats, about 36 kcal; their 200 g of rajma is 40 g dry rajma/);
    assert.doesNotMatch(usualDayPrompt("dal chawal, roti sabzi, chai", context), /not a raw amount/);
  });
});
