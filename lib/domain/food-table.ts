// The food list behind meal and usual-day minerals: values per 100 g of the raw, edible food.
//
// Source: USDA FoodData Central, SR Legacy (April 2018), public domain (CC0 1.0), https://fdc.nal.usda.gov.
// Each row names the FoodData Central entry it comes from (src "fdc:<id>"); a value taken from a
// different entry says so in srcBy. "plant": USDA lists no B12 for that plant food, and plants carry none.
//
// Why not IFCT 2017, the Indian reference: its copyright page forbids storing it electronically for a
// product without ICMR-NIN's written permission, which was asked for on 2026-11-18. Rows use D-Human's
// own codes, so meals saved with codes and raw grams can be worked out again from another table
// (FOOD_TABLE_VERSION says which one a meal used).
//
// Choices, checked against IFCT 2017 in a one-off comparison outside the repo (no IFCT values are here):
// - Unenriched flours and rice: US enriched products carry added iron and folic acid.
// - Rice: parboiled rice uses white rice's values (USDA's parboiled rice lists 2.5 times the calcium).
// - Milk: buffalo milk uses cow milk's values (USDA's buffalo milk lists 3 times IFCT's magnesium).
// - Paneer: USDA's measured queso fresco, a fresh white cheese. FNDDS's "Cheese, paneer" (fdc 2705740)
//   is worked out from milk keeping every mineral, but acid-set paneer loses some calcium and magnesium
//   to the whey; queso fresco sat closer to measured paneer on calcium, magnesium and zinc.
// - Dals: USDA has only whole seeds for toor, moong and urad. Their zinc is within about 10% of split
//   dal, but magnesium runs 1.2-1.5 times and calcium 1.8-3 times higher, because the husk holds them.
//   Two bowls of dal a day add roughly 40 mg magnesium and 35-80 mg calcium.
// - Left out, so the model estimates them (saved as "ai"): foods USDA doesn't have (poha, ragi, jaggery,
//   kulthi, khoa, methi leaves, amla, Indian breads and biscuits), and USDA stand-ins that are a different
//   food and differed from IFCT by 1.5 times or more on a mineral: proso millet for bajra, plantain for
//   raw banana, Atlantic mackerel for bangda, shad for hilsa, common carp for rohu, channel catfish for
//   basa, butterfish for pomfret.
// - Spices are left out: a meal has a few grams. Iron comes out slightly low because of it.
// - Raw values times raw grams: minerals barely change in cooking. Folate and vitamin C do, by amounts
//   that depend on the method, so they stay AI estimates, like vitamin D (lib/domain/meal-minerals.ts).

/** Which table a meal's minerals came from. Change it whenever values change, so old meals can be found. */
export const FOOD_TABLE_VERSION = "usda-sr-2018-dh1";

export const SOURCES = {
  fdc: "USDA FoodData Central, SR Legacy (April 2018), public domain",
  plant: "A plant food: no vitamin B12",
} as const;

/** The nutrients the table gives. The rest (folate, vitamin C, vitamin D) stay AI estimates. */
export const TABLE_NUTRIENTS = ["iron_mg", "calcium_mg", "magnesium_mg", "zinc_mg", "b12_ug"] as const;
export type TableNutrient = (typeof TABLE_NUTRIENTS)[number];

export type FoodGroup = "grain" | "pulse" | "dairy" | "fat" | "egg" | "meat" | "fish" | "veg" | "fruit" | "nut" | "sugar" | "drink";

export type FoodRow = {
  /** What the model reads after the code in the food list, when the code alone isn't clear. */
  hint: string;
  group: FoodGroup;
  /** Energy per 100 g, for the energy check. */
  kcal: number;
  /** Where every value comes from, unless srcBy names another source for one of them. */
  src: string;
  srcBy?: Partial<Record<TableNutrient, string>>;
} & Record<TableNutrient, number>;

