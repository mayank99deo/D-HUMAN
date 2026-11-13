import type { Metadata } from "next";
import { Block, GuideCta, GuideHero, JsonLd, Points, Section, SourcesAndMore } from "@/components/site/Guide";
import { ICMR_NIN_2020, IFCT_2017, ISSN_2017, MIFFLIN_1990, VITAMIN_D_RESEARCH } from "@/components/site/sources";
import { guideLd, pageMetadata } from "@/lib/seo";

// The trust page the other guides point to: which AI, the rules in code it can't
// override, where the numbers come from, and what happens to people's data.
// Mirrors docs/platform/PHASE-1.md ("Safety rules built in") and onboarding's consent.
// Health pages are judged on trust; keep this one exact and current.

const PATH = "/sources-and-safety";
const TITLE = "Sources and safety: how D-Human's AI reads work | D-Human";
const H1 = "How D-Human's reads are made, and where its numbers come from";
const DESCRIPTION =
  "Which AI reads your reports and meals, the safety rules in code it can't override, where every number comes from, and how your data is handled.";

export const metadata: Metadata = pageMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const NUMBERS: [string, string][] = [
  ["Your ranges", "The range printed on your lab report. Only when there's none, a typical adult range, labelled “typical range”."],
  ["Meal estimates", "The Indian Food Composition Tables (IFCT 2017) for Indian foods where the AI knows the dish, and USDA values otherwise."],
  ["Calorie targets", "The Mifflin–St Jeor equation for resting energy, times an activity factor for how you train."],
  ["Protein and micronutrients", "ICMR-NIN's 2020 requirements for Indians; more protein for people who train, up to the 2.0 g per kg the International Society of Sports Nutrition gives as the top of its range."],
  ["Ratios", "Worked out in code from your own results, such as triglyceride to HDL, after converting units."],
  ["The vitamin D figure", "Research across 2.2 lakh lab tests in 27 Indian cities (2023): 76% of people tested were deficient."],
];

export default function SourcesAndSafetyPage() {
  return (
    <>
      <JsonLd data={guideLd({ path: PATH, name: H1, description: DESCRIPTION })} />
      <GuideHero
        path={PATH}
        title={H1}
        lead="D-Human uses AI to read blood reports and estimate meals. This page explains which AI, the rules written in code that it can't override, the sources behind every number, and what happens to your data."
        facts={[
          { label: "The AI", value: "Claude, made by Anthropic" },
          { label: "Reviewed by", value: "No doctor; every read says it's AI" },
          { label: "Brand partners", value: "None" },
          { label: "Your data", value: "Delete everything, any time" },
        ]}
      />

      <Section id="ai" tone="paper" title="The AI, and what it doesn't decide">
        <Block tone="paper" title="Which AI">
          <p>
            Claude, AI models made by Anthropic, do three jobs: copying the results off your report, writing your read, and
            estimating your meals. A smaller model copies results and estimates meals; a larger one writes the read.
          </p>
          <p>Every read says it&apos;s AI-analysed and not a diagnosis. No doctor reviews reads.</p>
        </Block>
        <Block tone="paper" title="What's worked out in code instead">
          <p>
            Where each result sits in its range, unit conversions, ratios, your daily targets and your supplement stack are worked out
            in code, the same way every time. The AI copies, explains and estimates; it doesn&apos;t set the rules.
          </p>
        </Block>
      </Section>

      <Section id="safety" title="Safety rules the AI can't override">
        <Points
          items={[
            "Results past D-Human's conservative limits always turn the verdict to “Doctor first”, and a few ask you to get medical advice the same day, whatever the AI writes.",
            "Limits are checked only when the report's unit matches, after converting about 20 common lab units. A result in a unit that can't be checked never gets a clear go.",
            "A marker printed twice keeps its worst reading.",
            "Stacks never treat a result that needs a doctor, hold everything when a result is urgent, and suggest iron only with a measured low ferritin and a doctor's agreement.",
            "Reads never say “you have” a condition. They talk about markers, ranges and risk.",
            "Accounts are for adults, 18 and over, and consent comes before any other question.",
          ]}
        />
      </Section>

      <Section id="numbers" tone="paper" title="Where the numbers come from">
        <dl className="border-t border-rule">
          {NUMBERS.map(([name, from]) => (
            <div key={name} className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[13rem_1fr] sm:gap-6">
              <dt className="font-bold">{name}</dt>
              <dd className="text-smoke">{from}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-smoke">Full references are listed at the end of this page.</p>
      </Section>

      <Section id="data" title="Your data">
        <Points
          items={[
            "Your reports and answers are used only to give you your reads, your food notes and your stack.",
            "Report files stay in your D-Human account, private to you.",
            "Claude, made by Anthropic, reads your reports and meals for us. That processing happens outside India, on Anthropic's servers.",
            "D-Human doesn't sell your data or share it with brands.",
            "Voice logging uses your browser's speech recognition; some browsers send the audio to their maker's servers.",
            "You can delete everything, any time, from Settings.",
          ]}
        />
      </Section>

      <Section id="isnt" tone="paper" title="What D-Human isn't">
        <Points
          tone="paper"
          items={[
            "A doctor, or a diagnosis. It offers wellness guidance and screening, and says when to see a doctor.",
            "A lab, yet. Blood tests through D-Human are coming soon; for now, it reads the reports you bring.",
            "A supplement seller. It has no brand partners and earns nothing from brands.",
            "A meal plan. It estimates what you ate and shows the gaps.",
          ]}
        />
      </Section>

      <GuideCta title="Start with your next meal." body="Or upload a blood report you already have." />

      <SourcesAndMore path={PATH} sources={[ICMR_NIN_2020, IFCT_2017, MIFFLIN_1990, ISSN_2017, VITAMIN_D_RESEARCH]} />
    </>
  );
}
