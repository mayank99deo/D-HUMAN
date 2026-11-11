// Tests for the safety floor: what a flagged marker forces on the read and the
// stack, whatever the model wrote. Run with `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asFlag,
  floorStack,
  floorVerdict,
  joinNames,
  keepMostSevere,
  midSentence,
  type SafetyMarker,
  type Verdict,
} from "../lib/domain/safety.ts";

const marker = (key: string, name: string, status: string, flag: SafetyMarker["flag"] = null): SafetyMarker => ({ key, name, status, flag });
const ready: Verdict = { level: "go", line: "Ready for HYROX Mumbai.", detail: "Nothing holds you back." };

describe("wording helpers", () => {
  it("joins names the way people write them", () => {
    assert.equal(joinNames([]), "");
    assert.equal(joinNames(["ferritin"]), "ferritin");
    assert.equal(joinNames(["ferritin", "HbA1c"]), "ferritin and HbA1c");
    assert.equal(joinNames(["ferritin", "HbA1c", "potassium"]), "ferritin, HbA1c and potassium");
    assert.equal(joinNames(["ferritin", "ferritin"]), "ferritin");
  });
  it("lower-cases words but keeps abbreviations", () => {
    assert.equal(midSentence("Haemoglobin"), "haemoglobin");
    assert.equal(midSentence("Vitamin D (25-OH)"), "vitamin D (25-OH)");
    assert.equal(midSentence("HbA1c"), "HbA1c");
    assert.equal(midSentence("ALT (SGPT)"), "ALT (SGPT)");
  });
  it("only accepts the two flags", () => {
    assert.equal(asFlag("doctor"), "doctor");
    assert.equal(asFlag("urgent"), "urgent");
    assert.equal(asFlag("other"), null);
    assert.equal(asFlag(null), null);
  });
});

describe("duplicate markers (QA H1)", () => {
  it("keeps the most severe reading of a marker printed twice", () => {
    const rows = [
      { key: "hba1c", status: "in_range", flag: null, v: 5.4 },
      { key: "ferritin", status: "low", flag: null, v: 24 },
      { key: "hba1c", status: "high", flag: "doctor", v: 7.1 },
    ];
    assert.deepEqual(keepMostSevere(rows).map((r) => r.v), [24, 7.1]);
  });
  it("ranks urgent over doctor over out of range over the rest", () => {
    const pick = (...rows: { key: string; status: string; flag: string | null; v: number }[]) => keepMostSevere(rows).map((r) => r.v);
    assert.deepEqual(pick({ key: "k", status: "high", flag: "doctor", v: 1 }, { key: "k", status: "high", flag: "urgent", v: 2 }), [2]);
    assert.deepEqual(pick({ key: "k", status: "high", flag: null, v: 1 }, { key: "k", status: "high", flag: "doctor", v: 2 }), [2]);
    assert.deepEqual(pick({ key: "k", status: "edge_low", flag: null, v: 1 }, { key: "k", status: "low", flag: null, v: 2 }), [2]);
  });
  it("keeps the first printed when two readings are equally severe", () => {
    const rows = [
      { key: "b12", status: "in_range", flag: null, v: 1 },
      { key: "b12", status: "edge_high", flag: null, v: 2 },
    ];
    assert.deepEqual(keepMostSevere(rows).map((r) => r.v), [1]);
  });
  it("keeps every marker that has no catalogue key", () => {
    const rows = [
      { key: null, status: "unknown", flag: null, v: 1 },
      { key: null, status: "unknown", flag: null, v: 2 },
    ];
    assert.equal(keepMostSevere(rows).length, 2);
  });
});

