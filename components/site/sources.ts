import type { Source } from "./Guide";

// Every number on a guide page comes from one of these, named on the page.
// ICMR-NIN's brief note was read on 2026-11-13: tables 1a (energy), 2a (protein),
// 3 and 4 (vitamins and minerals). Before changing a number, check it there.

export const ICMR_NIN_2020: Source = {
  id: "icmr-nin-2020",
  text: "ICMR-National Institute of Nutrition. A brief note on Nutrient Requirements for Indians, the Recommended Dietary Allowances (RDA) and the Estimated Average Requirements (EAR), 2020.",
  url: "https://www.nin.res.in/rdabook/brief_note.pdf",
};

export const IFCT_2017: Source = {
  id: "ifct-2017",
  text: "Longvah T, et al. Indian Food Composition Tables (IFCT) 2017. ICMR-National Institute of Nutrition, Hyderabad.",
};

export const MIFFLIN_1990: Source = {
  id: "mifflin-1990",
  text: "Mifflin MD, St Jeor ST, et al. A new predictive equation for resting energy expenditure in healthy individuals. American Journal of Clinical Nutrition, 1990; 51(2): 241–247.",
  url: "https://doi.org/10.1093/ajcn/51.2.241",
};

export const ISSN_2017: Source = {
  id: "issn-2017",
  text: "Jäger R, et al. International Society of Sports Nutrition position stand: protein and exercise. Journal of the International Society of Sports Nutrition, 2017; 14: 20.",
  url: "https://doi.org/10.1186/s12970-017-0177-8",
};

// The house attribution for the 76% figure: no lab is named on public pages.
export const VITAMIN_D_RESEARCH: Source = {
  id: "vitamin-d-2023",
  text: "Research across 2.2 lakh lab tests in 27 Indian cities, 2023: 76% of people tested were deficient in vitamin D.",
};

/** ICMR-NIN 2020, table 1a: energy for adults (kcal a day), at 65 kg for men and 55 kg for women. */
export const ICMR_ENERGY = [
  { work: "Sedentary", men: 2110, women: 1660 },
  { work: "Moderate", men: 2710, women: 2130 },
  { work: "Heavy", men: 3470, women: 2720 },
] as const;

/** ICMR-NIN 2020, table 2a: protein for healthy adults. */
export const ICMR_PROTEIN = {
  rdaPerKg: 0.83,
  earPerKg: 0.66,
  cerealDietPerKg: 1,
  refMan: { kg: 65, g: 54.0 },
  refWoman: { kg: 55, g: 45.7 },
  pregnancy: { second: 9.5, third: 22.0 },
  lactation: { first6: 16.9, next6: 13.2 },
  mix: "3:1:2.5",
} as const;

/** ISSN 2017: protein for most people who exercise, g per kg a day. */
export const ISSN_PROTEIN = { low: 1.4, high: 2.0 } as const;
