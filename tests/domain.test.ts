// Tests for the logic the platform's safety and personalisation rest on.
// Run with `npm test` (Node's built-in runner; Node 24 runs TypeScript directly).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJson } from "../lib/ai/json.ts";
import { factsFor } from "../lib/domain/facts.ts";
import { MARKERS, MARKER_KEYS, flagFor, markerDef, matchMarkerKey, sameUnit, statusFor, typicalRange } from "../lib/domain/markers.ts";
import { targetsFor } from "../lib/domain/nutrition.ts";
import { ACTIVITY_IDS } from "../lib/domain/options.ts";
import { periodRange } from "../lib/domain/periods.ts";
import { ageFrom, personaOf } from "../lib/domain/persona.ts";

describe("marker status", () => {
  it("reads below, inside and above a two-sided range", () => {
    assert.equal(statusFor(24, 30, 400), "low");
    assert.equal(statusFor(200, 30, 400), "in_range");
    assert.equal(statusFor(410, 30, 400), "high");
  });
  it("marks the outer tenth of a range as its edge", () => {
    assert.equal(statusFor(31, 30, 100), "edge_low");
    assert.equal(statusFor(98, 30, 100), "edge_high");
  });
  it("handles one-sided ranges", () => {
    assert.equal(statusFor(121, null, 100), "high");
    assert.equal(statusFor(95, null, 100), "edge_high");
    assert.equal(statusFor(60, null, 100), "in_range");
    assert.equal(statusFor(38, 40, null), "low");
    assert.equal(statusFor(58, 40, null), "in_range");
  });
  it("says unknown without a value or a range", () => {
    assert.equal(statusFor(null, 1, 2), "unknown");
    assert.equal(statusFor(5, null, null), "unknown");
  });
});

describe("doctor and urgent flags", () => {
  const def = (k: string) => markerDef(k)!;
  it("flags values that need a doctor", () => {
    assert.equal(flagFor(def("hba1c"), 6.5, "%", "male"), "doctor");
    assert.equal(flagFor(def("hba1c"), 6.4, "%", "male"), null);
    assert.equal(flagFor(def("ldl"), 195, "mg/dL", "female"), "doctor");
    assert.equal(flagFor(def("vitamin_d"), 8, "ng/mL", "male"), "doctor");
    assert.equal(flagFor(def("tsh"), 12, "µIU/mL", "female"), "doctor");
    assert.equal(flagFor(def("ferritin"), 12, "ng/mL", "female"), "doctor");
  });
  it("flags dangerous values as urgent", () => {
    assert.equal(flagFor(def("potassium"), 6.4, "mmol/L", "male"), "urgent");
    assert.equal(flagFor(def("hemoglobin"), 6.5, "g/dL", "female"), "urgent");
    assert.equal(flagFor(def("glucose_fasting"), 320, "mg/dL", "male"), "urgent");
    assert.equal(flagFor(def("sodium"), 122, "mmol/L", "male"), "urgent");
  });
  it("uses sex-specific haemoglobin bounds, and the cautious one when sex is unknown", () => {
    assert.equal(flagFor(def("hemoglobin"), 10.5, "g/dL", "male"), "doctor");
    assert.equal(flagFor(def("hemoglobin"), 10.5, "g/dL", "female"), null);
    assert.equal(flagFor(def("hemoglobin"), 10.5, "g/dL", null), "doctor");
  });
  it("never flags a unit it can't convert", () => {
    assert.equal(flagFor(def("glucose_fasting"), 18, "furlongs", "male"), null);
    assert.equal(flagFor(def("hba1c"), 60, "", "male"), null);
  });
  it("converts units it knows before flagging (QA H1)", () => {
    assert.equal(flagFor(def("glucose_fasting"), 18, "mmol/L", "male"), "urgent");
    assert.equal(flagFor(def("hba1c"), 60, "mmol/mol", "male"), "doctor");
  });
  it("leaves healthy values alone", () => {
    assert.equal(flagFor(def("ck"), 612, "U/L", "male"), null);
    assert.equal(flagFor(def("alt"), 34, "U/L", "male"), null);
  });
});

describe("marker names and units", () => {
  it("matches the names Indian labs print", () => {
    assert.equal(matchMarkerKey("25-OH Vitamin D"), "vitamin_d");
    assert.equal(matchMarkerKey("SGPT (ALT)"), "alt");
    assert.equal(matchMarkerKey("Serum Ferritin"), "ferritin");
    assert.equal(matchMarkerKey("Vitamin B12 (Cyanocobalamin), Serum"), "b12");
    assert.equal(matchMarkerKey("HbA1c"), "hba1c");
    assert.equal(matchMarkerKey("CPK"), "ck");
    assert.equal(matchMarkerKey("Total Leucocyte Count"), "wbc");
    assert.equal(matchMarkerKey("Something unrelated"), undefined);
  });
  it("treats equivalent unit spellings as the same", () => {
    assert.ok(sameUnit(markerDef("tsh")!, "mIU/L"));
    assert.ok(sameUnit(markerDef("hemoglobin")!, "gm/dL"));
    assert.ok(!sameUnit(markerDef("glucose_fasting")!, "mmol/L"));
  });
  it("has unique keys and sex-specific ranges where they matter", () => {
    assert.equal(new Set(MARKER_KEYS).size, MARKERS.length);
    assert.deepEqual(typicalRange(markerDef("ferritin")!, "female"), { low: 15, high: 150 });
    assert.equal(typicalRange(markerDef("ferritin")!, null), undefined);
  });
});

