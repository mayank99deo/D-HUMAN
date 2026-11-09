// The markers D-Human knows by name. The lab's own reference range always wins;
// the ranges here are typical adult ranges, used only when a report prints none,
// and shown as "typical range" so nobody mistakes them for the lab's.
//
// `doctor` and `urgent` are deliberately conservative safety floors, checked only
// when the report's unit matches ours. They never diagnose; they decide when the
// app says "show this to a doctor" (soon) or "get medical advice today".

export type Sex = "male" | "female" | "intersex" | null | undefined;

type Range = { low?: number; high?: number };
type Bounds = { below?: number; above?: number };

export type MarkerDef = {
  key: string;
  name: string; // how we print it
  short: string; // for tiles
  panel: Panel;
  unit: string;
  units: string[]; // spellings that mean the same unit (lower-case, no spaces)
  aliases: string[];
  range?: Range | { male: Range; female: Range };
  doctor?: Bounds | { male: Bounds; female: Bounds };
  urgent?: Bounds;
  what: string; // one plain sentence
};

export type Panel =
  | "blood"
  | "iron"
  | "vitamins"
  | "thyroid"
  | "sugar"
  | "lipids"
  | "liver"
  | "kidney"
  | "minerals"
  | "inflammation"
  | "hormones"
  | "muscle";

export const PANELS: Record<Panel, string> = {
  blood: "Blood count",
  iron: "Iron",
  vitamins: "Vitamins",
  thyroid: "Thyroid",
  sugar: "Blood sugar",
  lipids: "Cholesterol",
  liver: "Liver",
  kidney: "Kidney",
  minerals: "Minerals",
  inflammation: "Inflammation",
  hormones: "Hormones",
  muscle: "Muscle",
};

const mgdl = ["mg/dl", "mg%"];

