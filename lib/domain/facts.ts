import type { Archetype } from "./persona";

// Shown while a report is being read. Hand-written and hedged on purpose: these
// are facts, not advice, and none of them is about the person's own results.

export type Fact = { kicker: string; text: string };

const GENERAL: Fact[] = [
  { kicker: "Ferritin", text: "Ferritin is your iron savings account. It can run low long before haemoglobin drops, so a normal Hb doesn't rule out low iron." },
  { kicker: "HbA1c", text: "HbA1c tracks your average blood sugar over roughly 2–3 months, because it rides on red blood cells that live about 120 days." },
  { kicker: "Ranges", text: "A reference range is where most people in a lab's population fall. 'In range' isn't always 'ideal for you'." },
  { kicker: "B12", text: "B12 comes almost only from animal foods. Vegetarians, and people on long-term metformin or acid-reducing tablets, more often run low." },
  { kicker: "Trends", text: "One result is a snapshot. The same marker, same lab, same time of day, retested, shows you the trend." },
  { kicker: "TSH", text: "TSH runs backwards: a high TSH usually means the thyroid is underactive, because the brain is signalling harder to get it going." },
  { kicker: "Iron & chai", text: "Tea and coffee with meals can cut the iron you absorb from plant foods. Vitamin C in the same meal, like lemon on dal, helps." },
  { kicker: "Fasting", text: "A fasting test means 8–12 hours with only water. Even a sweet chai beforehand can skew fasting glucose." },
  { kicker: "Rest day", text: "Hard training the day before a test can raise CK, AST and even creatinine. Bloods read cleanest after a rest day." },
  { kicker: "Sunshine", text: "Vitamin D is made in your skin from UVB light. Indoor days, covered skin and darker skin all cut how much you make, even in Indian sun." },
  { kicker: "More isn't better", text: "Vitamin D, vitamin A and iron can build up in the body and cause harm at high doses. That's why D-Human reads before it recommends." },
  { kicker: "Earned", text: "A supplement earns its place by fixing a measured gap. Without a test, it's a guess." },
];