describe("the read's verdict", () => {
  it("leaves an unflagged read alone", () => {
    assert.deepEqual(floorVerdict(ready, { markers: [marker("ferritin", "Ferritin", "low")] }), ready);
  });
  it("forces doctor first with fixed words that name the event", () => {
    const v = floorVerdict(ready, { markers: [marker("hba1c", "HbA1c", "high", "doctor")], eventName: "HYROX Mumbai" });
    assert.deepEqual(v, {
      level: "doctor_first",
      line: "See a doctor before HYROX Mumbai.",
      detail: "Your HbA1c is worth a doctor's look before you push hard.",
    });
  });
  it("says 'show a doctor first' without an event, and 'are' for several markers", () => {
    const v = floorVerdict(ready, {
      markers: [marker("ferritin", "Ferritin", "low", "doctor"), marker("tsh", "Thyroid-stimulating hormone", "high", "doctor")],
    });
    assert.equal(v.line, "Show a doctor first.");
    assert.equal(v.detail, "Your ferritin and thyroid-stimulating hormone are worth a doctor's look before you push hard.");
  });
  it("asks for medical advice today on an urgent flag", () => {
    const v = floorVerdict(ready, {
      markers: [marker("potassium", "Potassium", "high", "urgent"), marker("hba1c", "HbA1c", "high", "doctor")],
      eventName: "Tata Mumbai Marathon.",
    });
    assert.equal(v.level, "doctor_first");
    assert.equal(v.line, "See a doctor before Tata Mumbai Marathon.");
    assert.equal(v.detail, "Get medical advice today about potassium. Your HbA1c is worth a doctor's look before you push hard.");
  });
  it("replaces model wording that contradicts the flag, at any level", () => {
    for (const level of ["go", "go_with_tweaks", "build", "doctor_first"] as const) {
      const v = floorVerdict({ level, line: "Ready to race.", detail: "All good." }, { markers: [marker("ldl", "LDL cholesterol", "high", "doctor")] });
      assert.equal(v.level, "doctor_first");
      assert.equal(v.line, "Show a doctor first.");
    }
  });
  it("never says 'go' when a marker's unit couldn't be checked (QA H1)", () => {
    const v = floorVerdict(ready, { markers: [], unchecked: ["Vitamin D (25-OH)"] });
    assert.equal(v.level, "go_with_tweaks");
    assert.equal(v.line, ready.line);
    assert.equal(v.detail, "Nothing holds you back. Confirm your vitamin D (25-OH) with your lab or a doctor: we couldn't check its unit.");
    const two = floorVerdict(ready, { markers: [], unchecked: ["HbA1c", "Fasting glucose"] });
    assert.match(two.detail, /Confirm your HbA1c and fasting glucose .* their units\.$/);
  });
  it("leaves other levels alone when a unit couldn't be checked", () => {
    const build: Verdict = { level: "build", line: "Build first.", detail: "Iron is low." };
    assert.deepEqual(floorVerdict(build, { markers: [], unchecked: ["HbA1c"] }), build);
  });
  it("lets a flag win over an unchecked unit", () => {
    const v = floorVerdict(ready, { markers: [marker("hba1c", "HbA1c", "high", "doctor")], unchecked: ["Fasting glucose"] });
    assert.equal(v.level, "doctor_first");
  });
});

