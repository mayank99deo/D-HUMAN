import type { Metadata } from "next";
import { Block, DataTable, FaqList, GuideCta, GuideHero, JsonLd, Points, Section, SourcesAndMore, Steps, TextLink } from "@/components/site/Guide";
import { ICMR_NIN_2020, ICMR_PROTEIN, ISSN_2017, ISSN_PROTEIN } from "@/components/site/sources";
import { PROTEIN_PER_KG } from "@/lib/domain/nutrition";
import { PLAN, PRICE_TEXT } from "@/lib/domain/plan";
import { guideLd, pageMetadata, type Faq } from "@/lib/seo";
import { isWaitlist } from "@/lib/site-mode";

// Intent: "How much protein do I need a day, and how do I track it on an Indian diet?"
// The table is worked out from the two sourced rates (ICMR-NIN 2020, ISSN 2017); the
// product's own rates come from lib/domain/nutrition.ts. No food protein values here:
// those wait for a sourced dataset (IFCT 2017), see docs/team/seo/STRATEGY.md.

const PATH = "/protein-tracker";
const TITLE = "Protein tracker for Indian diets: how much you need | D-Human";
const H1 = "How much protein you need, and a tracker for Indian meals";
const DESCRIPTION = `How much protein you need a day, from ICMR-NIN 2020's ${ICMR_PROTEIN.rdaPerKg} g per kg to more for training, with a table by body weight. Track it by photo, voice or text.`;

export const metadata: Metadata = pageMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const WEIGHTS = [45, 50, 55, 60, 65, 70, 75, 80, 90, 100];
const g = (kg: number, perKg: number) => Math.round(kg * perKg);

const FAQS: Faq[] = [
  {
    q: "How much protein do I need a day?",
    a: `ICMR-NIN 2020 sets ${ICMR_PROTEIN.rdaPerKg} g per kg of body weight a day for healthy Indian adults: about ${Math.round(ICMR_PROTEIN.refMan.g)} g for a ${ICMR_PROTEIN.refMan.kg} kg man and ${Math.round(ICMR_PROTEIN.refWoman.g)} g for a ${ICMR_PROTEIN.refWoman.kg} kg woman. On cereal-based diets with lower-quality protein it's ${ICMR_PROTEIN.cerealDietPerKg} g per kg. If you train regularly, you need more.`,
  },
  {
    q: "Is 0.83 g per kg enough if I go to the gym?",
    a: `It's the allowance for healthy adults in general. For building and keeping muscle with exercise, the International Society of Sports Nutrition suggests ${ISSN_PROTEIN.low}–${ISSN_PROTEIN.high.toFixed(1)} g per kg a day for most people who exercise. D-Human raises your target with your training.`,
  },
  {
    q: "Does D-Human count the protein in Indian food?",
    a: "Yes. Every meal you snap, say or type shows its protein, with calories, carbs, fat and fibre, in Indian portions. Today's totals show your protein against your target.",
  },
  {
    q: "Do I need protein powder?",
    a: "Food comes first. D-Human's stack suggests protein only when your meals keep falling short of what your training needs, never for people just starting out, and never for people who report a kidney condition.",
  },
  {
    q: "What about pregnancy?",
    a: `ICMR-NIN 2020 adds ${ICMR_PROTEIN.pregnancy.second} g a day in the second trimester and ${ICMR_PROTEIN.pregnancy.third} g in the third. D-Human's targets don't make that adjustment, so follow your doctor's advice.`,
  },
  {
    q: "Is it free?",
    a: isWaitlist
      ? "D-Human is opening in stages. Join the waitlist for early access and launch pricing."
      : `You get ${PLAN.freeMeals} meal logs free. After that, a ${PRICE_TEXT} pass covers ${PLAN.days} days with up to ${PLAN.mealsPerDay} meal logs a day. It's one payment and doesn't renew.`,
  },
];

const LEVELS: [string, string][] = [
  ["starting", "Starting out"],
  ["regular", "Training regularly"],
  ["competitive", "Competing"],
  ["elite", "Elite"],
];

