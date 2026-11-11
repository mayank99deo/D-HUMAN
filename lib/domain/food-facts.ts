// Food and body facts for the Fuel loading screen, picked for each person by
// age, height and weight in 5-unit bands (21–25 years, 166–170 cm, 61–65 kg),
// their diet and sex, plus facts for everyone. Static, so showing them costs
// nothing. Height and weight bands get facts with their own numbers, worked
// out from standard formulas; everything else is hand-written and hedged.

export type FoodFact = { kicker: string; text: string; scope: string };

type Range = [number, number];
type Tagged = {
  kicker: string;
  text: string;
  age?: Range;
  sex?: "male" | "female";
  diets?: string[];
};

const VEG = ["veg", "eggetarian", "vegan", "jain"];

// ── For everyone ───────────────────────────────────────────────────────────
const UNIVERSAL: Tagged[] = [
  { kicker: "Diet and disease", text: "India's dietary guidelines (ICMR-NIN, 2024) estimate that about 56% of the country's disease burden is linked to unhealthy diets." },
  { kicker: "Half the plate", text: "ICMR-NIN's model plate fills about half with vegetables and fruit; grains, pulses, nuts and dairy share the rest." },
  { kicker: "Salt", text: "The WHO suggests under 5 g of salt a day, about a teaspoon. Indian adults average around 8 g, much of it from pickles, namkeen and restaurant food." },
  { kicker: "Achaar", text: "One tablespoon of pickle can carry 1–2 g of salt, a third of a day's limit." },
  { kicker: "Hidden oil", text: "A tablespoon of oil or ghee is about 120 kcal. A two-spoon tadka adds as much energy as two or three rotis." },
  { kicker: "Roti maths", text: "A medium phulka from about 30 g of atta is roughly 100 kcal. A teaspoon of ghee on top adds about 45 more." },
  { kicker: "Dal-chawal", text: "Cereals run short of lysine and pulses short of methionine. Together, as dal-chawal or rajma-chawal, they make a more complete protein." },
  { kicker: "Sprouting", text: "Soaking and sprouting pulses cuts phytates, which helps your body absorb more of their iron and zinc." },
  { kicker: "Iron kadhai", text: "Cooking in an iron kadhai or tawa can add iron to food, especially sour dishes made with tomato or tamarind." },
  { kicker: "Lemon last", text: "Vitamin C breaks down with heat. Squeeze lemon on dal or sabzi after cooking, not while it simmers." },
  { kicker: "Chai timing", text: "Tannins in tea and coffee reduce the iron you absorb from a meal. Have chai an hour before or after eating." },
  { kicker: "Ragi", text: "Gram for gram, ragi has roughly three times the calcium of milk." },
  { kicker: "Amla", text: "Gram for gram, amla carries several times the vitamin C of an orange." },
  { kicker: "Whole fruit", text: "Juice loses most of the fruit's fibre, so a glass fills you up far less than the fruit it took to make." },
  { kicker: "Free sugar", text: "The WHO advises keeping free sugars under 10% of daily energy, ideally under 5%: about 25 g, or six teaspoons, for most adults." },
  { kicker: "Sweet chai", text: "Two teaspoons of sugar a cup adds up: three cups a day is around 25–30 g of sugar, already at the WHO's ideal limit." },
  { kicker: "Cola", text: "A 300 mL bottle of cola has around 30 g of sugar, more than the WHO's ideal limit for a whole day." },
  { kicker: "Fibre", text: "Adults need about 25–30 g of fibre a day. A katori of rajma or chana gives roughly 6–9 g of it." },
  { kicker: "Protein spread", text: "Studies suggest muscles use protein better when it's spread across meals than when most of it comes at dinner." },
  { kicker: "Eat slowly", text: "Fullness signals take time to reach your brain. Eating slowly gives them a chance to arrive before second helpings do." },
  { kicker: "Sleep and hunger", text: "In sleep studies, short nights raised the hunger hormone ghrelin and lowered leptin, which signals fullness." },
  { kicker: "Dahi", text: "Homemade dahi carries live lactic acid bacteria, and fermentation makes its lactose easier for many people to digest." },
  { kicker: "Millets", text: "Jowar, bajra and ragi carry more fibre than polished rice, so they digest more slowly." },
  { kicker: "Reused oil", text: "Reheating frying oil again and again creates harmful compounds. ICMR-NIN's guidelines advise against reusing it." },
  { kicker: "Water in food", text: "About a fifth of the water you take in comes from food: dal, sabzi, curd and fruit all count." },
  { kicker: "Protein breakfast", text: "A protein-rich breakfast, like eggs, besan chilla or paneer, tends to keep you fuller through the morning than one of only carbs." },
  { kicker: "Nuts", text: "In large studies, a small handful of nuts most days, about 30 g, is linked with lower heart-disease risk." },
  { kicker: "Vitamin D", text: "Few foods carry much vitamin D. Sunlight is the main source; fortified milk, egg yolks and fatty fish add a little." },
  { kicker: "Calcium and iron", text: "Calcium competes with iron for absorption. If you take an iron tablet, keep it apart from milk and curd." },
  { kicker: "Cut fruit", text: "Cut fruit loses vitamin C to air and light as it sits. Eat it soon after cutting." },
  { kicker: "Smaller thali", text: "In several studies, people served on bigger plates ate more. A smaller thali can quietly mean a smaller portion." },
  { kicker: "Alcohol", text: "Alcohol has 7 kcal per gram, nearly as much as fat. A 60 mL peg of whisky is about 130 kcal before any mixer.", age: [21, 120] },
  { kicker: "Height and burn", text: "In the standard formula for resting energy, each centimetre of height adds about 6 kcal a day." },
  { kicker: "Muscle burns more", text: "Muscle uses more energy at rest than fat does, which is one reason strength training helps keep weight steady." },
];