export const FOODS = {
  // Grains and flours, raw or dry
  atta: { hint: "whole wheat flour: roti, chapati, paratha, puri", group: "grain", kcal: 340, iron_mg: 3.6, calcium_mg: 34, magnesium_mg: 137, zinc_mg: 2.6, b12_ug: 0, src: "fdc:168893" },  // Wheat flour, whole-grain (Includes foods for USDA's Food Distribution Program)
  maida: { hint: "refined flour: naan, bhatura, kulcha, pav", group: "grain", kcal: 364, iron_mg: 1.17, calcium_mg: 15, magnesium_mg: 22, zinc_mg: 0.7, b12_ug: 0, src: "fdc:169761" },  // Wheat flour, white, all-purpose, unenriched
  suji: { hint: "rava, semolina: upma, rava idli", group: "grain", kcal: 360, iron_mg: 1.23, calcium_mg: 17, magnesium_mg: 47, zinc_mg: 1.05, b12_ug: 0, src: "fdc:168933" },  // Semolina, unenriched
  dalia: { hint: "broken wheat", group: "grain", kcal: 342, iron_mg: 2.46, calcium_mg: 35, magnesium_mg: 164, zinc_mg: 1.93, b12_ug: 0, src: "fdc:170688" },  // Bulgur, dry
  rice_white: { hint: "any raw rice, white or parboiled", group: "grain", kcal: 365, iron_mg: 0.8, calcium_mg: 28, magnesium_mg: 25, zinc_mg: 1.09, b12_ug: 0, src: "fdc:169756" },  // Rice, white, long-grain, regular, raw, unenriched
  rice_brown: { hint: "", group: "grain", kcal: 367, iron_mg: 1.29, calcium_mg: 9, magnesium_mg: 116, zinc_mg: 2.13, b12_ug: 0, src: "fdc:169703" },  // Rice, brown, long-grain, raw (Includes foods for USDA's Food Distribution Program)
  jowar: { hint: "sorghum: bhakri", group: "grain", kcal: 329, iron_mg: 3.36, calcium_mg: 13, magnesium_mg: 165, zinc_mg: 1.67, b12_ug: 0, src: "fdc:169716" },  // Sorghum grain
  makki: { hint: "maize flour", group: "grain", kcal: 361, iron_mg: 2.38, calcium_mg: 7, magnesium_mg: 93, zinc_mg: 1.73, b12_ug: 0, src: "fdc:170290" },  // Corn flour, whole-grain, yellow
  barley: { hint: "jau", group: "grain", kcal: 352, iron_mg: 2.5, calcium_mg: 29, magnesium_mg: 79, zinc_mg: 2.13, b12_ug: 0, src: "fdc:170284" },  // Barley, pearled, raw
  quinoa: { hint: "", group: "grain", kcal: 368, iron_mg: 4.57, calcium_mg: 47, magnesium_mg: 197, zinc_mg: 3.1, b12_ug: 0, src: "fdc:168874" },  // Quinoa, uncooked
  rajgira: { hint: "amaranth seed", group: "grain", kcal: 371, iron_mg: 7.61, calcium_mg: 159, magnesium_mg: 248, zinc_mg: 2.87, b12_ug: 0, src: "fdc:170682" },  // Amaranth grain, uncooked
  kuttu: { hint: "buckwheat flour", group: "grain", kcal: 335, iron_mg: 4.06, calcium_mg: 41, magnesium_mg: 251, zinc_mg: 3.12, b12_ug: 0, src: "fdc:170687" },  // Buckwheat flour, whole-groat
  oats: { hint: "", group: "grain", kcal: 379, iron_mg: 4.25, calcium_mg: 52, magnesium_mg: 138, zinc_mg: 3.64, b12_ug: 0, src: "fdc:173904" },  // Cereals, oats, regular and quick, not fortified, dry
  pasta: { hint: "pasta, macaroni", group: "grain", kcal: 371, iron_mg: 1.3, calcium_mg: 21, magnesium_mg: 53, zinc_mg: 1.41, b12_ug: 0, src: "fdc:168927" },  // Pasta, dry, unenriched
  // Pulses and soy, dry
  toor_dal: { hint: "arhar; sambar", group: "pulse", kcal: 343, iron_mg: 5.23, calcium_mg: 130, magnesium_mg: 183, zinc_mg: 2.76, b12_ug: 0, src: "fdc:172436" },  // Pigeon peas (red gram), mature seeds, raw
  moong: { hint: "green gram, whole or dal", group: "pulse", kcal: 347, iron_mg: 6.74, calcium_mg: 132, magnesium_mg: 189, zinc_mg: 2.68, b12_ug: 0, src: "fdc:174256" },  // Mung beans, mature seeds, raw
  urad: { hint: "black gram, whole or dal; idli and dosa batter, dal makhani", group: "pulse", kcal: 341, iron_mg: 7.57, calcium_mg: 138, magnesium_mg: 267, zinc_mg: 3.35, b12_ug: 0, src: "fdc:174259" },  // Mungo beans, mature seeds, raw
  masoor_dal: { hint: "red lentil, split", group: "pulse", kcal: 358, iron_mg: 7.39, calcium_mg: 48, magnesium_mg: 59, zinc_mg: 3.6, b12_ug: 0, src: "fdc:174284" },  // Lentils, pink or red, raw
  masoor_whole: { hint: "brown lentil", group: "pulse", kcal: 352, iron_mg: 6.51, calcium_mg: 35, magnesium_mg: 47, zinc_mg: 3.27, b12_ug: 0, src: "fdc:172420" },  // Lentils, raw
  chana: { hint: "chana dal, kala chana, kabuli chole", group: "pulse", kcal: 378, iron_mg: 4.31, calcium_mg: 57, magnesium_mg: 79, zinc_mg: 2.76, b12_ug: 0, src: "fdc:173756" },  // Chickpeas (garbanzo beans, bengal gram), mature seeds, raw
  besan: { hint: "gram flour: cheela, pakora, kadhi, dhokla", group: "pulse", kcal: 387, iron_mg: 4.86, calcium_mg: 45, magnesium_mg: 166, zinc_mg: 2.81, b12_ug: 0, src: "fdc:174288" },  // Chickpea flour (besan)
  rajma: { hint: "kidney beans", group: "pulse", kcal: 337, iron_mg: 6.69, calcium_mg: 83, magnesium_mg: 138, zinc_mg: 2.79, b12_ug: 0, src: "fdc:173744" },  // Beans, kidney, red, mature seeds, raw
  lobia: { hint: "black-eyed beans", group: "pulse", kcal: 336, iron_mg: 8.27, calcium_mg: 110, magnesium_mg: 184, zinc_mg: 3.37, b12_ug: 0, src: "fdc:173758" },  // Cowpeas, common (blackeyes, crowder, southern), mature seeds, raw
  moth: { hint: "matki: misal, usal", group: "pulse", kcal: 343, iron_mg: 10.85, calcium_mg: 150, magnesium_mg: 381, zinc_mg: 1.92, b12_ug: 0, src: "fdc:172425" },  // Mothbeans, mature seeds, raw
  dry_peas: { hint: "dried peas: ragda, safed or hara matar", group: "pulse", kcal: 364, iron_mg: 4.73, calcium_mg: 46, magnesium_mg: 63, zinc_mg: 3.49, b12_ug: 0, src: "fdc:172428" },  // Peas, green, split, mature seeds, raw
  soybean: { hint: "", group: "pulse", kcal: 446, iron_mg: 15.7, calcium_mg: 277, magnesium_mg: 280, zinc_mg: 4.89, b12_ug: 0, src: "fdc:174270" },  // Soybeans, mature seeds, raw
  soya_chunks: { hint: "chunks or granules", group: "pulse", kcal: 327, iron_mg: 9.24, calcium_mg: 241, magnesium_mg: 290, zinc_mg: 2.46, b12_ug: 0, src: "fdc:174275" },  // Soy flour, defatted
  tofu: { hint: "", group: "pulse", kcal: 78, iron_mg: 1.61, calcium_mg: 201, magnesium_mg: 37, zinc_mg: 0.83, b12_ug: 0, src: "fdc:172448" },  // Tofu, firm, prepared with calcium sulfate and magnesium chloride (nigari)
  // Milk, curd, paneer and cheese
  milk: { hint: "cow or buffalo, any fat level", group: "dairy", kcal: 61, iron_mg: 0.03, calcium_mg: 113, magnesium_mg: 10, zinc_mg: 0.37, b12_ug: 0.45, src: "fdc:172217" },  // Milk, whole, 3.25% milkfat, without added vitamin A and vitamin D
  curd: { hint: "dahi; the curd in raita, lassi, chaas", group: "dairy", kcal: 61, iron_mg: 0.05, calcium_mg: 121, magnesium_mg: 12, zinc_mg: 0.59, b12_ug: 0.37, src: "fdc:171284" },  // Yogurt, plain, whole milk
  paneer: { hint: "", group: "dairy", kcal: 299, iron_mg: 0.2, calcium_mg: 566, magnesium_mg: 24, zinc_mg: 2.58, b12_ug: 1.68, src: "fdc:172223" },  // Cheese, fresh, queso fresco
  cheese: { hint: "cheddar, processed slices or cubes", group: "dairy", kcal: 403, iron_mg: 0.14, calcium_mg: 710, magnesium_mg: 27, zinc_mg: 3.64, b12_ug: 1.1, src: "fdc:173414" },  // Cheese, cheddar (Includes foods for USDA's Food Distribution Program)
  cream: { hint: "fresh cream, malai", group: "dairy", kcal: 340, iron_mg: 0.1, calcium_mg: 66, magnesium_mg: 7, zinc_mg: 0.24, b12_ug: 0.16, src: "fdc:170859" },  // Cream, fluid, heavy whipping
  // Fats
  butter: { hint: "", group: "fat", kcal: 717, iron_mg: 0.02, calcium_mg: 24, magnesium_mg: 2, zinc_mg: 0.09, b12_ug: 0.17, src: "fdc:173410" },  // Butter, salted
  ghee: { hint: "", group: "fat", kcal: 876, iron_mg: 0, calcium_mg: 4, magnesium_mg: 0, zinc_mg: 0.01, b12_ug: 0.01, src: "fdc:173412" },  // Butter oil, anhydrous
  // Eggs, raw
  egg: { hint: "whole, 50 g each", group: "egg", kcal: 143, iron_mg: 1.75, calcium_mg: 56, magnesium_mg: 12, zinc_mg: 1.29, b12_ug: 0.89, src: "fdc:171287" },  // Egg, whole, raw, fresh
  egg_white: { hint: "", group: "egg", kcal: 52, iron_mg: 0.08, calcium_mg: 7, magnesium_mg: 11, zinc_mg: 0.03, b12_ug: 0.09, src: "fdc:172183" },  // Egg, white, raw, fresh
  // Meat, raw, without bone
  chicken: { hint: "curry cut, leg or thigh, without bone or skin", group: "meat", kcal: 119, iron_mg: 0.89, calcium_mg: 12, magnesium_mg: 25, zinc_mg: 1.54, b12_ug: 0.37, src: "fdc:171052" },  // Chicken, broilers or fryers, meat only, raw
  chicken_breast: { hint: "boneless, skinless", group: "meat", kcal: 120, iron_mg: 0.37, calcium_mg: 5, magnesium_mg: 28, zinc_mg: 0.68, b12_ug: 0.21, src: "fdc:171077" },  // Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw
  chicken_liver: { hint: "", group: "meat", kcal: 119, iron_mg: 8.99, calcium_mg: 8, magnesium_mg: 19, zinc_mg: 2.67, b12_ug: 16.58, src: "fdc:171060" },  // Chicken, liver, all classes, raw
  mutton: { hint: "goat, without bone; keema", group: "meat", kcal: 109, iron_mg: 2.83, calcium_mg: 13, magnesium_mg: 19, zinc_mg: 4, b12_ug: 1.13, src: "fdc:175303", srcBy: { magnesium_mg: "fdc:174338" } },  // Game meat, goat, raw
  lamb: { hint: "", group: "meat", kcal: 128, iron_mg: 1.64, calcium_mg: 8, magnesium_mg: 19, zinc_mg: 3.01, b12_ug: 2.71, src: "fdc:174338" },  // Lamb, New Zealand, imported, frozen, composite of trimmed retail cuts, separable lean only, raw
  liver_mutton: { hint: "kaleji", group: "meat", kcal: 139, iron_mg: 7.37, calcium_mg: 7, magnesium_mg: 19, zinc_mg: 4.66, b12_ug: 90.05, src: "fdc:172531" },  // Lamb, variety meats and by-products, liver, raw
  beef: { hint: "beef or buffalo, lean", group: "meat", kcal: 138, iron_mg: 2.08, calcium_mg: 13, magnesium_mg: 18, zinc_mg: 4.86, b12_ug: 2.1, src: "fdc:174760" },  // Beef, composite of trimmed retail cuts, separable lean only, trimmed to 0" fat, all grades, raw
  pork: { hint: "lean", group: "meat", kcal: 148, iron_mg: 1.22, calcium_mg: 14, magnesium_mg: 21, zinc_mg: 3.14, b12_ug: 0.84, src: "fdc:167845" },  // Pork, fresh, shoulder, whole, separable lean only, raw
  // Fish and seafood, raw, edible part
  surmai: { hint: "seer fish, king fish", group: "fish", kcal: 105, iron_mg: 1.78, calcium_mg: 31, magnesium_mg: 32, zinc_mg: 0.56, b12_ug: 15.6, src: "fdc:175122" },  // Fish, mackerel, king, raw
  tuna: { hint: "", group: "fish", kcal: 109, iron_mg: 0.77, calcium_mg: 4, magnesium_mg: 35, zinc_mg: 0.37, b12_ug: 2.08, src: "fdc:175159" },  // Fish, tuna, fresh, yellowfin, raw
  salmon: { hint: "", group: "fish", kcal: 208, iron_mg: 0.34, calcium_mg: 9, magnesium_mg: 27, zinc_mg: 0.36, b12_ug: 3.23, src: "fdc:175167" },  // Fish, salmon, Atlantic, farmed, raw
  tilapia: { hint: "", group: "fish", kcal: 96, iron_mg: 0.56, calcium_mg: 10, magnesium_mg: 27, zinc_mg: 0.33, b12_ug: 1.58, src: "fdc:175176" },  // Fish, tilapia, raw
  prawns: { hint: "shrimp", group: "fish", kcal: 71, iron_mg: 0.21, calcium_mg: 54, magnesium_mg: 22, zinc_mg: 0.97, b12_ug: 1.11, src: "fdc:174210" },  // Crustaceans, shrimp, mixed species, raw (may contain additives to retain moisture)
  crab: { hint: "", group: "fish", kcal: 87, iron_mg: 0.74, calcium_mg: 89, magnesium_mg: 34, zinc_mg: 3.54, b12_ug: 9, src: "fdc:174204" },  // Crustaceans, crab, blue, raw
  squid: { hint: "", group: "fish", kcal: 92, iron_mg: 0.68, calcium_mg: 32, magnesium_mg: 33, zinc_mg: 1.53, b12_ug: 1.3, src: "fdc:174223" },  // Mollusks, squid, mixed species, raw
  // Vegetables and greens, raw
  potato: { hint: "aloo", group: "veg", kcal: 77, iron_mg: 0.81, calcium_mg: 12, magnesium_mg: 23, zinc_mg: 0.3, b12_ug: 0, src: "fdc:170026" },  // Potatoes, flesh and skin, raw
  sweet_potato: { hint: "shakarkand", group: "veg", kcal: 86, iron_mg: 0.61, calcium_mg: 30, magnesium_mg: 25, zinc_mg: 0.3, b12_ug: 0, src: "fdc:168482" },  // Sweet potato, raw, unprepared (Includes foods for USDA's Food Distribution Program)
  carrot: { hint: "", group: "veg", kcal: 41, iron_mg: 0.3, calcium_mg: 33, magnesium_mg: 12, zinc_mg: 0.24, b12_ug: 0, src: "fdc:170393" },  // Carrots, raw
  beetroot: { hint: "", group: "veg", kcal: 43, iron_mg: 0.8, calcium_mg: 16, magnesium_mg: 23, zinc_mg: 0.35, b12_ug: 0, src: "fdc:169145" },  // Beets, raw
  radish: { hint: "mooli", group: "veg", kcal: 18, iron_mg: 0.4, calcium_mg: 27, magnesium_mg: 16, zinc_mg: 0.15, b12_ug: 0, src: "fdc:168451" },  // Radishes, oriental, raw
  arbi: { hint: "colocasia", group: "veg", kcal: 112, iron_mg: 0.55, calcium_mg: 43, magnesium_mg: 33, zinc_mg: 0.23, b12_ug: 0, src: "fdc:169308" },  // Taro, raw
  tomato: { hint: "", group: "veg", kcal: 18, iron_mg: 0.27, calcium_mg: 10, magnesium_mg: 11, zinc_mg: 0.17, b12_ug: 0, src: "fdc:170457" },  // Tomatoes, red, ripe, raw, year round average
  onion: { hint: "", group: "veg", kcal: 40, iron_mg: 0.21, calcium_mg: 23, magnesium_mg: 10, zinc_mg: 0.17, b12_ug: 0, src: "fdc:170000" },  // Onions, raw
  garlic: { hint: "", group: "veg", kcal: 149, iron_mg: 1.7, calcium_mg: 181, magnesium_mg: 25, zinc_mg: 1.16, b12_ug: 0, src: "fdc:169230" },  // Garlic, raw
  ginger: { hint: "", group: "veg", kcal: 80, iron_mg: 0.6, calcium_mg: 16, magnesium_mg: 43, zinc_mg: 0.34, b12_ug: 0, src: "fdc:169231" },  // Ginger root, raw
  green_chilli: { hint: "", group: "veg", kcal: 40, iron_mg: 1.2, calcium_mg: 18, magnesium_mg: 25, zinc_mg: 0.3, b12_ug: 0, src: "fdc:170497" },  // Peppers, hot chili, green, raw
  coriander_leaves: { hint: "dhaniya", group: "veg", kcal: 23, iron_mg: 1.77, calcium_mg: 67, magnesium_mg: 26, zinc_mg: 0.5, b12_ug: 0, src: "fdc:169997" },  // Coriander (cilantro) leaves, raw
  cauliflower: { hint: "gobi", group: "veg", kcal: 25, iron_mg: 0.42, calcium_mg: 22, magnesium_mg: 15, zinc_mg: 0.27, b12_ug: 0, src: "fdc:169986" },  // Cauliflower, raw
  cabbage: { hint: "", group: "veg", kcal: 25, iron_mg: 0.47, calcium_mg: 40, magnesium_mg: 12, zinc_mg: 0.18, b12_ug: 0, src: "fdc:169975" },  // Cabbage, raw
  bhindi: { hint: "okra", group: "veg", kcal: 33, iron_mg: 0.62, calcium_mg: 82, magnesium_mg: 57, zinc_mg: 0.58, b12_ug: 0, src: "fdc:169260" },  // Okra, raw
  baingan: { hint: "brinjal", group: "veg", kcal: 25, iron_mg: 0.23, calcium_mg: 9, magnesium_mg: 14, zinc_mg: 0.16, b12_ug: 0, src: "fdc:169228" },  // Eggplant, raw
  green_peas: { hint: "matar", group: "veg", kcal: 81, iron_mg: 1.47, calcium_mg: 25, magnesium_mg: 33, zinc_mg: 1.24, b12_ug: 0, src: "fdc:170419" },  // Peas, green, raw
  beans: { hint: "french beans", group: "veg", kcal: 31, iron_mg: 1.03, calcium_mg: 37, magnesium_mg: 25, zinc_mg: 0.24, b12_ug: 0, src: "fdc:169961" },  // Beans, snap, green, raw
  lauki: { hint: "bottle gourd", group: "veg", kcal: 14, iron_mg: 0.2, calcium_mg: 26, magnesium_mg: 11, zinc_mg: 0.7, b12_ug: 0, src: "fdc:169232" },  // Gourd, white-flowered (calabash), raw
  karela: { hint: "bitter gourd", group: "veg", kcal: 17, iron_mg: 0.43, calcium_mg: 19, magnesium_mg: 17, zinc_mg: 0.8, b12_ug: 0, src: "fdc:168393" },  // Balsam-pear (bitter gourd), pods, raw
  turai: { hint: "ridge gourd", group: "veg", kcal: 20, iron_mg: 0.36, calcium_mg: 20, magnesium_mg: 14, zinc_mg: 0.07, b12_ug: 0, src: "fdc:168414" },  // Gourd, dishcloth (towelgourd), raw
  pumpkin: { hint: "kaddu", group: "veg", kcal: 26, iron_mg: 0.8, calcium_mg: 21, magnesium_mg: 12, zinc_mg: 0.32, b12_ug: 0, src: "fdc:168448" },  // Pumpkin, raw
  petha: { hint: "ash gourd", group: "veg", kcal: 13, iron_mg: 0.4, calcium_mg: 19, magnesium_mg: 10, zinc_mg: 0.61, b12_ug: 0, src: "fdc:170069" },  // Waxgourd, (chinese preserving melon), raw
  capsicum: { hint: "shimla mirch", group: "veg", kcal: 20, iron_mg: 0.34, calcium_mg: 10, magnesium_mg: 10, zinc_mg: 0.13, b12_ug: 0, src: "fdc:170427" },  // Peppers, sweet, green, raw
  cucumber: { hint: "kheera", group: "veg", kcal: 15, iron_mg: 0.28, calcium_mg: 16, magnesium_mg: 13, zinc_mg: 0.2, b12_ug: 0, src: "fdc:168409" },  // Cucumber, with peel, raw
  drumstick: { hint: "sahjan pods", group: "veg", kcal: 37, iron_mg: 0.36, calcium_mg: 30, magnesium_mg: 45, zinc_mg: 0.45, b12_ug: 0, src: "fdc:170483" },  // Drumstick pods, raw
  mushroom: { hint: "", group: "veg", kcal: 22, iron_mg: 0.5, calcium_mg: 3, magnesium_mg: 9, zinc_mg: 0.52, b12_ug: 0.04, src: "fdc:169251" },  // Mushrooms, white, raw
  sweet_corn: { hint: "", group: "veg", kcal: 86, iron_mg: 0.52, calcium_mg: 2, magnesium_mg: 37, zinc_mg: 0.46, b12_ug: 0, src: "fdc:169998" },  // Corn, sweet, yellow, raw
  spinach: { hint: "palak", group: "veg", kcal: 23, iron_mg: 2.71, calcium_mg: 99, magnesium_mg: 79, zinc_mg: 0.53, b12_ug: 0, src: "fdc:168462" },  // Spinach, raw
  sarson: { hint: "mustard greens", group: "veg", kcal: 27, iron_mg: 1.64, calcium_mg: 115, magnesium_mg: 32, zinc_mg: 0.25, b12_ug: 0, src: "fdc:169256" },  // Mustard greens, raw
  chaulai: { hint: "amaranth leaves", group: "veg", kcal: 23, iron_mg: 2.32, calcium_mg: 215, magnesium_mg: 55, zinc_mg: 0.9, b12_ug: 0, src: "fdc:168385" },  // Amaranth leaves, raw
  bathua: { hint: "", group: "veg", kcal: 43, iron_mg: 1.2, calcium_mg: 309, magnesium_mg: 34, zinc_mg: 0.44, b12_ug: 0, src: "fdc:169244" },  // Lambsquarters, raw
  moringa_leaves: { hint: "", group: "veg", kcal: 64, iron_mg: 4, calcium_mg: 185, magnesium_mg: 42, zinc_mg: 0.6, b12_ug: 0, src: "fdc:168416" },  // Drumstick leaves, raw
  // Fruit
  banana: { hint: "", group: "fruit", kcal: 89, iron_mg: 0.26, calcium_mg: 5, magnesium_mg: 27, zinc_mg: 0.15, b12_ug: 0, src: "fdc:173944" },  // Bananas, raw
  apple: { hint: "", group: "fruit", kcal: 52, iron_mg: 0.12, calcium_mg: 6, magnesium_mg: 5, zinc_mg: 0.04, b12_ug: 0, src: "fdc:171688" },  // Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)
  orange: { hint: "santra", group: "fruit", kcal: 47, iron_mg: 0.1, calcium_mg: 40, magnesium_mg: 10, zinc_mg: 0.07, b12_ug: 0, src: "fdc:169097" },  // Oranges, raw, all commercial varieties
  guava: { hint: "", group: "fruit", kcal: 68, iron_mg: 0.26, calcium_mg: 18, magnesium_mg: 22, zinc_mg: 0.23, b12_ug: 0, src: "fdc:173044" },  // Guavas, common, raw
  papaya: { hint: "", group: "fruit", kcal: 43, iron_mg: 0.25, calcium_mg: 20, magnesium_mg: 21, zinc_mg: 0.08, b12_ug: 0, src: "fdc:169926" },  // Papayas, raw
  mango: { hint: "ripe", group: "fruit", kcal: 60, iron_mg: 0.16, calcium_mg: 11, magnesium_mg: 10, zinc_mg: 0.09, b12_ug: 0, src: "fdc:169910" },  // Mangos, raw
  grapes: { hint: "", group: "fruit", kcal: 69, iron_mg: 0.36, calcium_mg: 10, magnesium_mg: 7, zinc_mg: 0.07, b12_ug: 0, src: "fdc:174683" },  // Grapes, red or green (European type, such as Thompson seedless), raw
  pomegranate: { hint: "anar", group: "fruit", kcal: 83, iron_mg: 0.3, calcium_mg: 10, magnesium_mg: 12, zinc_mg: 0.35, b12_ug: 0, src: "fdc:169134" },  // Pomegranates, raw
  watermelon: { hint: "", group: "fruit", kcal: 30, iron_mg: 0.24, calcium_mg: 7, magnesium_mg: 10, zinc_mg: 0.1, b12_ug: 0, src: "fdc:167765" },  // Watermelon, raw
  muskmelon: { hint: "kharbooja", group: "fruit", kcal: 34, iron_mg: 0.21, calcium_mg: 9, magnesium_mg: 12, zinc_mg: 0.18, b12_ug: 0, src: "fdc:169092" },  // Melons, cantaloupe, raw
  pineapple: { hint: "", group: "fruit", kcal: 50, iron_mg: 0.29, calcium_mg: 13, magnesium_mg: 12, zinc_mg: 0.12, b12_ug: 0, src: "fdc:169124" },  // Pineapple, raw, all varieties
  chikoo: { hint: "sapota", group: "fruit", kcal: 83, iron_mg: 0.8, calcium_mg: 21, magnesium_mg: 12, zinc_mg: 0.1, b12_ug: 0, src: "fdc:167759" },  // Sapodilla, raw
  sitaphal: { hint: "custard apple", group: "fruit", kcal: 94, iron_mg: 0.6, calcium_mg: 24, magnesium_mg: 21, zinc_mg: 0.1, b12_ug: 0, src: "fdc:168175" },  // Sugar-apples, (sweetsop), raw
  litchi: { hint: "", group: "fruit", kcal: 66, iron_mg: 0.31, calcium_mg: 5, magnesium_mg: 10, zinc_mg: 0.07, b12_ug: 0, src: "fdc:169086" },  // Litchis, raw
  dates: { hint: "khajur", group: "fruit", kcal: 282, iron_mg: 1.02, calcium_mg: 39, magnesium_mg: 43, zinc_mg: 0.29, b12_ug: 0, src: "fdc:171726" },  // Dates, deglet noor
  raisins: { hint: "kishmish", group: "fruit", kcal: 299, iron_mg: 1.79, calcium_mg: 62, magnesium_mg: 36, zinc_mg: 0.36, b12_ug: 0, src: "fdc:168165" },  // Raisins, dark, seedless (Includes foods for USDA's Food Distribution Program)
  figs_dried: { hint: "anjeer", group: "fruit", kcal: 249, iron_mg: 2.03, calcium_mg: 162, magnesium_mg: 68, zinc_mg: 0.55, b12_ug: 0, src: "fdc:174665" },  // Figs, dried, uncooked
  lemon_juice: { hint: "nimbu", group: "fruit", kcal: 22, iron_mg: 0.08, calcium_mg: 6, magnesium_mg: 6, zinc_mg: 0.05, b12_ug: 0, src: "fdc:167747" },  // Lemon juice, raw
  tamarind: { hint: "imli", group: "fruit", kcal: 239, iron_mg: 2.8, calcium_mg: 74, magnesium_mg: 92, zinc_mg: 0.1, b12_ug: 0, src: "fdc:167763" },  // Tamarinds, raw
  // Nuts and seeds
  almonds: { hint: "badam", group: "nut", kcal: 579, iron_mg: 3.71, calcium_mg: 269, magnesium_mg: 270, zinc_mg: 3.12, b12_ug: 0, src: "fdc:170567" },  // Nuts, almonds
  cashews: { hint: "kaju", group: "nut", kcal: 553, iron_mg: 6.68, calcium_mg: 37, magnesium_mg: 292, zinc_mg: 5.78, b12_ug: 0, src: "fdc:170162" },  // Nuts, cashew nuts, raw
  peanuts: { hint: "moongphali", group: "nut", kcal: 567, iron_mg: 4.58, calcium_mg: 92, magnesium_mg: 168, zinc_mg: 3.27, b12_ug: 0, src: "fdc:172430" },  // Peanuts, all types, raw
  peanut_butter: { hint: "", group: "nut", kcal: 598, iron_mg: 1.74, calcium_mg: 49, magnesium_mg: 168, zinc_mg: 2.51, b12_ug: 0, src: "fdc:172470" },  // Peanut butter, smooth style, without salt
  walnuts: { hint: "akhrot", group: "nut", kcal: 654, iron_mg: 2.91, calcium_mg: 98, magnesium_mg: 158, zinc_mg: 3.09, b12_ug: 0, src: "fdc:170187" },  // Nuts, walnuts, english
  pistachios: { hint: "", group: "nut", kcal: 560, iron_mg: 3.92, calcium_mg: 105, magnesium_mg: 121, zinc_mg: 2.2, b12_ug: 0, src: "fdc:170184" },  // Nuts, pistachio nuts, raw
  coconut: { hint: "fresh: chutney, grated", group: "nut", kcal: 354, iron_mg: 2.43, calcium_mg: 14, magnesium_mg: 32, zinc_mg: 1.1, b12_ug: 0, src: "fdc:170169" },  // Nuts, coconut meat, raw
  coconut_dry: { hint: "copra, desiccated", group: "nut", kcal: 660, iron_mg: 3.32, calcium_mg: 26, magnesium_mg: 90, zinc_mg: 2.01, b12_ug: 0, src: "fdc:170170" },  // Nuts, coconut meat, dried (desiccated), not sweetened
  coconut_milk: { hint: "", group: "nut", kcal: 230, iron_mg: 1.64, calcium_mg: 16, magnesium_mg: 37, zinc_mg: 0.67, b12_ug: 0, src: "fdc:170172" },  // Nuts, coconut milk, raw (liquid expressed from grated meat and water)
  sesame: { hint: "til", group: "nut", kcal: 573, iron_mg: 14.55, calcium_mg: 975, magnesium_mg: 351, zinc_mg: 7.75, b12_ug: 0, src: "fdc:170150" },  // Seeds, sesame seeds, whole, dried
  flaxseed: { hint: "alsi", group: "nut", kcal: 534, iron_mg: 5.73, calcium_mg: 255, magnesium_mg: 392, zinc_mg: 4.34, b12_ug: 0, src: "fdc:169414" },  // Seeds, flaxseed
  sunflower_seeds: { hint: "", group: "nut", kcal: 584, iron_mg: 5.25, calcium_mg: 78, magnesium_mg: 325, zinc_mg: 5, b12_ug: 0, src: "fdc:170562" },  // Seeds, sunflower seed kernels, dried
  chia: { hint: "", group: "nut", kcal: 486, iron_mg: 7.72, calcium_mg: 631, magnesium_mg: 335, zinc_mg: 4.58, b12_ug: 0, src: "fdc:170554" },  // Seeds, chia seeds, dried
  pumpkin_seeds: { hint: "", group: "nut", kcal: 559, iron_mg: 8.82, calcium_mg: 46, magnesium_mg: 592, zinc_mg: 7.81, b12_ug: 0, src: "fdc:170556" },  // Seeds, pumpkin and squash seed kernels, dried
  // Fats
  oil: { hint: "any cooking oil", group: "fat", kcal: 884, iron_mg: 0.03, calcium_mg: 0, magnesium_mg: 0, zinc_mg: 0.01, b12_ug: 0, src: "fdc:171410" },  // Oil, peanut, salad or cooking
  // Sugar and honey
  sugar: { hint: "", group: "sugar", kcal: 387, iron_mg: 0.05, calcium_mg: 1, magnesium_mg: 0, zinc_mg: 0.01, b12_ug: 0, src: "fdc:169655" },  // Sugars, granulated
  honey: { hint: "", group: "sugar", kcal: 304, iron_mg: 0.42, calcium_mg: 6, magnesium_mg: 2, zinc_mg: 0.22, b12_ug: 0, src: "fdc:169640" },  // Honey
  // Drinks
  tea: { hint: "brewed; milk and sugar are their own", group: "drink", kcal: 1, iron_mg: 0.02, calcium_mg: 0, magnesium_mg: 3, zinc_mg: 0.02, b12_ug: 0, src: "fdc:173227" },  // Beverages, tea, black, brewed, prepared with tap water
  coffee: { hint: "brewed; milk and sugar are their own", group: "drink", kcal: 1, iron_mg: 0.01, calcium_mg: 2, magnesium_mg: 3, zinc_mg: 0.02, b12_ug: 0, src: "fdc:171890" },  // Beverages, coffee, brewed, prepared with tap water
  coconut_water: { hint: "", group: "drink", kcal: 19, iron_mg: 0.29, calcium_mg: 24, magnesium_mg: 25, zinc_mg: 0.1, b12_ug: 0, src: "fdc:170174" },  // Nuts, coconut water (liquid from coconuts)
  soymilk: { hint: "unsweetened, not fortified", group: "drink", kcal: 54, iron_mg: 0.64, calcium_mg: 25, magnesium_mg: 25, zinc_mg: 0.12, b12_ug: 0, src: "fdc:172446" },  // Soymilk, original and vanilla, unfortified
} satisfies Record<string, FoodRow>;