describe("persona", () => {
  it("makes the 40-year-old regular runner", () => {
    const p = personaOf({ name: "Priya Sharma", birthYear: 1986, primaryActivity: "running", activities: ["running"], level: "regular", goals: ["energy"] }, new Date("2026-11-09"));
    assert.equal(p.label, "Regular runner");
    assert.equal(p.bib, "40");
    assert.equal(p.firstName, "Priya");
    assert.equal(p.priorities[0], "ferritin");
    assert.ok(p.eventSearch?.includes("marathon"));
  });
  it("leans a HYROX athlete's priorities to iron and recovery", () => {
    const p = personaOf({ primaryActivity: "hyrox", level: "competitive", goals: ["muscle"] });
    assert.deepEqual(p.priorities.slice(0, 3), ["ferritin", "vitamin_d", "hscrp"]);
    assert.ok(p.priorities.includes("testosterone_total"));
  });
  it("puts haemoglobin first for trekkers", () => {
    assert.equal(personaOf({ primaryActivity: "trekking" }).priorities[0], "hemoglobin");
  });
  it("only uses markers the catalogue knows", () => {
    for (const a of ACTIVITY_IDS) for (const k of personaOf({ primaryActivity: a, goals: ["energy", "longevity", "sleep"] }).priorities) assert.ok(markerDef(k), `${a}: ${k}`);
  });
  it("rejects impossible ages", () => {
    assert.equal(ageFrom(1800, new Date("2026-01-01")), null);
    assert.equal(ageFrom(null), null);
  });
  it("has facts for every activity", () => {
    for (const a of ACTIVITY_IDS) assert.ok(factsFor(a).length >= 12, a);
  });
});

describe("nutrition targets", () => {
  it("sets a competitive HYROX athlete's protein at 1.6 g/kg or more", () => {
    const t = targetsFor({ sex: "male", age: 34, heightCm: 178, weightKg: 79, level: "competitive", archetype: "hyrox", goals: [] });
    assert.equal(t.proteinG, Math.round(79 * 1.6));
    assert.ok(t.kcal > 2800 && t.kcal < 3400, String(t.kcal));
    assert.equal(t.estimated, false);
  });
  it("uses women's ICMR-NIN allowances for iron", () => {
    assert.equal(targetsFor({ sex: "female" }).micros.iron_mg, 29);
    assert.equal(targetsFor({ sex: "male" }).micros.iron_mg, 19);
  });
  it("trims energy for fat loss and says so", () => {
    const base = targetsFor({ sex: "female", age: 40, heightCm: 160, weightKg: 62, level: "regular" });
    const cut = targetsFor({ sex: "female", age: 40, heightCm: 160, weightKg: 62, level: "regular", goals: ["fat_loss"] });
    assert.ok(cut.kcal < base.kcal);
    assert.ok(cut.basis.some((b) => b.includes("fat loss")));
  });
});

describe("wrap periods", () => {
  it("runs weeks Monday to Sunday", () => {
    assert.deepEqual(periodRange("week", "2026-11-09"), { start: "2026-11-09", end: "2026-11-15" });
    assert.deepEqual(periodRange("week", "2026-11-15"), { start: "2026-11-09", end: "2026-11-15" });
    assert.deepEqual(periodRange("week", "2026-11-09", -1), { start: "2026-11-02", end: "2026-11-08" });
  });
  it("handles month and year edges", () => {
    assert.deepEqual(periodRange("month", "2026-03-15", -1), { start: "2026-02-01", end: "2026-02-28" });
    assert.deepEqual(periodRange("month", "2026-01-10", -1), { start: "2025-12-01", end: "2025-12-31" });
    assert.deepEqual(periodRange("year", "2026-06-01"), { start: "2026-01-01", end: "2026-12-31" });
  });
});

describe("reading Claude's JSON replies", () => {
  it("takes the last fenced block", () => {
    assert.deepEqual(extractJson('Found these.\n```json\n{"a":1}\n```\nand\n```json\n{"events":[]}\n```'), { events: [] });
  });
  it("falls back to a bare object", () => {
    assert.deepEqual(extractJson('Here: {"x": [1, 2]} done'), { x: [1, 2] });
  });
  it("throws when there is no JSON", () => {
    assert.throws(() => extractJson("no json here"));
  });
});