// ── By age ─────────────────────────────────────────────────────────────────
const BY_AGE: Tagged[] = [
  { kicker: "Building bone", text: "Up to 90% of adult bone mass is built by about age 18–20. Calcium, protein, sunlight and exercise now pay off for life.", age: [13, 22] },
  { kicker: "Teen calcium", text: "Teenagers need more calcium than adults: ICMR-NIN's allowance rises to about 1,050 mg a day at 16–18.", age: [13, 18] },
  { kicker: "Teen iron", text: "Teenage girls need more iron than adult men, because they are growing and lose blood each month.", age: [13, 20], sex: "female" },
  { kicker: "Skipped breakfast", text: "Teens who skip breakfast tend to take in less calcium and fibre over the day.", age: [13, 20] },
  { kicker: "Peak bone", text: "Bone keeps building until around 30. What you eat in your twenties sets the reserve you draw on later.", age: [19, 30] },
  { kicker: "Steady metabolism", text: "A 2021 study of over 6,000 people found that, adjusted for body size, daily energy use stays steady from about 20 to 60.", age: [20, 60] },
  { kicker: "Habits", text: "Eating habits formed in your twenties tend to stick, which makes this a good decade to build a protein-at-every-meal routine.", age: [20, 29] },
  { kicker: "Before pregnancy", text: "Folate before and in early pregnancy lowers the risk of neural tube defects. Dals, leafy greens and fortified foods help.", age: [20, 40], sex: "female" },
  { kicker: "Muscle after 30", text: "From around 30, muscle slowly declines with age, by roughly 3–8% a decade without training against it.", age: [28, 45] },
  { kicker: "Thin-fat", text: "Many Indians gain fat around the waist first, even at a normal BMI. This 'thin-fat' pattern is linked to diabetes risk.", age: [25, 55] },
  { kicker: "Diabetes in India", text: "ICMR-INDIAB (2023) found about 11% of Indian adults have diabetes and another 15% prediabetes.", age: [30, 120] },
  { kicker: "Women's iron", text: "ICMR-NIN sets women's iron need at about 29 mg a day, over 50% more than men's 19 mg.", age: [18, 50], sex: "female" },
  { kicker: "Waist first", text: "In your thirties and forties, watching your waist can say more about metabolic risk than the scale.", age: [31, 50] },
  { kicker: "Perimenopause", text: "Perimenopause can shift fat towards the belly even without weight gain. Fibre and protein at each meal help steady blood sugar.", age: [40, 52], sex: "female" },
  { kicker: "Salt with age", text: "Blood pressure tends to rise with age, and cutting salt usually brings it down within weeks.", age: [40, 120] },
  { kicker: "After menopause", text: "Women can lose up to 20% of their bone density in the five to seven years after menopause. Calcium, vitamin D, protein and weight-bearing exercise slow it.", age: [45, 60], sex: "female" },
  { kicker: "Muscle and blood sugar", text: "Muscle soaks up blood sugar after meals, so keeping it in your forties and fifties helps keep sugar in check.", age: [40, 60] },
  { kicker: "B12 with age", text: "Stomach acid often falls with age, and with it B12 absorption: 10–30% of older adults absorb B12 from food poorly.", age: [50, 120] },
  { kicker: "More protein", text: "Expert groups suggest older adults aim for 1.0–1.2 g of protein per kg a day to protect muscle, more than younger adults.", age: [55, 120] },
  { kicker: "Thirst fades", text: "The sense of thirst weakens with age. Drinking on a schedule, not only when thirsty, helps prevent dehydration.", age: [60, 120] },
  { kicker: "Skin and sun", text: "Older skin makes much less vitamin D from the same sunlight than younger skin does.", age: [60, 120] },
  { kicker: "Taste and salt", text: "Taste and smell dull with age, which can lead to more salt. Lemon, herbs and spices add flavour without it.", age: [60, 120] },
  { kicker: "Fibre and age", text: "Constipation becomes more common with age; fibre with enough water is the first fix.", age: [60, 120] },
  { kicker: "Smaller appetite", text: "Appetite often shrinks with age. Curd, eggs, paneer and dal make protein easy to fit into smaller meals.", age: [65, 120] },
];

