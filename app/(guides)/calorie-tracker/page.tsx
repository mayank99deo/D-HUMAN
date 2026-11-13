import type { Metadata } from "next";
import { Block, DataTable, FaqList, GuideCta, GuideHero, JsonLd, Points, Section, SourcesAndMore, Steps, TextLink } from "@/components/site/Guide";
import { nativeStyle } from "@/components/site/native";
import { ICMR_ENERGY, ICMR_NIN_2020, IFCT_2017, MIFFLIN_1990 } from "@/components/site/sources";
import { ACTIVITY_FACTOR, MICROS } from "@/lib/domain/nutrition";
import { PLAN, PRICE_TEXT } from "@/lib/domain/plan";
import { SPOKEN } from "@/lib/domain/speech";
import { guideLd, pageMetadata, type Faq } from "@/lib/seo";
import { isWaitlist } from "@/lib/site-mode";

// Intent: "I want an app that counts calories in the Indian food I actually eat."
// Every product fact here comes from the code it describes: languages from
// lib/domain/speech.ts, targets from lib/domain/nutrition.ts, portions from
// lib/ai/food.ts (FOOD_RULES), limits from lib/domain/plan.ts.

const PATH = "/calorie-tracker";
const TITLE = "Calorie tracker for Indian food, by photo or voice | D-Human";
const H1 = "A calorie tracker for Indian food, in your language";
const DESCRIPTION = `Snap, say or type an Indian meal in ${SPOKEN.length} languages, and get calories, protein and ${MICROS.length} micronutrients, counted in katoris and rotis. ${
  isWaitlist ? "Join the waitlist." : `Start free with ${PLAN.freeMeals} meal logs.`
}`;

export const metadata: Metadata = pageMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const LANGUAGE_NAMES = SPOKEN.map((s) => s.name);
const listed = (names: string[]) => `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
const sentence = (text: string) => text[0].toUpperCase() + text.slice(1);
const LANG_CODE: Record<string, string | undefined> = { hi: "hi", bn: "bn", mr: "mr", te: "te", ta: "ta", gu: "gu", kn: "kn", ml: "ml", pa: "pa", ur: "ur" };

const FAQS: Faq[] = [
  {
    q: "Does D-Human know Indian dishes and portions?",
    a: "Yes. It's built for Indian home and street food, and it counts in household measures: katoris, rotis, cups of rice and spoons of oil or ghee. If a photo can't show something, like the ghee on a roti, add a few words with it.",
  },
  {
    q: "Which languages can I log meals in?",
    a: `${listed(LANGUAGE_NAMES)}, by voice or by typing. The meal's name and tip come back in the language you used. Voice needs a browser with speech recognition; anywhere else, type instead.`,
  },
  {
    q: "How accurate are the calorie counts?",
    a: "They're estimates from a photo or your words, not lab measurements. The AI adds the cooking oil and ghee people tend to forget, and marks a log as a rough estimate when it has to guess a portion. Saying how much you ate, and how it was cooked, makes the estimate closer.",
  },
  {
    q: "Does it track protein too?",
    a: `Yes. Every meal shows calories, protein, carbs, fat and fibre, plus ${MICROS.length} vitamins and minerals. Your protein target is set from your weight and how you train.`,
  },
  {
    q: "Is it free?",
    a: isWaitlist
      ? "D-Human is opening in stages. Join the waitlist for early access and launch pricing."
      : `You get ${PLAN.freeMeals} meal logs free. After that, a ${PRICE_TEXT} pass covers ${PLAN.days} days with up to ${PLAN.mealsPerDay} meal logs a day and ${PLAN.passReads} blood report reads. It's one payment and doesn't renew.`,
  },
  {
    q: "Do I need to install an app?",
    a: "No. D-Human runs in your phone's browser, and you can add it to your home screen to open it like an app.",
  },
  {
    q: "Can it use my blood report?",
    a: "Yes. Add a blood report and each meal's tip follows what it flagged. If your ferritin was low, for example, the tip may point to iron-rich food and what helps you absorb it.",
  },
];

