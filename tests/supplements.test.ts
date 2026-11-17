// The stack rules engine (lib/domain/supplements.ts): what earns a supplement,
// at what dose, and what never does. The safety floor runs after it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floorStack } from "../lib/domain/safety.ts";
import { SHORT_OF_NEED } from "../lib/domain/nutrition.ts";
import { brandQuery, foodFirst, foodGaps, planStack, VITAMIN_D_TEST, type Gap, type RuleContext, type RuleMarker } from "../lib/domain/supplements.ts";

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
  it("uses food gaps for magnesium, calcium and protein, and not zinc for now", () => {
    const plan = planStack(ctx({
      diet: "vegan",
      gaps: [
        { key: "magnesium_mg", label: "Magnesium", pct: 45 },
        { key: "calcium_mg", label: "Calcium", pct: 40 },
        { key: "protein", label: "Protein", pct: 55 },
        { key: "zinc_mg", label: "Zinc", pct: 50 },
      ],
    }));
    assert.deepEqual(plan.items.map((i) => i.rule).sort(), ["calcium", "magnesium", "protein"]);
    assert.match(plan.items.find((i) => i.rule === "protein")!.form, /Pea or soy/);
  });
  it("gives B12 from a food gap on any diet, and only without a B12 result", () => {
    const short = [{ key: "b12_ug" as const, label: "Vitamin B12", pct: 35 }];
    const veg = planStack(ctx({ diet: "veg", gaps: short }));
    assert.equal(veg.items[0].rule, "b12");
    assert.equal(veg.items[0].dose, "500 mcg a day", "the lower dose, with no result to go on");
    assert.deepEqual(veg.items[0].markers, []);
    assert.match(veg.items[0].diet_gap ?? "", /35% of daily need/);
    assert.match(veg.items[0].why, /common when meals are mostly vegetarian/);
    const nonveg = planStack(ctx({ diet: "nonveg", gaps: short }));
    assert.equal(nonveg.items[0].rule, "b12", "on a mixed diet too (Mayank, 2026-11-17)");
    assert.equal(nonveg.items[0].dose, "500 mcg a day");
    assert.equal(nonveg.items[0].why, "Your meals cover about 35% of your B12 need; meat, fish, eggs and milk are its main sources.");
    assert.equal(planStack(ctx({ diet: "veg", gaps: [{ key: "b12_ug", label: "Vitamin B12", pct: 60 }] })).items.length, 0, "not for a small gap");
    assert.equal(planStack(ctx({ diet: "veg", gaps: short, markers: [mk("b12", 450, "pg/mL", "in_range")] })).items.length, 0, "a healthy result wins over the food estimate");
    assert.match(planStack(ctx({ diet: "veg", gaps: short, medications: "Metformin 500" })).items[0].cautions ?? "", /metformin or acid reducers/);
  });
  it("leaves big iron and folate gaps to a blood test, with food meanwhile, and keeps Food first to the items", () => {
    const c = ctx({ gaps: [{ key: "iron_mg", label: "Iron", pct: 40 }, { key: "folate_ug", label: "Folate", pct: 50 }] });
    const plan = planStack(c);
    assert.deepEqual(plan.items, []);
    assert.deepEqual(plan.food_first, [], "the food gaps say what to eat, so Food first doesn't repeat it");
    const rows = foodGaps(c, plan.items);
    assert.deepEqual(rows.map((r) => r.outcome), ["test", "test"]);
    assert.match(rows[0].note, /rajma or palak/);
    assert.match(rows[1].note, /dal, methi and palak/);
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
    assert.deepEqual(plan.items.map((i) => i.rule), ["vitamin_d3", "omega3", "b12", "calcium", "protein"]);
  });
});