// ── By diet ────────────────────────────────────────────────────────────────
const BY_DIET: Tagged[] = [
  { kicker: "B12", text: "B12 is made by bacteria, not plants. Without dairy, eggs or meat, a fortified food or a supplement is usually needed.", diets: ["vegan"] },
  { kicker: "B12", text: "Vegetarians get B12 mainly from milk, curd and paneer, and many still run low. It's worth testing.", diets: ["veg", "jain"] },
  { kicker: "Plant iron", text: "Iron from plants is absorbed less than iron from meat, so pairing it with vitamin C matters more for vegetarians.", diets: VEG },
  { kicker: "Paneer", text: "Paneer is protein-dense: about 18 g per 100 g, with calcium as a bonus.", diets: ["veg", "eggetarian", "jain"] },
  { kicker: "Soy chunks", text: "Soy chunks are among the richest plant proteins: about 50 g per 100 g, dry.", diets: ["vegan", "veg", "eggetarian"] },
  { kicker: "Eggs", text: "One egg has about 6 g of high-quality protein, plus some B12 and vitamin D in the yolk.", diets: ["eggetarian", "nonveg"] },
  { kicker: "Chicken", text: "Cooked chicken breast has about 31 g of protein per 100 g.", diets: ["nonveg"] },
  { kicker: "Fatty fish", text: "Bangda (mackerel) and mathi (sardines) are among the few foods rich in both vitamin D and omega-3.", diets: ["nonveg"] },
  { kicker: "Jain protein", text: "Without root vegetables, dals, curd, paneer and nuts are easy protein wins on a Jain plate.", diets: ["jain"] },
  { kicker: "Calcium without milk", text: "Without dairy, ragi, til, rajma and fortified soy milk help close the calcium gap.", diets: ["vegan"] },
];

// ── Bands ──────────────────────────────────────────────────────────────────
export type Band = { lo: number; hi: number; label: string };