export const MARKERS: MarkerDef[] = [
  // Blood count
  {
    key: "hemoglobin", name: "Haemoglobin", short: "Hb", panel: "blood", unit: "g/dL", units: ["g/dl", "gm/dl", "gm%", "g%"],
    aliases: ["hemoglobin", "haemoglobin", "hb", "hgb"],
    range: { male: { low: 13, high: 17 }, female: { low: 12, high: 15 } },
    doctor: { male: { below: 11 }, female: { below: 10 } }, urgent: { below: 7 },
    what: "The protein in red blood cells that carries oxygen to your muscles and brain.",
  },
  {
    key: "rbc", name: "Red blood cells", short: "RBC", panel: "blood", unit: "million/µL", units: ["million/µl", "million/ul", "mill/cumm", "million/cumm", "10^6/µl", "10^6/ul"],
    aliases: ["rbc", "rbc count", "red blood cell count", "total rbc count", "erythrocyte count"],
    range: { male: { low: 4.5, high: 5.5 }, female: { low: 3.8, high: 4.8 } },
    what: "How many red blood cells you carry.",
  },
  {
    key: "hematocrit", name: "Haematocrit (PCV)", short: "PCV", panel: "blood", unit: "%", units: ["%"],
    aliases: ["hematocrit", "haematocrit", "pcv", "packed cell volume", "hct"],
    range: { male: { low: 40, high: 50 }, female: { low: 36, high: 46 } },
    what: "The share of your blood made of red cells.",
  },
  {
    key: "mcv", name: "Mean cell volume", short: "MCV", panel: "blood", unit: "fL", units: ["fl"],
    aliases: ["mcv", "mean corpuscular volume", "mean cell volume"],
    range: { low: 83, high: 101 },
    what: "The average size of your red cells. Small cells can point to low iron; large ones to low B12 or folate.",
  },
  {
    key: "wbc", name: "White blood cells", short: "WBC", panel: "blood", unit: "10³/µL", units: ["10^3/µl", "10^3/ul", "thou/µl", "thou/ul", "x10^3/µl", "10³/µl"],
    aliases: ["wbc", "tlc", "total leucocyte count", "total leukocyte count", "white blood cell count", "total wbc count"],
    range: { low: 4, high: 11 },
    what: "Your infection-fighting cells.",
  },
  {
    key: "platelets", name: "Platelets", short: "PLT", panel: "blood", unit: "10³/µL", units: ["10^3/µl", "10^3/ul", "thou/µl", "thou/ul", "x10^3/µl", "10³/µl"],
    aliases: ["platelets", "platelet count", "plt"],
    range: { low: 150, high: 410 },
    doctor: { below: 100, above: 600 }, urgent: { below: 50 },
    what: "Cell fragments that help blood clot.",
  },
  // Iron
  {
    key: "ferritin", name: "Ferritin", short: "Ferritin", panel: "iron", unit: "ng/mL", units: ["ng/ml", "µg/l", "ug/l", "mcg/l"],
    aliases: ["ferritin", "serum ferritin"],
    range: { male: { low: 30, high: 400 }, female: { low: 15, high: 150 } },
    doctor: { below: 15 },
    what: "Your stored iron. It often drops before haemoglobin does.",
  },
  {
    key: "iron", name: "Serum iron", short: "Iron", panel: "iron", unit: "µg/dL", units: ["µg/dl", "ug/dl", "mcg/dl"],
    aliases: ["iron", "serum iron", "iron serum"],
    range: { low: 60, high: 170 },
    what: "Iron moving in your blood right now. It swings through the day, so it's read alongside ferritin.",
  },
  {
    key: "tibc", name: "Total iron-binding capacity", short: "TIBC", panel: "iron", unit: "µg/dL", units: ["µg/dl", "ug/dl", "mcg/dl"],
    aliases: ["tibc", "total iron binding capacity"],
    range: { low: 250, high: 450 },
    what: "How much iron your blood could carry. It rises when stores run low.",
  },
  {
    key: "transferrin_sat", name: "Transferrin saturation", short: "TSAT", panel: "iron", unit: "%", units: ["%"],
    aliases: ["transferrin saturation", "tsat", "% saturation", "iron saturation", "transferrin saturation %"],
    range: { low: 20, high: 50 },
    what: "How full your iron carriers are.",
  },
  // Vitamins
  {
    key: "vitamin_d", name: "Vitamin D (25-OH)", short: "Vit D", panel: "vitamins", unit: "ng/mL", units: ["ng/ml"],
    aliases: ["vitamin d", "25-oh vitamin d", "25 hydroxy vitamin d", "vitamin d total", "25(oh)d", "vit d", "vitamin d3", "25-hydroxyvitamin d", "vitamin d (25-oh)"],
    range: { low: 30, high: 100 },
    doctor: { below: 10, above: 150 },
    what: "Made in your skin from sunlight. It matters for bones, muscles and immunity.",
  },
  {
    key: "b12", name: "Vitamin B12", short: "B12", panel: "vitamins", unit: "pg/mL", units: ["pg/ml"],
    aliases: ["vitamin b12", "b12", "cyanocobalamin", "vit b12", "cobalamin"],
    range: { low: 200, high: 900 },
    doctor: { below: 150 },
    what: "Needed for nerves and red blood cells. It comes almost only from animal foods.",
  },
  {
    key: "folate", name: "Folate", short: "Folate", panel: "vitamins", unit: "ng/mL", units: ["ng/ml"],
    aliases: ["folate", "folic acid", "serum folate", "vitamin b9"],
    range: { low: 4, high: 20 },
    what: "A B vitamin for making new cells, from leafy greens, dals and fortified foods.",
  },
  // Thyroid
  {
    key: "tsh", name: "Thyroid-stimulating hormone", short: "TSH", panel: "thyroid", unit: "µIU/mL", units: ["µiu/ml", "uiu/ml", "miu/l", "mu/l", "µu/ml", "uu/ml"],
    aliases: ["tsh", "thyroid stimulating hormone", "tsh ultrasensitive", "tsh 3rd generation"],
    range: { low: 0.4, high: 4.5 },
    doctor: { below: 0.1, above: 10 },
    what: "The brain's signal to your thyroid. High usually means the thyroid is underactive.",
  },
  {
    key: "ft4", name: "Free T4", short: "FT4", panel: "thyroid", unit: "ng/dL", units: ["ng/dl"],
    aliases: ["free t4", "ft4", "free thyroxine"],
    range: { low: 0.8, high: 1.8 },
    what: "The main thyroid hormone, free to act.",
  },
  {
    key: "ft3", name: "Free T3", short: "FT3", panel: "thyroid", unit: "pg/mL", units: ["pg/ml"],
    aliases: ["free t3", "ft3", "free triiodothyronine"],
    range: { low: 2.3, high: 4.2 },
    what: "The active thyroid hormone.",
  },
  // Blood sugar
  {
    key: "glucose_fasting", name: "Fasting glucose", short: "Glucose", panel: "sugar", unit: "mg/dL", units: mgdl,
    aliases: ["fasting glucose", "fasting blood sugar", "fbs", "glucose fasting", "plasma glucose fasting", "fasting plasma glucose"],
    range: { low: 70, high: 99 },
    doctor: { below: 60, above: 125 }, urgent: { below: 54, above: 300 },
    what: "Blood sugar after 8–12 hours without food.",
  },
  {
    key: "hba1c", name: "HbA1c", short: "HbA1c", panel: "sugar", unit: "%", units: ["%"],
    aliases: ["hba1c", "glycated haemoglobin", "glycosylated hemoglobin", "glycated hemoglobin", "a1c"],
    range: { low: 4, high: 5.6 },
    doctor: { above: 6.4 },
    what: "Your average blood sugar over roughly the last 2–3 months.",
  },
  {
    key: "insulin_fasting", name: "Fasting insulin", short: "Insulin", panel: "sugar", unit: "µIU/mL", units: ["µiu/ml", "uiu/ml", "miu/l", "mu/l"],
    aliases: ["fasting insulin", "insulin fasting", "serum insulin"],
    range: { low: 2, high: 25 },
    what: "How hard your body works to keep sugar in check.",
  },
  // Cholesterol
  {
    key: "total_cholesterol", name: "Total cholesterol", short: "Chol", panel: "lipids", unit: "mg/dL", units: mgdl,
    aliases: ["total cholesterol", "cholesterol total", "serum cholesterol", "cholesterol"],
    range: { high: 200 },
    what: "All the cholesterol in your blood, good and bad together.",
  },
  {
    key: "ldl", name: "LDL cholesterol", short: "LDL", panel: "lipids", unit: "mg/dL", units: mgdl,
    aliases: ["ldl", "ldl cholesterol", "ldl-c", "ldl direct", "low density lipoprotein", "ldl cholesterol direct"],
    range: { high: 100 },
    doctor: { above: 189 },
    what: "The cholesterol that builds up in artery walls over years.",
  },
  {
    key: "hdl", name: "HDL cholesterol", short: "HDL", panel: "lipids", unit: "mg/dL", units: mgdl,
    aliases: ["hdl", "hdl cholesterol", "hdl-c", "high density lipoprotein"],
    range: { male: { low: 40 }, female: { low: 50 } },
    what: "The cholesterol that helps clear the rest. Exercise tends to raise it.",
  },
  {
    key: "triglycerides", name: "Triglycerides", short: "TG", panel: "lipids", unit: "mg/dL", units: mgdl,
    aliases: ["triglycerides", "triglyceride", "tg", "serum triglycerides"],
    range: { high: 150 },
    doctor: { above: 499 }, urgent: { above: 1000 },
    what: "Fat in your blood. Sugar, refined carbs and alcohol push it up.",
  },
  {
    key: "non_hdl", name: "Non-HDL cholesterol", short: "Non-HDL", panel: "lipids", unit: "mg/dL", units: mgdl,
    aliases: ["non-hdl cholesterol", "non hdl cholesterol", "non-hdl"],
    range: { high: 130 },
    what: "Every cholesterol particle that can clog arteries.",
  },
  {
    key: "vldl", name: "VLDL cholesterol", short: "VLDL", panel: "lipids", unit: "mg/dL", units: mgdl,
    aliases: ["vldl", "vldl cholesterol"],
    range: { low: 5, high: 40 },
    what: "A carrier of triglycerides, usually calculated from them.",
  },
  // Liver
  {
    key: "alt", name: "ALT (SGPT)", short: "ALT", panel: "liver", unit: "U/L", units: ["u/l", "iu/l"],
    aliases: ["alt", "sgpt", "alanine aminotransferase", "alt (sgpt)", "sgpt (alt)"],
    range: { high: 40 },
    doctor: { above: 120 },
    what: "A liver enzyme. Heavy training can raise it for a few days too.",
  },
  {
    key: "ast", name: "AST (SGOT)", short: "AST", panel: "liver", unit: "U/L", units: ["u/l", "iu/l"],
    aliases: ["ast", "sgot", "aspartate aminotransferase", "ast (sgot)", "sgot (ast)"],
    range: { high: 40 },
    doctor: { above: 120 },
    what: "An enzyme found in liver and muscle, so hard workouts can raise it.",
  },
  {
    key: "alp", name: "Alkaline phosphatase", short: "ALP", panel: "liver", unit: "U/L", units: ["u/l", "iu/l"],
    aliases: ["alp", "alkaline phosphatase"],
    range: { low: 40, high: 130 },
    what: "An enzyme from liver and bone.",
  },
  {
    key: "ggt", name: "GGT", short: "GGT", panel: "liver", unit: "U/L", units: ["u/l", "iu/l"],
    aliases: ["ggt", "gamma gt", "gamma glutamyl transferase", "ggtp"],
    range: { male: { high: 55 }, female: { high: 38 } },
    what: "A liver enzyme that alcohol often pushes up.",
  },
  {
    key: "bilirubin_total", name: "Total bilirubin", short: "Bili", panel: "liver", unit: "mg/dL", units: mgdl,
    aliases: ["bilirubin total", "total bilirubin", "serum bilirubin total"],
    range: { low: 0.3, high: 1.2 },
    what: "A yellow pigment from old red cells, cleared by the liver.",
  },
  {
    key: "albumin", name: "Albumin", short: "Albumin", panel: "liver", unit: "g/dL", units: ["g/dl", "gm/dl"],
    aliases: ["albumin", "serum albumin"],
    range: { low: 3.5, high: 5 },
    what: "The main protein in blood, made by the liver.",
  },
  // Kidney
  {
    key: "creatinine", name: "Creatinine", short: "Creat", panel: "kidney", unit: "mg/dL", units: mgdl,
    aliases: ["creatinine", "serum creatinine", "creatinine serum"],
    range: { male: { low: 0.7, high: 1.3 }, female: { low: 0.6, high: 1.1 } },
    doctor: { above: 2 },
    what: "A muscle by-product your kidneys clear. More muscle means a little more of it.",
  },
  {
    key: "egfr", name: "eGFR", short: "eGFR", panel: "kidney", unit: "mL/min/1.73m²", units: ["ml/min/1.73m2", "ml/min/1.73m²", "ml/min/1.73 m2", "ml/min"],
    aliases: ["egfr", "estimated gfr", "estimated glomerular filtration rate"],
    range: { low: 90 },
    doctor: { below: 60 },
    what: "An estimate of how well your kidneys filter, worked out from creatinine and age.",
  },
  {
    key: "urea", name: "Urea", short: "Urea", panel: "kidney", unit: "mg/dL", units: mgdl,
    aliases: ["urea", "blood urea", "serum urea"],
    range: { low: 15, high: 45 },
    what: "A waste product from protein. High protein intake or low water can raise it.",
  },
  {
    key: "bun", name: "Blood urea nitrogen", short: "BUN", panel: "kidney", unit: "mg/dL", units: mgdl,
    aliases: ["bun", "blood urea nitrogen", "urea nitrogen"],
    range: { low: 7, high: 20 },
    what: "The nitrogen part of urea, another way labs report the same waste.",
  },
  {
    key: "uric_acid", name: "Uric acid", short: "Uric", panel: "kidney", unit: "mg/dL", units: mgdl,
    aliases: ["uric acid", "serum uric acid"],
    range: { male: { low: 3.5, high: 7.2 }, female: { low: 2.6, high: 6 } },
    what: "A waste product that can crystallise in joints when high.",
  },
  // Minerals
  {
    key: "sodium", name: "Sodium", short: "Na", panel: "minerals", unit: "mmol/L", units: ["mmol/l", "meq/l"],
    aliases: ["sodium", "serum sodium", "na", "na+"],
    range: { low: 135, high: 145 },
    doctor: { below: 130, above: 150 }, urgent: { below: 125, above: 155 },
    what: "Keeps fluid balance and nerve signals steady. Long sweaty efforts drain it.",
  },
  {
    key: "potassium", name: "Potassium", short: "K", panel: "minerals", unit: "mmol/L", units: ["mmol/l", "meq/l"],
    aliases: ["potassium", "serum potassium", "k", "k+"],
    range: { low: 3.5, high: 5.1 },
    doctor: { below: 3.3, above: 5.5 }, urgent: { below: 3, above: 6 },
    what: "Keeps your heart rhythm and muscles firing.",
  },
  {
    key: "calcium", name: "Calcium", short: "Ca", panel: "minerals", unit: "mg/dL", units: mgdl,
    aliases: ["calcium", "serum calcium", "total calcium", "ca"],
    range: { low: 8.6, high: 10.3 },
    doctor: { below: 8, above: 10.8 }, urgent: { below: 7, above: 12 },
    what: "Mostly in bone; the blood level is tightly controlled.",
  },
  {
    key: "magnesium", name: "Magnesium", short: "Mg", panel: "minerals", unit: "mg/dL", units: mgdl,
    aliases: ["magnesium", "serum magnesium", "mg"],
    range: { low: 1.7, high: 2.4 },
    what: "Helps muscles relax and nerves fire. Lost in sweat.",
  },
  // Inflammation
  {
    key: "hscrp", name: "hs-CRP", short: "hs-CRP", panel: "inflammation", unit: "mg/L", units: ["mg/l"],
    aliases: ["hs-crp", "hscrp", "high sensitivity crp", "high sensitivity c-reactive protein", "c-reactive protein high sensitivity"],
    range: { high: 3 },
    doctor: { above: 10 },
    what: "A sensitive sign of inflammation. Hard training and a cold can both raise it.",
  },
  {
    key: "crp", name: "CRP", short: "CRP", panel: "inflammation", unit: "mg/L", units: ["mg/l"],
    aliases: ["crp", "c-reactive protein", "c reactive protein"],
    range: { high: 6 },
    what: "A general sign of inflammation or infection.",
  },
  {
    key: "esr", name: "ESR", short: "ESR", panel: "inflammation", unit: "mm/hr", units: ["mm/hr", "mm/1st hr", "mm/1sthr", "mm/h"],
    aliases: ["esr", "erythrocyte sedimentation rate"],
    range: { male: { high: 15 }, female: { high: 20 } },
    what: "A slow, general sign of inflammation.",
  },
  {
    key: "homocysteine", name: "Homocysteine", short: "Hcy", panel: "inflammation", unit: "µmol/L", units: ["µmol/l", "umol/l"],
    aliases: ["homocysteine", "serum homocysteine"],
    range: { low: 5, high: 15 },
    what: "Rises when B12, folate or B6 run low.",
  },
  // Hormones
  {
    key: "testosterone_total", name: "Total testosterone", short: "Testo", panel: "hormones", unit: "ng/dL", units: ["ng/dl"],
    aliases: ["testosterone", "total testosterone", "testosterone total", "serum testosterone"],
    range: { male: { low: 264, high: 916 }, female: { low: 15, high: 70 } },
    what: "Drives muscle, bone and drive. It's highest in the morning.",
  },
  {
    key: "cortisol", name: "Cortisol (morning)", short: "Cortisol", panel: "hormones", unit: "µg/dL", units: ["µg/dl", "ug/dl", "mcg/dl"],
    aliases: ["cortisol", "serum cortisol", "cortisol morning", "morning cortisol"],
    range: { low: 6, high: 23 },
    what: "Your main stress hormone, highest in the morning.",
  },
  // Muscle
  {
    key: "ck", name: "Creatine kinase", short: "CK", panel: "muscle", unit: "U/L", units: ["u/l", "iu/l"],
    aliases: ["ck", "cpk", "creatine kinase", "creatine phosphokinase", "ck total", "cpk total"],
    range: { male: { low: 39, high: 308 }, female: { low: 26, high: 192 } },
    doctor: { above: 1500 },
    what: "Leaks from muscle after hard or new work. High after training is common.",
  },
];