// What happened to each food gap (foodGaps): the stack, food first, a test first, or a
// doctor first, worked out from the rules and the floored stack.
describe("food gaps", () => {
  const gap = (key: Gap["key"], pct: number): Gap => ({ key, label: key, pct });
  // A day like Mayank's: short on almost everything.
  const shortDay = [
    gap("vitamin_c_mg", 0), gap("folate_ug", 4), gap("vitamin_d_iu", 21), gap("calcium_mg", 30), gap("b12_ug", 35), gap("fibre", 40),
    gap("magnesium_mg", 45), gap("iron_mg", 50), gap("protein", 55), gap("zinc_mg", 65),
  ];
  const rows = (c: RuleContext) => foodGaps(c, planStack(c).items);
  const outcomes = (c: RuleContext) => Object.fromEntries(rows(c).map((g) => [g.key, g.outcome]));
  const notes = (c: RuleContext) => Object.fromEntries(rows(c).map((g) => [g.key, g.note]));

  it("lists every nutrient under the line, lowest first, and nothing at or above it", () => {
    const c = ctx({ diet: "veg", gaps: [gap("protein", 90), gap("fibre", SHORT_OF_NEED), gap("calcium_mg", 30), gap("vitamin_c_mg", 0), gap("magnesium_mg", 69)] });
    assert.deepEqual(rows(c).map((g) => [g.key, g.pct]), [["vitamin_c_mg", 0], ["calcium_mg", 30], ["magnesium_mg", 69]]);
  });

  it("before any report: stack where a rule earned an item, test for vitamin D, iron and folate, food for the rest", () => {
    assert.deepEqual(outcomes(ctx({ diet: "veg", level: "regular", gaps: shortDay })), {
      vitamin_c_mg: "food",
      folate_ug: "test",
      vitamin_d_iu: "test",
      calcium_mg: "stack",
      b12_ug: "stack",
      fibre: "food",
      magnesium_mg: "stack",
      iron_mg: "test",
      protein: "stack",
      zinc_mg: "food", // 65% is short, but zinc needs under 60%
    });
  });

  it("carries vitamin D's IU from food, and says why it waits for a test", () => {
    const [d] = foodGaps(ctx({ gaps: [{ key: "vitamin_d_iu", label: "Vitamin D", pct: 20, iu: 120 }] }), []);
    assert.equal(d.iu, 120);
    assert.equal(d.outcome, "test");
    assert.equal(d.note, VITAMIN_D_TEST);
    assert.match(d.note, /stay under 4,000 IU a day/);
    assert.equal(foodGaps(ctx({ gaps: [gap("calcium_mg", 20)] }), [])[0].iu, null, "only vitamin D is shown in IU");
  });

  it("earns no zinc from food alone (paused 2026-11-17), and shows the gap as food first", () => {
    const c = ctx({ diet: "veg", gaps: [gap("zinc_mg", 30)] });
    assert.deepEqual(planStack(c).items, []);
    assert.deepEqual(rows(c).map((g) => [g.outcome, g.note]), [["food", "Chana, cashews or pumpkin seeds close it."]]);
    assert.equal(brandQuery("zinc", "veg").key, "v2:zinc:any", "the brand look-up stays for when it returns");
  });

  it("follows the diet: B12 from food alone on any diet", () => {
    assert.deepEqual(outcomes(ctx({ diet: "veg", gaps: [gap("zinc_mg", 40), gap("b12_ug", 30)] })), { zinc_mg: "food", b12_ug: "stack" });
    assert.deepEqual(outcomes(ctx({ diet: "nonveg", gaps: [gap("zinc_mg", 40), gap("b12_ug", 30)] })), { zinc_mg: "food", b12_ug: "stack" });
    assert.equal(notes(ctx({ diet: "veg", gaps: [gap("b12_ug", 30)] })).b12_ug, "Common on mostly vegetarian meals; a blood test shows your stores.");
    assert.equal(notes(ctx({ diet: "nonveg", gaps: [gap("b12_ug", 30)] })).b12_ug, "A blood test shows your stores.");
    assert.equal(outcomes(ctx({ diet: "nonveg", gaps: [gap("b12_ug", 55)] })).b12_ug, "food", "B12 earns an item only under 50%");
    assert.match(notes(ctx({ level: "starting", gaps: [gap("protein", 40)] })).protein, /^Until you train, food covers it/);
  });

  // Every text in a plan, for every diet: vegans never see dairy, whey, eggs, fish or
  // chicken; vegetarians and Jains never see eggs, fish or chicken, and Jains no sprouts;
  // eggetarians see eggs but no fish or chicken. Plans cover every rule and every note.
  const fish = "fish|chicken|mathi|bangda";
  for (const [diet, banned] of [
    ["vegan", new RegExp(`\\b(curd|paneer|ghee|whey|eggs?|${fish})\\b|(?<!soy )\\bmilk\\b`, "i")],
    ["veg", new RegExp(`\\b(eggs?|${fish})\\b`, "i")],
    ["jain", new RegExp(`\\b(eggs?|sprouts|${fish})\\b`, "i")],
    ["eggetarian", new RegExp(`\\b(${fish})\\b`, "i")],
  ] as const) {
    it(`never names a food a ${diet} diet leaves out, anywhere in a plan`, () => {
      const lowAll = [
        mk("vitamin_d", 16, "ng/mL", "low"), mk("b12", 150, "pg/mL", "low"), mk("ferritin", 10, "ng/mL", "low"),
        mk("folate", 2, "ng/mL", "low"), mk("magnesium", 1.6, "mg/dL", "low"), mk("triglycerides", 220, "mg/dL", "high"),
      ];
      const short = [gap("calcium_mg", 30), gap("protein", 40), gap("zinc_mg", 40), gap("fibre", 40), gap("vitamin_c_mg", 10)];
      const contexts = [
        ctx({ diet, level: "regular", markers: lowAll, gaps: [...short, gap("vitamin_d_iu", 20), gap("iron_mg", 30), gap("folate_ug", 30), gap("magnesium_mg", 30), gap("b12_ug", 30)] }), // a report: items from results
        ctx({ diet, level: "regular", gaps: [...short, gap("vitamin_d_iu", 20), gap("iron_mg", 30), gap("folate_ug", 30), gap("magnesium_mg", 30), gap("b12_ug", 30)] }), // meals only
        ctx({ diet, level: "starting", gaps: [...short, gap("magnesium_mg", 65), gap("b12_ug", 55)] }), // food first everywhere
        ctx({ diet, markers: [mk("vitamin_d", 40, "ng/mL", "in_range"), mk("ferritin", 60, "ng/mL", "in_range"), mk("b12", 230, "pg/mL", "edge_low")], gaps: [gap("vitamin_d_iu", 20), gap("iron_mg", 30), gap("b12_ug", 60)] }),
      ];
      let seen = 0;
      for (const c of contexts) {
        const plan = planStack(c);
        const texts = [
          ...plan.items.flatMap((i) => [i.nutrient, i.why, i.form, i.dose, i.timing, i.duration, i.cautions ?? "", i.diet_gap ?? ""]),
          ...plan.food_first,
          ...foodGaps(c, plan.items).map((g) => g.note),
        ];
        seen += texts.length;
        for (const text of texts) assert.doesNotMatch(text, banned, text);
      }
      assert.ok(seen > 60, "the plans cover every rule and note");
    });
  }
  it("offers eggs to eggetarians and fish or chicken to non-vegetarians where they help", () => {
    assert.match(notes(ctx({ diet: "eggetarian", gaps: [gap("b12_ug", 55)] })).b12_ug, /plus eggs\.$/);
    assert.match(notes(ctx({ diet: "nonveg", gaps: [gap("b12_ug", 55)] })).b12_ug, /plus eggs, fish or chicken/);
    assert.match(notes(ctx({ diet: "nonveg", gaps: [gap("zinc_mg", 40)] })).zinc_mg, /or eggs close it/);
  });

  it("with a result for it, a nutrient is never 'test', and the note goes by the result", () => {
    const c = ctx({
      diet: "nonveg",
      markers: [mk("vitamin_d", 42, "ng/mL", "in_range"), mk("ferritin", 18, "ng/mL", "low"), mk("b12", 230, "pg/mL", "edge_low"), mk("folate", 25, "ng/mL", "high")],
      gaps: [gap("vitamin_d_iu", 21), gap("iron_mg", 40), gap("b12_ug", 30), gap("folate_ug", 20), gap("magnesium_mg", 40)],
    });
    const byKey = Object.fromEntries(rows(c).map((g) => [g.key, g]));
    assert.equal(byKey.vitamin_d_iu.outcome, "food");
    assert.equal(byKey.vitamin_d_iu.note, "Your result is in range, which counts more than food here.");
    assert.equal(byKey.iron_mg.outcome, "stack", "a low ferritin earns iron");
    assert.equal(byKey.iron_mg.note, "Your ferritin is low; only once a doctor agrees.");
    assert.equal(byKey.b12_ug.outcome, "food", "edge-low B12 on a mixed diet earns nothing, and a result beats the food gap");
    assert.match(byKey.b12_ug.note, /^Your result is on the low side\. Milk, curd and paneer/);
    assert.equal(byKey.folate_ug.note, "Your result is above its range, so add nothing for it.");
    assert.equal(byKey.magnesium_mg.outcome, "stack");
    assert.equal(byKey.magnesium_mg.note, "Peanuts or pumpkin seeds help too.");
    const noFolate = ctx({ gaps: [gap("folate_ug", 20)], markers: [mk("vitamin_d", 42, "ng/mL", "in_range")] });
    assert.equal(outcomes(noFolate).folate_ug, "test", "a report without folate");
  });

  it("in a report stack, a flagged result goes to the doctor, never to the stack", () => {
    const markers = [mk("vitamin_d", 8, "ng/mL", "low", "doctor")];
    const c = ctx({ markers, gaps: [gap("vitamin_d_iu", 21), gap("calcium_mg", 30)] });
    const floored = floorStack(planStack(c), [{ key: "vitamin_d", name: "Vitamin D (25-OH)", status: "low", flag: "doctor" }]);
    const byKey = Object.fromEntries(foodGaps(c, floored.items).map((g) => [g.key, g]));
    assert.equal(byKey.vitamin_d_iu.outcome, "doctor");
    assert.equal(byKey.vitamin_d_iu.note, "Your result is flagged; show it to a doctor first.");
    assert.equal(byKey.calcium_mg.outcome, "stack", "other gaps still follow the rules");
  });

  it("removes a calcium item earned by a food gap when calcium is flagged, with its food line, and says Doctor first", () => {
    // Calcium 11.5 mg/dL is above the doctor bound (10.8); meals cover 30% of the need.
    const markers = [mk("calcium", 11.5, "mg/dL", "high", "doctor")];
    const c = ctx({ markers, gaps: [gap("calcium_mg", 30)] });
    const planned = planStack(c);
    assert.deepEqual(planned.items.map((i) => i.rule), ["calcium"], "the rules propose it from the food gap");
    const floored = floorStack(planned, [{ key: "calcium", name: "Calcium", status: "high", flag: "doctor" }]);
    assert.deepEqual(floored.items, [], "the floor removes it");
    assert.match(floored.see_doctor.join(" "), /Calcium: flagged/);
    assert.deepEqual(foodFirst(c, floored.items), [], "no 'eat more calcium' line either");
    const [row] = foodGaps(c, floored.items);
    assert.equal(row.outcome, "doctor");
    assert.equal(row.note, "Your result is flagged; show it to a doctor first.");
  });

  it("sends magnesium, calcium and protein to the doctor with a kidney condition", () => {
    assert.deepEqual(outcomes(ctx({ conditions: ["kidney"], gaps: [gap("magnesium_mg", 40), gap("calcium_mg", 40), gap("protein", 40), gap("fibre", 40)] })), {
      magnesium_mg: "doctor",
      calcium_mg: "doctor",
      protein: "doctor",
      fibre: "food",
    });
    assert.equal(notes(ctx({ conditions: ["kidney"], gaps: [gap("protein", 40)] })).protein, "With a kidney condition, ask your doctor first.");
  });

  it("says nothing when the stack is held: pregnancy or an urgent result", () => {
    assert.deepEqual(foodGaps(ctx({ conditions: ["pregnant"], gaps: shortDay }), []), []);
    assert.deepEqual(foodGaps(ctx({ markers: [mk("haemoglobin", 6, "g/dL", "low", "urgent")], gaps: shortDay }), []), []);
  });

  it("keeps the Food first lines as they were for mixed diets", () => {
    const plan = planStack(ctx({ diet: "nonveg", level: "regular", gaps: [gap("protein", 50), gap("calcium_mg", 40)] }));
    assert.ok(plan.food_first.includes("Protein: add dal, curd, paneer, eggs or sprouts to every meal before reaching for a powder."));
    assert.ok(plan.food_first.includes("Calcium: curd, paneer, ragi, til and leafy greens."));
  });
});
