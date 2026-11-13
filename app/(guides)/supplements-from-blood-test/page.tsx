import type { Metadata } from "next";
import { Block, FaqList, GuideCta, GuideHero, JsonLd, Points, Section, SourcesAndMore, Steps, TextLink } from "@/components/site/Guide";
import { ICMR_NIN_2020 } from "@/components/site/sources";
import { BUDGETS } from "@/lib/domain/budget";
import { PLAN, PRICE_TEXT } from "@/lib/domain/plan";
import { guideLd, pageMetadata, type Faq } from "@/lib/seo";
import { isWaitlist } from "@/lib/site-mode";

// Intent: "Which supplements should I take, based on my blood test?"
// The rules are lib/domain/supplements.ts and the safety floor lib/domain/safety.ts;
// the budget is lib/domain/budget.ts. House rules for public pages: no brand names
// and no doses here. Doses live in the stack, next to the person's own markers.

const PATH = "/supplements-from-blood-test";
const TITLE = "Supplements based on your blood test, not guesswork | D-Human";
const H1 = "Supplements based on your blood test";
const DESCRIPTION =
  "A supplement only where a blood marker or a food gap that keeps coming back points to it, with cautions, food first and your monthly budget. No brand partners.";

export const metadata: Metadata = pageMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

// What earns each item, in plain words, from the rules in lib/domain/supplements.ts.
const EARNS: [string, string][] = [
  ["Vitamin D3", "Vitamin D low, or at the bottom of its range"],
  ["Vitamin B12", "B12 low; at the bottom of its range too, on a vegetarian or vegan diet"],
  ["Iron", "Ferritin measured low, and only once a doctor agrees"],
  ["Folate", "Folate low"],
  ["Magnesium", "Magnesium low, or meals well short of it"],
  ["Omega-3", "Triglycerides high, or near the top of their range"],
  ["Calcium", "Meals well short of calcium"],
  ["Protein", "Meals short of what your training needs; not for people just starting out"],
  ["Zinc", "Meals short of zinc, on a plant-based diet"],
];

const FAQS: Faq[] = [
  {
    q: "Which supplements should I take, based on my blood test?",
    a: "Only the ones a result or a real food gap points to. D-Human adds an item for a marker that's low or at the bottom of its range, like vitamin D or B12, or for a nutrient your meals keep missing. Anything that needs a doctor goes to a doctor first, not into the stack.",
  },
  {
    q: "Will D-Human tell me to take iron?",
    a: "Only when your ferritin is measured low, and only once a doctor agrees, because the cause of low iron matters. If your ferritin is fine, the stack lists iron under what you can skip.",
  },
  {
    q: "Does D-Human sell supplements or earn from brands?",
    a: "No. D-Human has no brand partners and earns nothing from the brands in a stack. Brands are found on merit and named only inside your stack.",
  },
  {
    q: "I'm pregnant or breastfeeding. Can I use the stack?",
    a: "The stack holds every item while you're pregnant or breastfeeding, and asks you to show your report to your doctor before taking anything new.",
  },
  {
    q: "How long should I take a supplement?",
    a: "Each item says how long, often 8 to 12 weeks, and which marker to retest after. Items for a food gap last while your meals fall short.",
  },
  {
    q: "What does a stack cost?",
    a: isWaitlist
      ? "D-Human is opening in stages. Join the waitlist for early access and launch pricing."
      : `The stack itself is free once you have a read. Your first ${PLAN.freeReads} report reads are free; after that, a ${PRICE_TEXT} pass gives ${PLAN.passReads} reads over ${PLAN.days} days. What you spend on supplements is up to you, and the stack fits your budget.`,
  },
];