export default function CalorieTrackerPage() {
  const factors = Object.values(ACTIVITY_FACTOR);
  return (
    <>
      <JsonLd data={guideLd({ path: PATH, name: H1, description: DESCRIPTION, faqs: FAQS })} />
      <GuideHero
        path={PATH}
        title={H1}
        lead={`Snap a photo of your thali, say what you ate, or type a few words. D-Human's AI estimates calories, protein, carbs, fat and ${MICROS.length} micronutrients in Indian portions, and replies in the language you used.`}
        facts={[
          { label: "Log by", value: "Photo, voice or a few words" },
          { label: "Languages", value: `${SPOKEN.length}, including English and Hinglish` },
          ...(isWaitlist
            ? [{ label: "Access", value: "Opening in stages" }]
            : [
                { label: "Free", value: `${PLAN.freeMeals} meal logs` },
                { label: "Then", value: `${PRICE_TEXT} for ${PLAN.days} days, up to ${PLAN.mealsPerDay} logs a day` },
              ]),
        ]}
      />

      <Section id="how" tone="paper" layout="stack" title="How it works">
        <Steps
          steps={[
            { title: "Snap, say or type", body: "A photo of the plate, a voice note like “do roti, dal, bhindi”, or a few typed words. Hinglish is fine." },
            { title: "AI reads it in Indian portions", body: "Katoris, rotis, cups of rice, and the spoon of ghee people forget." },
            { title: "See it against your day", body: "Calories and protein against your own targets, with carbs, fat and fibre." },
            { title: "Spot gaps over two weeks", body: `Iron, calcium, vitamin B12 and ${MICROS.length - 3} more, from 14 days of meals or a usual day you describe once.` },
          ]}
        />
      </Section>

      <Section id="indian" title="Built for the way India eats">
        <Block title="Portions the way you serve them">
          <p>
            D-Human&apos;s AI is told to count in household measures: a katori as about 150 mL, a medium roti as about 35 g of atta,
            a cup of cooked rice as about 150 g, and a tablespoon of oil or ghee as about 14 g. For Indian foods it works from the
            Indian Food Composition Tables (IFCT 2017) where it knows the dish.
          </p>
        </Block>
        <Block title="In the language you think in">
          <p>Speak or type in any of these. The meal&apos;s name and tip come back in the language you used.</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-lg">
            {SPOKEN.map((s) => (
              <bdi key={s.id} lang={LANG_CODE[s.id]} style={nativeStyle(LANG_CODE[s.id])} className="text-paper">
                {s.label}
              </bdi>
            ))}
          </p>
          <p>
            Voice uses your browser&apos;s own speech recognition. Some browsers, Chrome among them, send the audio to their
            maker&apos;s servers to turn it into words.
          </p>
        </Block>
        <Block title="Honest about guesses">
          <p>
            Every estimate carries a confidence. When the AI has to guess a portion, the log says it&apos;s a rough estimate, so you
            know which numbers to trust less.
          </p>
        </Block>
      </Section>

      <Section
        id="targets"
        tone="paper"
        title="How your daily targets are set"
        intro="From your height, weight, age, sex and training. Skip any of them and the targets start from typical values, marked as estimated."
      >
        <Block tone="paper" title="Calories">
          <p>
            Your resting energy from the Mifflin–St Jeor equation, times an activity factor from {factors[0]} for people starting
            out to {factors.at(-1)} for elite athletes. A fat-loss goal takes 15% off; building muscle adds 10%.
          </p>
        </Block>
        <Block tone="paper" title="Protein">
          <p>
            ICMR-NIN&apos;s 2020 allowance for healthy Indian adults is 0.83 g per kg of body weight a day. People who train get
            more, up to 2.0 g per kg. <TextLink href="/protein-tracker">See protein targets by weight</TextLink>.
          </p>
        </Block>
        <Block tone="paper" title="Vitamins and minerals">
          <p>
            {sentence(listed(MICROS.map((m) => (m.label.startsWith("Vitamin") ? m.label : m.label.toLowerCase()))))}, against
            ICMR-NIN&apos;s 2020 allowances for adults.
          </p>
        </Block>
        <div className="mt-12">
          <DataTable
            caption="For reference: energy needs of Indian adults, kcal a day"
            head={["Work", "Men, 65 kg", "Women, 55 kg"]}
            rows={ICMR_ENERGY.map((r) => [r.work, r.men, r.women])}
            note="ICMR-NIN 2020, table 1a, at its reference body weights. D-Human sets your own target from your body and training instead."
          />
        </div>
      </Section>

      <Section id="limits" title="What it doesn't do">
        <Points
          items={[
            "Meal numbers are estimates, not lab measurements. Weighing food will always be more exact.",
            "It doesn't scan barcodes or sync with fitness watches.",
            "It isn't a meal plan, and it doesn't replace a dietitian. If a doctor has given you a set diet, follow that.",
            isWaitlist
              ? "It's opening in stages, starting with the waitlist."
              : `Logs are capped: ${PLAN.freeMeals} free in total, and up to ${PLAN.mealsPerDay} a day for everyone.`,
          ]}
        />
      </Section>

      <Section id="faq" tone="paper" title="Questions">
        <FaqList faqs={FAQS} />
      </Section>

      <GuideCta title="Start with your next meal." body="Snap it, say it or type it, in your language." />

      <SourcesAndMore path={PATH} sources={[ICMR_NIN_2020, IFCT_2017, MIFFLIN_1990]} />
    </>
  );
}
