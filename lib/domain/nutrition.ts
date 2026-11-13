import type { Archetype } from "./persona";

// Daily targets from the profile. Energy: Mifflin–St Jeor resting rate times an
// activity factor. Protein: ICMR-NIN 2020's 0.83 g/kg for sedentary adults, rising
// towards the 1.4–2.0 g/kg that sports nutrition groups suggest for people who train.
// Micronutrients: ICMR-NIN 2020 recommended dietary allowances for adults.

export const MICROS = [
  { key: "iron_mg", label: "Iron", unit: "mg" },
  { key: "calcium_mg", label: "Calcium", unit: "mg" },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg" },
  { key: "zinc_mg", label: "Zinc", unit: "mg" },
  { key: "b12_ug", label: "Vitamin B12", unit: "µg" },
  { key: "folate_ug", label: "Folate", unit: "µg" },
  { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg" },
  { key: "vitamin_d_iu", label: "Vitamin D", unit: "IU" },
] as const;
export type MicroKey = (typeof MICROS)[number]["key"];
export type Micros = Record<MicroKey, number>;

const RDA: Record<"male" | "female", Micros> = {
  male: { iron_mg: 19, calcium_mg: 1000, magnesium_mg: 440, zinc_mg: 17, b12_ug: 2.5, folate_ug: 300, vitamin_c_mg: 80, vitamin_d_iu: 600 },
  female: { iron_mg: 29, calcium_mg: 1000, magnesium_mg: 370, zinc_mg: 13.2, b12_ug: 2.5, folate_ug: 220, vitamin_c_mg: 65, vitamin_d_iu: 600 },
};

export type Targets = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number;
  micros: Micros;
  basis: string[]; // plain notes on how each was set
  estimated: boolean; // true when height/weight/age were missing
};

type Input = {
  sex?: string | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  level?: string | null;
  archetype?: Archetype;
  goals?: string[] | null;
};

export const ACTIVITY_FACTOR: Record<string, number> = { starting: 1.3, regular: 1.5, competitive: 1.65, elite: 1.8 };
export const PROTEIN_PER_KG: Record<string, number> = { starting: 0.9, regular: 1.4, competitive: 1.6, elite: 1.8 };

export function targetsFor(p: Input): Targets {
  const female = p.sex === "female";
  const estimated = !(p.weightKg && p.heightCm && p.age);
  const weight = p.weightKg || (female ? 58 : 70);
  const height = p.heightCm || (female ? 158 : 170);
  const age = p.age || 32;
  const level = p.level || "regular";
  const goals = p.goals ?? [];

  const bmr = 10 * weight + 6.25 * height - 5 * age + (female ? -161 : 5);
  let kcal = bmr * (ACTIVITY_FACTOR[level] ?? 1.5);
  const basis = [`Energy: resting rate (Mifflin–St Jeor) × ${ACTIVITY_FACTOR[level] ?? 1.5} for a ${level} level`];
  if (goals.includes("fat_loss")) {
    kcal *= 0.85;
    basis.push("15% under maintenance for steady fat loss");
  } else if (goals.includes("muscle")) {
    kcal *= 1.1;
    basis.push("10% over maintenance to build muscle");
  }

  let perKg = PROTEIN_PER_KG[level] ?? 1.4;
  if (p.archetype === "strength" || p.archetype === "hyrox") perKg = Math.max(perKg, 1.6);
  if (goals.includes("muscle") || goals.includes("fat_loss")) perKg = Math.max(perKg, 1.6);
  perKg = Math.min(perKg, 2.0);
  const proteinG = Math.round(weight * perKg);
  basis.push(`Protein: ${perKg} g per kg of body weight`);

  const fatG = Math.round((kcal * 0.27) / 9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  basis.push("Fat about 27% of energy; carbohydrate fills the rest");
  basis.push("Micronutrients: ICMR-NIN 2020 allowances for adults");

  return {
    kcal: Math.round(kcal / 10) * 10,
    proteinG,
    carbsG,
    fatG,
    fibreG: 30,
    micros: RDA[female ? "female" : "male"],
    basis,
    estimated,
  };
}

export const emptyMicros = (): Micros => ({
  iron_mg: 0, calcium_mg: 0, magnesium_mg: 0, zinc_mg: 0, b12_ug: 0, folate_ug: 0, vitamin_c_mg: 0, vitamin_d_iu: 0,
});