export default function SupplementsFromBloodTestPage() {
  const capped = BUDGETS.filter((b) => b.cap !== null);
  return (
    <>
      <JsonLd data={guideLd({ path: PATH, name: H1, description: DESCRIPTION, faqs: FAQS })} />
      <GuideHero
        path={PATH}
        title={H1}
        lead="Upload a blood report and D-Human builds a stack only from what it shows: a supplement for a low marker or a food gap that keeps coming back, at a conservative dose, with what to eat first and what you can skip."
        facts={[
          { label: "Earned by", value: "A low marker, or a food gap that repeats" },
          { label: "Doses", value: "At the low end, within adult upper limits" },
          { label: "Brands", value: "Found on merit; no brand partners" },
          { label: "Budget", value: "Fitted to what you want to spend a month" },
        ]}
      />

      <Section id="rules" tone="paper" title="The rules every stack follows" intro="Worked out in code from your markers and meals, the same way every time.">
        <ol className="grid gap-6">
          {[
            ["No marker, no pitch.", "An item is added only for a result that's low or at the bottom of its range, or a food gap that shows up again and again in your meals."],
            ["Food first.", "Every stack starts with the foods that close the gap."],
            ["Conservative doses.", "At the low end, and within the tolerable upper limits for adults, which ICMR-NIN's 2020 requirements define."],
            ["Doctor before pills.", "A result that needs a doctor is never treated with a supplement; the stack sends it to “See a doctor first”. If any result is urgent, the stack holds everything."],
            ["Iron needs proof.", "Only with a measured low ferritin, and only once a doctor agrees."],
            ["Your health comes into it.", "Nothing new while pregnant or breastfeeding. Magnesium, calcium and protein are held for kidney conditions. Your medicines are added to the cautions."],
            ["What to skip.", "The stack also lists what your results say you don't need, starting with a multivitamin."],
          ].map(([title, body], i) => (
            <li key={title} className="grid grid-cols-[2.5rem_1fr] border-t border-rule pt-5">
              <span aria-hidden="true" className="display-num text-2xl">
                {i + 1}
              </span>
              <span>
                <span className="block text-lg font-bold leading-snug">{title}</span>
                <span className="mt-1 block text-smoke">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="covers" title="What a stack can hold" intro="Nine nutrients, each earned by a marker or a gap in your meals. Everything else stays out.">
        <dl className="border-t border-paper/15">
          {EARNS.map(([name, earns]) => (
            <div key={name} className="grid gap-1 border-b border-paper/15 py-3 sm:grid-cols-[11rem_1fr] sm:gap-6">
              <dt className="font-bold">{name}</dt>
              <dd className="text-graphite">{earns}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 max-w-[62ch] text-graphite">
          Each item comes with its form, dose, timing, how long to take it, cautions, and which marker to retest after.
        </p>
      </Section>

      <Section id="budget" tone="paper" title="Fitted to your budget">
        <Block tone="paper" title="Most important first">
          <p>
            Pick a monthly budget, from {capped[0].label.toLowerCase()} to {BUDGETS.find((b) => b.id === "5000_plus")!.label.toLowerCase()}.
            Results outside their range come first, then the edge of range, then the biggest food gaps. Each item starts at its
            cheapest good brand until the budget is spent; the rest wait under “when your budget allows”. Money left over upgrades
            brands in the same order.
          </p>
        </Block>
        <Block tone="paper" title="Brands, found on merit">
          <p>
            Each item names brands sold in India, found by an AI web search that&apos;s refreshed monthly. D-Human has no brand
            partners and earns nothing from them. Brands appear only inside your stack, never on this site.
          </p>
        </Block>
      </Section>

      <Section id="how" layout="stack" title="From report to stack">
        <Steps
          tone="ink"
          steps={[
            { title: "Upload a report", body: <>A PDF or photos. <TextLink href="/blood-report-analysis">How reads work</TextLink>.</> },
            { title: "Get your read", body: "Every marker against its range, and what needs a doctor first." },
            { title: "Build your stack", body: "Only what a marker or a repeated food gap points to, with food first." },
            { title: "Retest", body: "Each item says when, so you can see what moved." },
          ]}
        />
      </Section>

      <Section id="limits" tone="paper" title="What it doesn't do">
        <Points
          tone="paper"
          items={[
            "It doesn't diagnose or treat any condition, and it doesn't replace your doctor.",
            "It doesn't sell supplements or take money from brands.",
            "It won't suggest anything for a result that needs a doctor.",
            "Brand prices are as listed when the search ran; check them where you buy.",
          ]}
        />
      </Section>

      <Section id="faq" title="Questions">
        <FaqList faqs={FAQS} tone="ink" />
      </Section>

      <GuideCta title="Know your numbers before you buy another bottle." body="Upload a report you already have. The stack follows what it shows." />

      <SourcesAndMore path={PATH} sources={[ICMR_NIN_2020]} />
    </>
  );
}