describe("the stack (QA H2)", () => {
  const item = (nutrient: string, markers: string[], form = "Tablet") => ({
    nutrient,
    why: "",
    markers,
    diet_gap: null,
    form,
    dose: "1 a day",
    timing: "With lunch",
    duration: "12 weeks",
    cautions: null,
    brands: [],
  });
  const plan = (items: ReturnType<typeof item>[], see_doctor: string[] = []) => ({
    items,
    skip: [] as { name: string; why: string }[],
    food_first: ["Dal with lemon"],
    see_doctor,
  });

  it("keeps items for unflagged markers", () => {
    const out = floorStack(plan([item("Vitamin D3", ["vitamin_d"])]), [marker("vitamin_d", "Vitamin D (25-OH)", "low")]);
    assert.equal(out.items.length, 1);
    assert.deepEqual(out.see_doctor, []);
  });
  it("removes an item that treats a flagged marker, however the key is written", () => {
    const flagged = [marker("vitamin_d", "Vitamin D (25-OH)", "low", "doctor")];
    for (const written of ["vitamin_d", "Vitamin D", "VITAMIN-D"]) {
      const out = floorStack(plan([item("Vitamin D3", [written]), item("Magnesium", ["magnesium"])]), flagged);
      assert.deepEqual(out.items.map((i) => i.nutrient), ["Magnesium"], written);
    }
  });
  it("adds every flagged marker to see_doctor unless it's already there", () => {
    const flagged = [marker("hba1c", "HbA1c", "high", "doctor"), marker("tsh", "Thyroid-stimulating hormone", "high", "doctor")];
    const out = floorStack(plan([], ["Your HbA1c is high: ask your doctor about it."]), flagged);
    assert.equal(out.see_doctor.length, 2);
    assert.equal(out.see_doctor[0], "Your HbA1c is high: ask your doctor about it.");
    assert.equal(out.see_doctor[1], "Thyroid-stimulating hormone: flagged on your report. Show a doctor before you take anything for it.");
  });
  it("matches whole words, so ALT isn't 'covered' by a line about health", () => {
    const out = floorStack(plan([], ["Talk to a doctor about your overall health."]), [marker("alt", "ALT (SGPT)", "high", "doctor")]);
    assert.equal(out.see_doctor.length, 2);
  });
  it("gives no items at all when any marker is urgent", () => {
    const out = floorStack(plan([item("Vitamin D3", ["vitamin_d"]), item("Omega-3", [])]), [
      marker("vitamin_d", "Vitamin D (25-OH)", "low"),
      marker("potassium", "Potassium", "high", "urgent"),
    ]);
    assert.deepEqual(out.items, []);
    assert.deepEqual(out.food_first, ["Dal with lemon"]);
    assert.deepEqual(out.see_doctor, ["Potassium: get medical advice today, before you take anything for it."]);
  });
  it("allows iron only when ferritin is measured and low", () => {
    const iron = item("Iron", ["hemoglobin"], "Ferrous bisglycinate");
    const low = floorStack(plan([iron]), [marker("ferritin", "Ferritin", "low")]);
    assert.equal(low.items.length, 1);

    const fine = floorStack(plan([iron]), [marker("ferritin", "Ferritin", "in_range")]);
    assert.deepEqual(fine.items, []);
    assert.deepEqual(fine.skip, [{ name: "Iron", why: "Your ferritin isn't low, so extra iron isn't needed." }]);

    const untested = floorStack(plan([item("Multivitamin", [], "Carbonyl iron with folic acid")]), []);
    assert.deepEqual(untested.items, []);
    assert.equal(untested.skip[0].why, "There's no ferritin on this report. Test it before taking iron.");
  });
  it("sends a flagged ferritin to the doctor even when the iron item names other markers", () => {
    const out = floorStack(plan([item("Iron", ["hemoglobin"])]), [marker("ferritin", "Ferritin", "low", "doctor")]);
    assert.deepEqual(out.items, []);
    assert.deepEqual(out.skip, []);
    assert.equal(out.see_doctor.length, 1);
  });
  it("doesn't mistake vitamin C taken with iron-rich food for an iron supplement", () => {
    const out = floorStack(plan([item("Vitamin C", ["ferritin"], "Take with iron-rich meals")]), [marker("ferritin", "Ferritin", "edge_low")]);
    assert.equal(out.items.length, 1);
  });
  it("leaves the plan it was given unchanged", () => {
    const p = plan([item("Vitamin D3", ["vitamin_d"])]);
    floorStack(p, [marker("vitamin_d", "Vitamin D (25-OH)", "low", "doctor")]);
    assert.equal(p.items.length, 1);
    assert.deepEqual(p.see_doctor, []);
  });
});