// 5-unit bands ending on a multiple of 5: 166–170, 61–65, 21–25.
export function bandOf(value: number, unit: string): Band {
  const hi = Math.ceil(Math.round(value) / 5) * 5;
  const lo = hi - 4;
  return { lo, hi, label: `${lo}–${hi}${unit}` };
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => +n.toFixed(1);

// The healthy BMI range used for Indian and other Asian adults is 18.5–22.9.
export function heightFacts(b: Band): FoodFact[] {
  const scope = `For ${b.label}`;
  const mLo = b.lo / 100;
  const mHi = b.hi / 100;
  return [
    {
      kicker: "Healthy weight",
      text: `At ${b.label}, the healthy weight range used for Indian adults (BMI 18.5–22.9) is about ${r0(18.5 * mLo * mLo)}–${r0(22.9 * mHi * mHi)} kg.`,
      scope,
    },
    {
      kicker: "Half your height",
      text: `A waist under half your height is a simple heart-health target: at ${b.label}, that's under about ${r0(b.lo / 2)}–${r0(b.hi / 2)} cm.`,
      scope,
    },
  ];
}

const FOODS = [
  { name: "a samosa", kcal: 260 },
  { name: "a plate of poha with peanuts", kcal: 300 },
  { name: "a masala dosa", kcal: 390 },
  { name: "a plate of veg biryani", kcal: 500 },
];

export function weightFacts(b: Band): FoodFact[] {
  const scope = `For ${b.label}`;
  const runLo = 5 * b.lo; // running costs roughly 1 kcal per kg per km
  const runHi = 5 * b.hi;
  const mid = (runLo + runHi) / 2;
  const like = FOODS.reduce((best, f) => (Math.abs(f.kcal - mid) < Math.abs(best.kcal - mid) ? f : best));
  // Brisk walking costs roughly 0.75 kcal per kg per km.
  const walkLo = 260 / (0.75 * b.hi);
  const walkHi = 260 / (0.75 * b.lo);
  return [
    {
      kicker: "Your protein",
      text: `At ${b.label}, ICMR-NIN's minimum is about ${r0(0.83 * b.lo)}–${r0(0.83 * b.hi)} g of protein a day. If you train, 1.2–1.6 g per kg puts it at about ${r0(1.2 * b.lo)}–${r0(1.6 * b.hi)} g.`,
      scope,
    },
    {
      kicker: "5 km in food",
      text: `At ${b.label}, a 5 km run burns roughly ${r0(runLo)}–${r0(runHi)} kcal, about the same as ${like.name}.`,
      scope,
    },
    {
      kicker: "Walking off a samosa",
      text: `At ${b.label}, walking off one samosa (about 260 kcal) takes roughly ${r1(walkLo)}–${r1(walkHi)} km at a brisk pace.`,
      scope,
    },
    {
      kicker: "Your water",
      text: `A common rule of thumb is 30–35 mL of fluid per kg a day: about ${r1((30 * b.lo) / 1000)}–${r1((35 * b.hi) / 1000)} litres at ${b.label}, more in heat or training.`,
      scope,
    },
  ];
}

// ── Picking facts for one person ───────────────────────────────────────────
export type FactInput = {
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  sex?: string | null;
  diet?: string | null;
};

const DIET_WORD: Record<string, string> = {
  veg: "vegetarians",
  eggetarian: "eggetarians",
  vegan: "vegans",
  jain: "Jain diets",
  nonveg: "non-vegetarians",
};

const fits = (f: Tagged, p: FactInput) =>
  (!f.age || (p.age != null && p.age >= f.age[0] && p.age <= f.age[1])) &&
  (!f.sex || f.sex === p.sex) &&
  (!f.diets || (!!p.diet && f.diets.includes(p.diet)));

export function foodFactsFor(p: FactInput): { facts: FoodFact[]; categories: string[] } {
  const categories: string[] = [];
  const personal: FoodFact[] = [];

  if (p.age) {
    const b = bandOf(p.age, " years");
    categories.push(b.label);
    for (const f of BY_AGE) if (fits(f, p)) personal.push({ kicker: f.kicker, text: f.text, scope: f.sex === "female" ? "For women" : `For ${b.label}` });
  }
  if (p.heightCm) {
    const b = bandOf(p.heightCm, " cm");
    categories.push(b.label);
    personal.push(...heightFacts(b));
  }
  if (p.weightKg) {
    const b = bandOf(p.weightKg, " kg");
    categories.push(b.label);
    personal.push(...weightFacts(b));
  }
  if (p.diet && DIET_WORD[p.diet]) {
    categories.push(DIET_WORD[p.diet][0].toUpperCase() + DIET_WORD[p.diet].slice(1));
    for (const f of BY_DIET) if (fits(f, p)) personal.push({ kicker: f.kicker, text: f.text, scope: `For ${DIET_WORD[p.diet]}` });
  }

  const everyone = UNIVERSAL.filter((f) => fits(f, p)).map((f) => ({ kicker: f.kicker, text: f.text, scope: "For everyone" }));

  // Personal and universal take turns, personal first, so the screen feels made for you.
  const facts: FoodFact[] = [];
  const n = Math.max(personal.length, everyone.length);
  for (let i = 0; i < n; i++) {
    if (personal[i]) facts.push(personal[i]);
    if (everyone[i]) facts.push(everyone[i]);
  }
  return { facts, categories };
}

export const LIBRARY_SIZE = { universal: UNIVERSAL.length, age: BY_AGE.length, diet: BY_DIET.length };