export type FoodCode = keyof typeof FOODS;
export const FOOD_CODES = Object.keys(FOODS) as [FoodCode, ...FoodCode[]];

export const foodRow = (code: string): FoodRow | null => (Object.hasOwn(FOODS, code) ? FOODS[code as FoodCode] : null);

/** The source of one value: "fdc:<id>" or "plant". */
export const sourceOf = (code: FoodCode, nutrient: TableNutrient): string => {
  const row: FoodRow = FOODS[code];
  return row.srcBy?.[nutrient] ?? row.src;
};

/**
 * Raw weight per household serving, for the meal prompt.
 * [ASC] Khanna K, Gupta S, Seth R et al. The Art & Science of Cooking. 5th ed. New Delhi: Elite Publishing, 2007.
 * [BFP] Raina U, Kashyap S, Narula V et al. Basic Food Preparation: A Complete Manual. 4th ed. New Delhi: Orient BlackSwan, 2011.
 * Both read from the recipe files of the Indian Nutrient Databank (INDB, github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-),
 * by recipe code. [USDA] FoodData Central SR Legacy portions and energy.
 */
export const PORTIONS: readonly { serving: string; raw: string; source: string }[] = [
  { serving: "1 roti, chapati or phulka", raw: "20 g atta", source: "ASC096: 80 g atta makes 4" },
  { serving: "1 plain paratha", raw: "27 g atta + 9 g oil or ghee", source: "ASC097: 80 g atta and 2 tbsp oil make 3" },
  { serving: "1 puri", raw: "16 g atta, plus the oil it soaks up", source: "ASC107: 80 g atta makes 5" },
  { serving: "1 naan", raw: "33 g maida", source: "ASC142: 100 g maida makes 3" },
  { serving: "1 makki roti", raw: "30 g makki", source: "ASC150: 60 g maize makes 2" },
  { serving: "1 plate boiled rice", raw: "100 g raw rice", source: "ASC113" },
  { serving: "1 cup cooked rice (158 g)", raw: "56 g raw rice", source: "USDA: 1 cup cooked = 158 g at 130 kcal/100 g (fdc 169757); raw 365 kcal/100 g (fdc 169756)" },
  { serving: "1 plate pulao, lemon rice or curd rice", raw: "80 g raw rice", source: "ASC118" },
  { serving: "1 bowl dal, rajma or chole", raw: "30 g dry dal or beans", source: "ASC151, ASC152, ASC153, ASC155, ASC165, BFP172: 30 g a bowl" },
  { serving: "1 bowl sambar", raw: "25 g toor dal", source: "ASC167: 50 g makes 2 bowls" },
  { serving: "1 small bowl khichdi", raw: "60 g rice + 20 g moong dal", source: "BFP144" },
  { serving: "1 idli", raw: "7.5 g rice + 2.5 g urad", source: "ASC144: 60 g rice and 20 g urad make 8" },
  { serving: "1 plain dosa", raw: "25 g rice + 7.5 g urad", source: "BFP148: 100 g rice and 30 g urad make 4" },
  { serving: "1 masala dosa", raw: "30 g rice + 10 g urad + 50 g potato", source: "ASC146: makes 2" },
  { serving: "1 bowl poha", raw: "20 g poha", source: "BFP044: 40 g makes 2 bowls" },
  { serving: "1 bowl upma", raw: "20 g suji", source: "BFP039: 40 g makes 2 bowls" },
  { serving: "1 egg", raw: "50 g", source: "ASC059; USDA large egg 50 g (fdc 171287)" },
  { serving: "1 bowl chicken curry", raw: "125 g chicken", source: "ASC240: 250 g makes 2 bowls" },
  { serving: "1 bowl fish curry", raw: "100 g fish", source: "ASC246" },
  { serving: "1 bowl paneer curry", raw: "75 g paneer", source: "ASC195" },
  { serving: "1 cup chai", raw: "25 mL milk + 4 g sugar", source: "ASC001: 50 mL milk and 2 tsp sugar make 2 cups; USDA 1 tsp sugar = 4.2 g (fdc 169655)" },
  { serving: "Milk or curd", raw: "about 1.03 g per mL; 1 katori (150 mL) of curd is 155 g", source: "USDA: 1 cup (240 mL) milk = 244 g (fdc 172217), yogurt = 245 g (fdc 171284)" },
  { serving: "Oil", raw: "1 tsp = 4.5 g, 1 tbsp = 13.5 g", source: "USDA (fdc 171410)" },
  { serving: "Ghee or butter", raw: "1 tsp = 4.5 g, 1 tbsp = 13 g", source: "USDA: 1 tbsp ghee 12.8 g (fdc 173412), butter 14.2 g (fdc 173410)" },
];

