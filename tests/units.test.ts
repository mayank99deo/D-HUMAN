// QA finding H1: doctor and urgent flags must work whichever units a lab prints.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flagFor, markerDef, toCatalogUnit, unitKnown } from "../lib/domain/markers.ts";

const def = (k: string) => markerDef(k)!;

describe("unit conversions for safety flags", () => {
  it("flags platelets printed per cumm or in lakhs", () => {
    assert.equal(flagFor(def("platelets"), 45000, "/cumm", "male"), "urgent");
    assert.equal(flagFor(def("platelets"), 0.45, "lakhs/cumm", "female"), "urgent");
    assert.equal(flagFor(def("platelets"), 0.9, "Lakhs/cumm", "female"), "doctor");
    assert.equal(flagFor(def("platelets"), 250000, "cells/cumm", "male"), null);
    assert.equal(flagFor(def("platelets"), 2.5, "lakhs/cumm", "male"), null);
  });
  it("flags glucose in mmol/L and HbA1c in mmol/mol", () => {
    assert.equal(flagFor(def("glucose_fasting"), 7.5, "mmol/L", "male"), "doctor");
    assert.equal(flagFor(def("glucose_fasting"), 18, "mmol/L", "male"), "urgent");
    assert.equal(flagFor(def("glucose_fasting"), 5.2, "mmol/L", "male"), null);
    assert.equal(flagFor(def("hba1c"), 53, "mmol/mol", "female"), "doctor"); // about 7.0%
    assert.equal(flagFor(def("hba1c"), 36, "mmol/mol", "female"), null); // about 5.4%
  });
  it("flags vitamin D in nmol/L and other SI units", () => {
    assert.equal(flagFor(def("vitamin_d"), 20, "nmol/L", "male"), "doctor"); // about 8 ng/mL
    assert.equal(flagFor(def("vitamin_d"), 75, "nmol/L", "male"), null);
    assert.equal(flagFor(def("hemoglobin"), 65, "g/L", "female"), "urgent");
    assert.equal(flagFor(def("ldl"), 5.2, "mmol/L", "male"), "doctor"); // about 201 mg/dL
    assert.equal(flagFor(def("creatinine"), 200, "µmol/L", "male"), "doctor"); // about 2.3 mg/dL
  });
  it("converts with standard factors and still knows the catalogue units", () => {
    assert.ok(Math.abs(toCatalogUnit(def("vitamin_d"), 50, "nmol/L")! - 20.03) < 0.1);
    assert.ok(Math.abs(toCatalogUnit(def("hba1c"), 48, "mmol/mol")! - 6.54) < 0.05);
    assert.equal(toCatalogUnit(def("ferritin"), 40, "ng/mL"), 40);
  });
  it("says when a unit can't be checked", () => {
    assert.equal(unitKnown(def("vitamin_d"), "ng/mL"), true);
    assert.equal(unitKnown(def("vitamin_d"), "nmol/L"), true);
    assert.equal(unitKnown(def("vitamin_d"), "furlongs"), false);
    assert.equal(flagFor(def("vitamin_d"), 1, "furlongs", "male"), null);
  });
});