const BY_ARCHETYPE: Record<Archetype, Fact[]> = {
  running: [
    { kicker: "Foot strike", text: "Every foot strike breaks a few red blood cells. It's one reason runners lose a little more iron than most." },
    { kicker: "Hepcidin", text: "For a few hours after a hard run, a hormone called hepcidin rises and your gut absorbs less iron." },
    { kicker: "Runner's ferritin", text: "Many sports doctors look for ferritin above roughly 30–50 ng/mL in runners, higher than some lab cut-offs." },
    { kicker: "Heavy legs", text: "Low iron stores, even without anaemia, can show up as heavy legs and slower recovery." },
    { kicker: "Sports anaemia", text: "Endurance training expands plasma volume first, so haemoglobin can read a little low. Often that's harmless dilution." },
    { kicker: "HDL", text: "Endurance training tends to raise HDL, the cholesterol that helps clear the rest." },
    { kicker: "Salt", text: "Runs over about 90 minutes in heat can drain sodium as well as water. Sweat can carry a lot of salt." },
    { kicker: "Bones", text: "Low vitamin D is linked with more stress fractures in some studies of runners and military recruits." },
  ],
  hyrox: [
    { kicker: "The race", text: "HYROX is 8 × 1 km runs, each followed by a station: ski erg, sled push, sled pull, burpee broad jumps, row, farmers carry, sandbag lunges, wall balls." },
    { kicker: "Two engines", text: "Hybrid racing taxes both your aerobic engine, which is iron-hungry, and your muscles, so both kinds of marker matter." },
    { kicker: "CK", text: "CK leaks from muscle after heavy or unfamiliar work, sleds and lunges especially. High two days after training is often expected." },
    { kicker: "hs-CRP", text: "hs-CRP rises with any inflammation, hard training included. Two easy days before a test gives a cleaner read." },
    { kicker: "Protein", text: "Sports nutrition groups suggest about 1.4–2.0 g of protein per kg of body weight a day for people who train hard." },
    { kicker: "Creatine", text: "Creatine is one of the most studied sports supplements. It can nudge blood creatinine up without harming kidneys, so mention it to whoever reads your report." },
    { kicker: "Ferritin", text: "The 8 km of running inside a HYROX is still running: the same iron losses apply." },
  ],
  strength: [
    { kicker: "Creatinine", text: "More muscle makes more creatinine. Lifters can read a little above range with healthy kidneys." },
    { kicker: "Liver enzymes", text: "Heavy lifting can raise ALT and AST for several days, enough to look like a liver problem on paper." },
    { kicker: "Timing", text: "Testosterone peaks in the morning, so labs prefer a sample before about 10 a.m." },
    { kicker: "Sleep", text: "In lab studies, a week of about 5 hours' sleep a night lowered testosterone in healthy young men." },
    { kicker: "Protein timing", text: "Spreading protein over 3–4 meals of roughly 20–40 g each supports muscle growth better than one big serving." },
    { kicker: "Vitamin D", text: "Muscle tissue has vitamin D receptors, and very low vitamin D is linked with muscle weakness." },
  ],
  trekking: [
    { kicker: "Thin air", text: "Above about 2,500 m, each breath carries less oxygen. Your body answers by making more red blood cells, and that needs iron." },
    { kicker: "Acclimatising", text: "New red cells take weeks to build up, so heading up with low iron stores can make acclimatising harder." },
    { kicker: "Go slow", text: "Fitness doesn't protect against altitude sickness. Above 3,000 m, the usual advice is to raise your sleeping altitude by no more than about 500 m a day." },
    { kicker: "UV", text: "UV gets roughly 10% stronger for every 1,000 m you climb: good for vitamin D, hard on bare skin." },
    { kicker: "Breath", text: "Cold, dry mountain air takes water with every breath, and thirst lags behind what you lose." },
    { kicker: "On the road", text: "Long days on the road can be heavy on refined carbs and light on protein. Dal, eggs, curd, chana and sprouts travel well." },
    { kicker: "Lemon on dal", text: "Vitamin C boosts the iron you absorb from plant foods. A squeeze of lemon or an amla with your meal helps." },
  ],
  cycling: [
    { kicker: "Bones", text: "Cycling barely loads bone. Some studies find lower bone density in cyclists than runners, so some impact or strength work helps." },
    { kicker: "Fuel", text: "For rides over 90 minutes, a common guideline is 30–60 g of carbohydrate per hour." },
    { kicker: "Sweat", text: "Long hours in the saddle mean steady sweat losses of sodium and some magnesium." },
    { kicker: "Iron", text: "Endurance volume raises iron needs on the bike too, even without the foot strike runners get." },
  ],
  swimming: [
    { kicker: "Indoors", text: "Pool swimmers get little sun on training days, and often test lower on vitamin D." },
    { kicker: "Pool sweat", text: "You sweat in the pool too. You just don't notice it." },
    { kicker: "Bones", text: "Swimming is non weight-bearing, so it does less for bone density than running or lifting." },
    { kicker: "Thyroid", text: "Thyroid hormones set your metabolic pace, which is why TSH sits near the top for endurance athletes." },
  ],
  yoga: [
    { kicker: "Breath", text: "Slow-breathing practices shift the nervous system towards rest; some studies show lower resting heart rate and blood pressure over time." },
    { kicker: "Load", text: "Yoga builds mobility but loads bone lightly. Adding some strength work helps as the years go on." },
    { kicker: "B12", text: "Many yoga practitioners eat vegetarian. Without dairy or eggs, B12 is the vitamin most likely to run low." },
  ],
  team: [
    { kicker: "Stop-start", text: "Football, cricket and badminton mix sprints with recovery, which taxes both muscle and the aerobic system." },
    { kicker: "Heat", text: "A day in the field in Indian summer can mean litres of sweat, with sodium going out alongside." },
    { kicker: "CK", text: "Sprinting and sudden stops are hard on muscle, so CK can read high after a match." },
  ],
  walking: [
    { kicker: "After meals", text: "A brisk 10-minute walk after a meal can blunt the blood-sugar rise from that meal." },
    { kicker: "Steps", text: "In large studies, adults walking about 7,000 or more steps a day had lower death rates than those at 2,000–4,000." },
    { kicker: "Muscle", text: "Muscle is the biggest sink for blood sugar. Even two short strength sessions a week help." },
  ],
  starting: [
    { kicker: "First steps", text: "The biggest health gains come from going from nothing to something. The first 150 minutes a week matter most." },
    { kicker: "Reversible", text: "In a major trial, lifestyle change cut the risk of prediabetes turning into diabetes by 58%." },
    { kicker: "Waist", text: "Waist size can say more about metabolic risk than weight. Indian guidelines flag above 90 cm for men and 80 cm for women." },
    { kicker: "Muscle", text: "Muscle is the biggest sink for blood sugar. Even two short strength sessions a week help." },
  ],
};

// Persona facts first, interleaved with general ones so the ring never feels repetitive.
export function factsFor(archetype: Archetype): Fact[] {
  const own = BY_ARCHETYPE[archetype] ?? [];
  const out: Fact[] = [];
  const max = Math.max(own.length, GENERAL.length);
  for (let i = 0; i < max; i++) {
    if (own[i]) out.push(own[i]);
    if (GENERAL[i] && (i % 2 === 1 || !own[i])) out.push(GENERAL[i]);
  }
  for (const g of GENERAL) if (!out.includes(g)) out.push(g);
  return out;
}