/**
 * Cooked rice to raw rice (Mayank, 2026-11-22: grams of rice mean the cooked weight on the plate,
 * unless the person says the rice is raw). Raw grams = cooked grams × cooked kcal ÷ raw kcal, the same
 * energy ratio as the "1 cup cooked rice" portion above. USDA SR Legacy: white long-grain rice cooked
 * without salt, 130 kcal per 100 g (fdc 169757; raw 365, fdc 169756); brown long-grain rice cooked,
 * 123 kcal (fdc 169704; raw 367, fdc 169703). Their dry matter gives the same factors within 1%.
 */
export const COOKED_RICE = {
  rice_white: { kcal: 130, src: "fdc:169757" },
  rice_brown: { kcal: 123, src: "fdc:169704" },
} as const;
export type RiceCode = keyof typeof COOKED_RICE;

/** The raw rice in cooked grams of rice, and its energy (the same as the cooked rice's). */
export function rawRice(cookedG: number, code: RiceCode): { g: number; kcal: number } {
  const kcal = (cookedG * COOKED_RICE[code].kcal) / 100;
  return { g: Math.round((kcal / FOODS[code].kcal) * 100), kcal: Math.round(kcal) };
}

const GROUP_NAMES: Record<FoodGroup, string> = {
  grain: "Grains and flours, raw or dry", pulse: "Pulses and soy, dry", dairy: "Milk and dairy", fat: "Fats", egg: "Eggs",
  meat: "Meat", fish: "Fish and seafood", veg: "Vegetables and greens", fruit: "Fruit", nut: "Nuts and seeds", sugar: "Sugar", drink: "Drinks",
};

/** The food list for the prompt, one group a line: "code" or "code (hint)". */
export function foodListText(): string {
  const groups = new Map<FoodGroup, string[]>();
  for (const code of FOOD_CODES) {
    const row: FoodRow = FOODS[code];
    groups.set(row.group, [...(groups.get(row.group) ?? []), row.hint ? `${code} (${row.hint})` : code]);
  }
  return [...groups.entries()].map(([group, codes]) => `- ${GROUP_NAMES[group]}: ${codes.join(", ")}`).join("\n");
}

export const portionsText = (): string => PORTIONS.map((p) => `- ${p.serving}: ${p.raw}`).join("\n");
