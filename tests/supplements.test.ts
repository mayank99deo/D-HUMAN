// The stack rules engine (lib/domain/supplements.ts): what earns a supplement,
// at what dose, and what never does. The safety floor runs after it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floorStack } from "../lib/domain/safety.ts";
import { brandQuery, planStack, type RuleContext, type RuleMarker } from "../lib/domain/supplements.ts";

const mk = (key: string, value: number, unit: string, status: string, flag: string | null = null): RuleMarker => ({ key, name: key, value, unit, status, flag });
const ctx = (o: Partial<RuleContext>): RuleContext => ({ markers: [], gaps: [], diet: "nonveg", level: "regular", conditions: [], medications: null, ...o });

describe("stack rules", () => {
  it("gives vitamin D3 at a dose that fits the level", () => {
    const low = planStack(ctx({ markers: [mk("vitamin_d", 16.9, "ng/mL", "low")] }));
    assert.equal(low.items[0].nutrient, "Vitamin D3");
    assert.equal(low.items[0].dose, "2,000 IU a day");
    const edge = planStack(ctx({ markers: [mk("vitamin_d", 25, "ng/mL", "low")] }));
    assert.equal(edge.items[0].dose, "1,000 IU a day");
    const nmol = planStack(ctx({ markers: [mk("vitamin_d", 30, "nmol/L", "low")] })); // about 12 ng/mL
    assert.equal(nmol.items[0].dose, "2,000 IU a day");
  });
  it("gives B12 at the edge of range only on plant diets", () => {
    assert.equal(planStack(ctx({ markers: [mk("b12", 230, "pg/mL", "edge_low")], diet: "nonveg" })).items.length, 0);
    assert.equal(planStack(ctx({ markers: [mk("b12", 230, "pg/mL", "edge_low")], diet: "veg" })).items[0].nutrient, "Vitamin B12");
    assert.equal(planStack(ctx({ markers: [mk("b12", 150, "pg/mL", "low")], diet: "nonveg" })).items[0].nutrient, "Vitamin B12");
  });
  it("only offers iron for a low ferritin, with a doctor's agreement", () => {
    const low = planStack(ctx({ markers: [mk("ferritin", 22.4, "ng/mL", "low")] }));
    assert.match(low.items[0].nutrient, /Iron \(only if your doctor agrees\)/);
    assert.match(low.items[0].cautions ?? "", /Check with a doctor before starting/);
    assert.equal(planStack(ctx({ markers: [mk("ferritin", 80, "ng/mL", "in_range")] })).items.length, 0);
  });
  it("uses food gaps for magnesium, calcium, protein and zinc", () => {
    const plan = planStack(ctx({
      diet: "vegan",
      gaps: [
        { key: "magnesium_mg", label: "Magnesium", pct: 45 },
        { key: "calcium_mg", label: "Calcium", pct: 40 },
        { key: "protein", label: "Protein", pct: 55 },
        { key: "zinc_mg", label: "Zinc", pct: 50 },
      ],
    }));
    assert.deepEqual(plan.items.map((i) => i.rule).sort(), ["calcium", "magnesium", "protein", "zinc"]);
    assert.match(plan.items.find((i) => i.rule === "protein")!.form, /Pea or soy/);
  });
  it("gives B12 from a food gap only on plant diets, and only without a B12 result", () => {
    const short = [{ key: "b12_ug" as const, label: "Vitamin B12", pct: 35 }];
    const veg = planStack(ctx({ diet: "veg", gaps: short }));
    assert.equal(veg.items[0].rule, "b12");
    assert.equal(veg.items[0].dose, "500 mcg a day", "the lower dose, with no result to go on");
    assert.deepEqual(veg.items[0].markers, []);
    assert.match(veg.items[0].diet_gap ?? "", /35% of daily need/);
    assert.equal(planStack(ctx({ diet: "nonveg", gaps: short })).items.length, 0, "not on a mixed diet");
    assert.equal(planStack(ctx({ diet: "veg", gaps: [{ key: "b12_ug", label: "Vitamin B12", pct: 60 }] })).items.length, 0, "not for a small gap");
    assert.equal(planStack(ctx({ diet: "veg", gaps: short, markers: [mk("b12", 450, "pg/mL", "in_range")] })).items.length, 0, "a healthy result wins over the food estimate");
    assert.match(planStack(ctx({ diet: "veg", gaps: short, medications: "Metformin 500" })).items[0].cautions ?? "", /metformin or acid reducers/);
  });
  it("gives food advice for big iron and folate gaps, without a supplement", () => {
    const plan = planStack(ctx({ gaps: [{ key: "iron_mg", label: "Iron", pct: 40 }, { key: "folate_ug", label: "Folate", pct: 50 }] }));
    assert.deepEqual(plan.items, []);
    assert.ok(plan.food_first.some((f) => f.startsWith("Iron:")) && plan.food_first.some((f) => f.startsWith("Folate:")));
  });
  it("doesn't mention a report in the pregnancy hold when there isn't one", () => {
    assert.doesNotMatch(planStack(ctx({ conditions: ["pregnant"] })).see_doctor[0], /report/);
    assert.match(planStack(ctx({ conditions: ["pregnant"], markers: [mk("b12", 450, "pg/mL", "in_range")] })).see_doctor[0], /show them this report/);
  });
  it("never offers vitamin D, iron or folate from food alone", () => {
    const plan = planStack(ctx({
      diet: "veg",
      gaps: [
        { key: "vitamin_d_iu", label: "Vitamin D", pct: 5 },
        { key: "iron_mg", label: "Iron", pct: 30 },
        { key: "folate_ug", label: "Folate", pct: 30 },
      ],
    }));
    assert.deepEqual(plan.items, []);
  });
  it("doesn't push protein on people who don't train yet", () => {
    assert.equal(planStack(ctx({ level: "starting", gaps: [{ key: "protein", label: "Protein", pct: 40 }] })).items.length, 0);
  });
  it("offers nothing new when pregnant", () => {
    const plan = planStack(ctx({ conditions: ["pregnant"], markers: [mk("vitamin_d", 12, "ng/mL", "low")] }));
    assert.equal(plan.items.length, 0);
    assert.match(plan.see_doctor[0], /pregnant/);
  });
  it("holds magnesium, protein and calcium for a kidney condition", () => {
    const plan = planStack(ctx({ conditions: ["kidney"], markers: [mk("magnesium", 1.5, "mg/dL", "low"), mk("vitamin_d", 18, "ng/mL", "low")] }));
    assert.deepEqual(plan.items.map((i) => i.rule), ["vitamin_d3"]);
    assert.match(plan.see_doctor[0], /kidney condition/);
  });
  it("names what to skip, and adds medicines to every caution", () => {
    const plan = planStack(ctx({ medications: "metformin 500", markers: [mk("b12", 140, "pg/mL", "low"), mk("vitamin_d", 40, "ng/mL", "in_range")] }));
    assert.equal(plan.skip[0].name, "Multivitamin");
    assert.ok(plan.skip.some((s) => s.name === "Vitamin D"));
    assert.match(plan.items[0].cautions ?? "", /metformin/);
  });
  it("still passes through the safety floor", () => {
    const markers = [mk("vitamin_d", 8, "ng/mL", "low", "doctor")];
    const planned = planStack(ctx({ markers }));
    assert.equal(planned.items.length, 1); // the rules propose it
    const floored = floorStack(planned, markers.map((m) => ({ key: m.key, name: "Vitamin D (25-OH)", status: m.status, flag: "doctor" as const })));
    assert.equal(floored.items.length, 0); // the floor removes it
    assert.match(floored.see_doctor.join(" "), /Vitamin D/);
  });
  it("shares brand look-ups by rule and diet variant, with the dose for monthly prices", () => {
    assert.equal(brandQuery("vitamin_d3", "vegan").key, "v2:vitamin_d3:vegan");
    assert.equal(brandQuery("vitamin_d3", "nonveg").key, "v2:vitamin_d3:any");
    assert.equal(brandQuery("b12", "veg").key, "v2:b12:any");
    assert.equal(brandQuery("omega3", "veg").key, "v2:omega3:veg");
    assert.match(brandQuery("protein", "nonveg").dose, /scoop/);
  });
  it("orders the stack by priority: out of range, then edge of range, then the biggest food gap", () => {
    const plan = planStack(ctx({
      diet: "veg",
      markers: [mk("b12", 230, "pg/mL", "edge_low"), mk("triglycerides", 210, "mg/dL", "high"), mk("vitamin_d", 25, "ng/mL", "low")],
      gaps: [
        { key: "calcium_mg", label: "Calcium", pct: 45 },
        { key: "protein", label: "Protein", pct: 50 },
        { key: "zinc_mg", label: "Zinc", pct: 30 },
      ],
    }));
    assert.deepEqual(plan.items.map((i) => i.rule), ["vitamin_d3", "omega3", "b12", "zinc", "calcium", "protein"]);
  });
});
