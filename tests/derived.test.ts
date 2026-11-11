// Ratios worked out in code (lib/domain/derived.ts) instead of by Claude.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveMarkers } from "../lib/domain/derived.ts";
import { differentialKey } from "../lib/domain/markers.ts";

const r = (key: string, value: number, unit: string) => ({ key, value, unit });
const find = (out: ReturnType<typeof deriveMarkers>, key: string) => out.find((d) => d.key === key)?.value;

describe("derived markers", () => {
  it("works out the cholesterol ratios", () => {
    const out = deriveMarkers([r("total_cholesterol", 182, "mg/dL"), r("hdl", 58, "mg/dL"), r("ldl", 121, "mg/dL"), r("triglycerides", 88, "mg/dL")]);
    assert.equal(find(out, "tc_hdl_ratio"), 3.14);
    assert.equal(find(out, "ldl_hdl_ratio"), 2.09);
    assert.equal(find(out, "tg_hdl_ratio"), 1.52);
    assert.equal(find(out, "non_hdl"), 124);
  });
  it("converts units before dividing", () => {
    const out = deriveMarkers([r("triglycerides", 1.5, "mmol/L"), r("hdl", 1.2, "mmol/L")]);
    assert.ok(Math.abs(find(out, "tg_hdl_ratio")! - 2.86) < 0.02); // 132.9 / 46.4 mg/dL
  });
  it("never replaces a ratio the lab printed", () => {
    const out = deriveMarkers([r("total_cholesterol", 200, "mg/dL"), r("hdl", 50, "mg/dL"), r("tc_hdl_ratio", 4.1, "ratio")]);
    assert.equal(find(out, "tc_hdl_ratio"), undefined);
  });
  it("works out NLR, globulin, A/G and indirect bilirubin", () => {
    const out = deriveMarkers([
      r("neutrophils_pct", 62, "%"), r("lymphocytes_pct", 30, "%"),
      r("total_protein", 7.2, "g/dL"), r("albumin", 4.4, "g/dL"),
      r("bilirubin_total", 0.9, "mg/dL"), r("bilirubin_direct", 0.2, "mg/dL"),
    ]);
    assert.equal(find(out, "nlr"), 2.07);
    assert.equal(find(out, "globulin"), 2.8);
    assert.equal(find(out, "ag_ratio"), 1.57);
    assert.equal(find(out, "bilirubin_indirect"), 0.7);
  });
  it("works out BUN to creatinine from urea, and HOMA-IR", () => {
    const out = deriveMarkers([r("urea", 30, "mg/dL"), r("creatinine", 1, "mg/dL"), r("glucose_fasting", 90, "mg/dL"), r("insulin_fasting", 9, "µIU/mL")]);
    assert.equal(find(out, "bun_creatinine_ratio"), 14);
    assert.equal(find(out, "homa_ir"), 2);
  });
  it("skips what it can't work out", () => {
    assert.deepEqual(deriveMarkers([r("hdl", 0, "mg/dL"), r("total_cholesterol", 180, "mg/dL")]), []);
    assert.deepEqual(deriveMarkers([r("triglycerides", 100, "furlongs"), r("hdl", 50, "mg/dL")]), []);
  });
});

describe("white-cell differentials", () => {
  it("lets the unit decide between a count and a percentage", () => {
    assert.equal(differentialKey("neutrophils", "%"), "neutrophils_pct");
    assert.equal(differentialKey("neutrophils_pct", "10^3/µL"), "neutrophils");
    assert.equal(differentialKey("lymphocytes_pct", "%"), "lymphocytes_pct");
    assert.equal(differentialKey("hemoglobin", "%"), "hemoglobin");
  });
});