export const MARKER_KEYS = MARKERS.map((m) => m.key) as [string, ...string[]];
const BY_KEY = new Map(MARKERS.map((m) => [m.key, m]));
export const markerDef = (key?: string | null) => (key ? BY_KEY.get(key) : undefined);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%()+-]+/g, " ").replace(/\s+/g, " ").trim();
const ALIAS = new Map<string, string>();
for (const m of MARKERS) for (const a of [m.key, m.name, ...m.aliases]) ALIAS.set(norm(a), m.key);

export function matchMarkerKey(printedName: string): string | undefined {
  const n = norm(printedName);
  if (ALIAS.has(n)) return ALIAS.get(n);
  // "Vitamin B12 (Cyanocobalamin), Serum" → try the part before the bracket or comma
  const head = norm(printedName.split(/[,(]/)[0] ?? "");
  return ALIAS.get(head);
}

const unitNorm = (u?: string | null) => (u ?? "").toLowerCase().replace(/\s+/g, "").replace("μ", "µ");
export const sameUnit = (def: MarkerDef, unit?: string | null) => {
  const u = unitNorm(unit);
  return u !== "" && (u === unitNorm(def.unit) || def.units.includes(u));
};

function bySex<T>(v: T | { male: T; female: T } | undefined, sex: Sex): T | undefined {
  if (!v) return undefined;
  if (typeof v === "object" && v !== null && "male" in v && "female" in v) {
    return sex === "female" ? v.female : sex === "male" ? v.male : undefined;
  }
  return v as T;
}

export const typicalRange = (def: MarkerDef, sex: Sex) => bySex(def.range, sex);

export type MarkerStatus = "low" | "edge_low" | "in_range" | "edge_high" | "high" | "unknown";
export type MarkerFlag = "doctor" | "urgent" | null;

// In range, but within the outer tenth of the band: worth watching, not acting on.
export function statusFor(value: number | null | undefined, low?: number | null, high?: number | null): MarkerStatus {
  if (value == null || Number.isNaN(value)) return "unknown";
  const hasLow = low != null;
  const hasHigh = high != null;
  if (!hasLow && !hasHigh) return "unknown";
  if (hasLow && value < low) return "low";
  if (hasHigh && value > high) return "high";
  if (hasLow && hasHigh) {
    const band = high - low;
    if (band > 0 && value < low + band * 0.1) return "edge_low";
    if (band > 0 && value > high - band * 0.1) return "edge_high";
  } else if (hasLow && value < low * 1.1) return "edge_low";
  else if (hasHigh && value > high * 0.9) return "edge_high";
  return "in_range";
}

export function flagFor(def: MarkerDef | undefined, value: number | null | undefined, unit: string | null | undefined, sex: Sex): MarkerFlag {
  if (!def || value == null || !sameUnit(def, unit)) return null;
  const hit = (b?: Bounds) => !!b && ((b.below != null && value < b.below) || (b.above != null && value > b.above));
  if (hit(def.urgent)) return "urgent";
  // Sex-specific doctor bounds fall back to the more cautious one when sex is unknown.
  const d = def.doctor;
  if (d && "male" in d && "female" in d) {
    const b = sex === "female" ? d.female : sex === "male" ? d.male : {
      below: Math.max(d.male.below ?? -Infinity, d.female.below ?? -Infinity),
      above: Math.min(d.male.above ?? Infinity, d.female.above ?? Infinity),
    };
    return hit({ below: Number.isFinite(b.below) ? b.below : undefined, above: Number.isFinite(b.above) ? b.above : undefined }) ? "doctor" : null;
  }
  return hit(d as Bounds | undefined) ? "doctor" : null;
}

export const isOut = (s: string) => s === "low" || s === "high";
export const isEdge = (s: string) => s === "edge_low" || s === "edge_high";
