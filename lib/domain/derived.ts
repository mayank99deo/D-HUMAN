// Ratios and markers worked out in code from the ones a report prints, so Claude
// never has to copy or calculate them. Added only when the lab didn't print the
// marker itself. All inputs are converted to the catalogue's units first.

import { markerDef, toCatalogUnit } from "./markers.ts";

export type Reading = { key: string | null | undefined; value: number | null; unit: string | null };
export type DerivedReading = { key: string; value: number; unit: string; from: string[] };

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

export function deriveMarkers(readings: Reading[]): DerivedReading[] {
  const present = new Set(readings.filter((r) => r.key && r.value != null).map((r) => r.key as string));
  // Each marker's value in the catalogue's unit, when we can convert it.
  const v = (key: string): number | null => {
    const r = readings.find((x) => x.key === key && x.value != null);
    const def = markerDef(key);
    if (!r || r.value == null || !def) return null;
    const n = toCatalogUnit(def, r.value, r.unit);
    return n != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  const out: DerivedReading[] = [];
  const add = (key: string, value: number | null, from: string[], places = 2) => {
    if (present.has(key) || value == null || !Number.isFinite(value) || value <= 0) return;
    const def = markerDef(key);
    if (!def) return;
    out.push({ key, value: round(value, places), unit: def.unit, from });
    present.add(key);
  };
  const ratio = (a: number | null, b: number | null) => (a != null && b != null ? a / b : null);

  const tc = v("total_cholesterol");
  const hdl = v("hdl");
  const ldl = v("ldl");
  const tg = v("triglycerides");
  add("non_hdl", tc != null && hdl != null ? tc - hdl : null, ["total_cholesterol", "hdl"], 0);
  add("tc_hdl_ratio", ratio(tc, hdl), ["total_cholesterol", "hdl"]);
  add("ldl_hdl_ratio", ratio(ldl, hdl), ["ldl", "hdl"]);
  add("tg_hdl_ratio", ratio(tg, hdl), ["triglycerides", "hdl"]);
  add("apob_apoa1_ratio", ratio(v("apob"), v("apoa1")), ["apob", "apoa1"]);

  // Neutrophil to lymphocyte ratio from absolute counts, else from percentages.
  const nlr = ratio(v("neutrophils"), v("lymphocytes")) ?? ratio(v("neutrophils_pct"), v("lymphocytes_pct"));
  add("nlr", nlr, ["neutrophils", "lymphocytes"]);

  // Liver proteins and bilirubin.
  const albumin = v("albumin");
  const protein = v("total_protein");
  add("globulin", protein != null && albumin != null ? protein - albumin : null, ["total_protein", "albumin"], 1);
  add("ag_ratio", ratio(albumin, v("globulin") ?? (protein != null && albumin != null ? protein - albumin : null)), ["albumin", "globulin"]);
  const biliT = v("bilirubin_total");
  const biliD = v("bilirubin_direct");
  add("bilirubin_indirect", biliT != null && biliD != null ? biliT - biliD : null, ["bilirubin_total", "bilirubin_direct"]);

  // Kidney: BUN from urea when only urea is printed (urea ÷ 2.14), then BUN to creatinine.
  const bun = v("bun") ?? (v("urea") != null ? v("urea")! / 2.14 : null);
  add("bun_creatinine_ratio", ratio(bun, v("creatinine")), ["bun", "creatinine"], 1);

  // Insulin resistance: fasting glucose (mg/dL) × fasting insulin (µIU/mL) ÷ 405.
  const glucose = v("glucose_fasting");
  const insulin = v("insulin_fasting");
  add("homa_ir", glucose != null && insulin != null ? (glucose * insulin) / 405 : null, ["glucose_fasting", "insulin_fasting"]);

  // Free androgen index: 100 × testosterone (nmol/L) ÷ SHBG (nmol/L); ng/dL × 0.0347 = nmol/L.
  const tt = v("testosterone_total");
  add("fai", tt != null && v("shbg") != null ? (100 * tt * 0.0347) / v("shbg")! : null, ["testosterone_total", "shbg"], 1);

  return out;
}