export default function ProteinTrackerPage() {
  return (
    <>
      <JsonLd data={guideLd({ path: PATH, name: H1, description: DESCRIPTION, faqs: FAQS })} />
      <GuideHero
        path={PATH}
        title={H1}
        lead={`ICMR-NIN puts protein for healthy Indian adults at ${ICMR_PROTEIN.rdaPerKg} g per kg of body weight a day, and ${ICMR_PROTEIN.cerealDietPerKg} g per kg on cereal-based diets with lower-quality protein. People who train need more. D-Human sets your target from your weight and training, and counts the protein in every meal you log.`}
        facts={[
          { label: "Healthy adults", value: `${ICMR_PROTEIN.rdaPerKg} g per kg a day (ICMR-NIN 2020)` },
          { label: `A ${ICMR_PROTEIN.refMan.kg} kg man`, value: `About ${Math.round(ICMR_PROTEIN.refMan.g)} g a day` },
          { label: `A ${ICMR_PROTEIN.refWoman.kg} kg woman`, value: `About ${Math.round(ICMR_PROTEIN.refWoman.g)} g a day` },
          { label: "People who exercise", value: `${ISSN_PROTEIN.low}–${ISSN_PROTEIN.high.toFixed(1)} g per kg (ISSN 2017)` },
        ]}
      />

      <Section
        id="table"
        tone="paper"
        title="Protein a day, by body weight"
        intro="Find your weight, then the column that fits how you live. Grams a day, rounded."
      >
        <DataTable
          caption="Grams of protein a day"
          head={["Body weight", `${ICMR_PROTEIN.rdaPerKg} g/kg`, `${ICMR_PROTEIN.cerealDietPerKg} g/kg`, `${ISSN_PROTEIN.low}–${ISSN_PROTEIN.high.toFixed(1)} g/kg`]}
          rows={WEIGHTS.map((kg) => [`${kg} kg`, g(kg, ICMR_PROTEIN.rdaPerKg), g(kg, ICMR_PROTEIN.cerealDietPerKg), `${g(kg, ISSN_PROTEIN.low)}–${g(kg, ISSN_PROTEIN.high)}`])}
          note={
            <>
              {ICMR_PROTEIN.rdaPerKg} g/kg: ICMR-NIN 2020&apos;s allowance for healthy adults. {ICMR_PROTEIN.cerealDietPerKg} g/kg: its
              figure for cereal-based diets with lower-quality protein. {ISSN_PROTEIN.low}–{ISSN_PROTEIN.high.toFixed(1)} g/kg: the
              International Society of Sports Nutrition&apos;s range for most people who exercise (2017).
            </>
          }
        />
      </Section>

      <Section id="how" title="How D-Human sets your protein target">
        <Block title="From your weight and your training">
          <p>Your target is your weight times a rate that rises with how you train:</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {LEVELS.map(([id, label]) => (
              <div key={id} className="border-t border-paper/15 pt-3">
                <dt className="text-sm text-graphite">{label}</dt>
                <dd className="display-num mt-1 text-2xl">
                  {PROTEIN_PER_KG[id]}
                  <span className="ml-1 text-sm font-semibold tracking-normal">g/kg</span>
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Building muscle, losing fat, strength training and HYROX raise it to at least 1.6 g per kg. It never goes above 2.0 g
            per kg.
          </p>
        </Block>
        <Block title="Counted in every meal">
          <p>
            Snap, say or type a meal and its protein shows with calories, carbs, fat and fibre. Over two weeks, D-Human shows whether
            protein is one of your biggest gaps. <TextLink href="/calorie-tracker">How meal logging works</TextLink>.
          </p>
        </Block>
        <Block title="Protein quality, the ICMR way">
          <p>
            ICMR-NIN suggests a cereal, legume and milk mix of about {ICMR_PROTEIN.mix} in the diet for good protein quality: three parts
            cereal to one part legumes, such as dal, and two and a half parts milk.
          </p>
        </Block>
      </Section>

      <Section id="steps" tone="paper" layout="stack" title="Track it in a minute a meal">
        <Steps
          steps={[
            { title: "Tell D-Human about you", body: "Height, weight, age and how you train. Your protein target follows." },
            { title: "Log a meal", body: "Snap the plate, say it, or type it, in English, Hinglish, Hindi and 9 more languages." },
            { title: "See your protein", body: "Each meal shows its grams, and today's total sits against your target." },
            { title: "Close the gap with food", body: "If protein runs short for two weeks, it shows as a gap, food first." },
          ]}
        />
      </Section>

      <Section id="limits" title="What it doesn't do">
        <Points
          items={[
            "It estimates protein from a photo or your words; it doesn't weigh food.",
            "It doesn't adjust targets for pregnancy, breastfeeding or kidney disease. Ask your doctor about protein in those cases.",
            "It never suggests protein powder to people who report a kidney condition.",
          ]}
        />
      </Section>

      <Section id="faq" tone="paper" title="Questions">
        <FaqList faqs={FAQS} />
      </Section>

      <GuideCta title="See your protein, meal by meal." body="Snap it, say it or type it, in your language." />

      <SourcesAndMore path={PATH} sources={[ICMR_NIN_2020, ISSN_2017]} />
    </>
  );
}
