// Tests for the Fuel facts library: 5-unit bands, the numbers worked out per
// band, and that each person only gets facts that fit them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandOf, foodFactsFor, heightFacts, weightFacts } from "../lib/domain/food-facts.ts";

describe("bands", () => {
  it("puts values in 5-unit bands ending on a multiple of 5", () => {
    assert.deepEqual(bandOf(170, " cm"), { lo: 166, hi: 170, label: "166–170 cm" });
    assert.deepEqual(bandOf(171, " cm"), { lo: 171, hi: 175, label: "171–175 cm" });
    assert.deepEqual(bandOf(65, " kg"), { lo: 61, hi: 65, label: "61–65 kg" });
    assert.deepEqual(bandOf(24, " years"), { lo: 21, hi: 25, label: "21–25 years" });
    assert.deepEqual(bandOf(20, " years"), { lo: 16, hi: 20, label: "16–20 years" });
  });
  it("rounds decimals before banding", () => {
    assert.equal(bandOf(165.4, " cm").label, "161–165 cm");
    assert.equal(bandOf(165.6, " cm").label, "166–170 cm");
  });
});

describe("numbers per band", () => {
  it("gives the Indian healthy-weight range for a height band", () => {
    const [weight, waist] = heightFacts(bandOf(170, " cm"));
    assert.match(weight.text, /about 51–66 kg/);
    assert.match(waist.text, /under about 83–85 cm/);
  });
  it("gives protein, running, walking and water for a weight band", () => {
    const [protein, run, walk, water] = weightFacts(bandOf(65, " kg"));
    assert.match(protein.text, /about 51–54 g/);
    assert.match(protein.text, /about 73–104 g/);
    assert.match(run.text, /roughly 305–325 kcal/);
    assert.match(walk.text, /roughly 5\.3–5\.7 km/);
    assert.match(water.text, /about 1\.8–2\.3 litres/);
  });
  it("compares a run to a food of similar energy", () => {
    assert.match(weightFacts(bandOf(52, " kg"))[1].text, /a samosa/);
    assert.match(weightFacts(bandOf(98, " kg"))[1].text, /veg biryani/);
  });
});

describe("picking facts for a person", () => {
  const priya = foodFactsFor({ age: 40, heightCm: 162, weightKg: 58, sex: "female", diet: "veg" });
  const rahul = foodFactsFor({ age: 24, heightCm: 170, weightKg: 65, sex: "male", diet: "nonveg" });

  it("names the person's categories", () => {
    assert.deepEqual(rahul.categories, ["21–25 years", "166–170 cm", "61–65 kg", "Non-vegetarians"]);
  });
  it("starts with a personal fact and mixes in facts for everyone", () => {
    assert.notEqual(rahul.facts[0].scope, "For everyone");
    assert.ok(rahul.facts.some((f) => f.scope === "For everyone"));
    assert.ok(rahul.facts.length > 40);
  });
  it("keeps women's facts for women and diet facts for that diet", () => {
    assert.ok(priya.facts.some((f) => f.kicker === "Women's iron"));
    assert.ok(!rahul.facts.some((f) => f.scope === "For women"));
    assert.ok(priya.facts.some((f) => f.kicker === "Plant iron"));
    assert.ok(!rahul.facts.some((f) => f.kicker === "Plant iron"));
    assert.ok(rahul.facts.some((f) => f.kicker === "Chicken"));
  });
  it("keeps age facts to their ages", () => {
    assert.ok(rahul.facts.some((f) => f.kicker === "Steady metabolism"));
    assert.ok(!rahul.facts.some((f) => f.kicker === "Thirst fades"));
    assert.ok(foodFactsFor({ age: 68 }).facts.some((f) => f.kicker === "Thirst fades"));
    assert.ok(!foodFactsFor({ age: 17 }).facts.some((f) => f.kicker === "Alcohol"));
  });
  it("still works with nothing known but the basics", () => {
    const anyone = foodFactsFor({});
    assert.deepEqual(anyone.categories, []);
    assert.ok(anyone.facts.length >= 30);
    assert.ok(anyone.facts.every((f) => f.scope === "For everyone"));
  });
});
