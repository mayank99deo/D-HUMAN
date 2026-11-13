import type { Metadata } from "next";
import { Block, FaqList, GuideCta, GuideHero, JsonLd, Points, Section, SourcesAndMore, Steps, TextLink } from "@/components/site/Guide";
import { VITAMIN_D_RESEARCH } from "@/components/site/sources";
import { MARKERS, PANELS, type Panel } from "@/lib/domain/markers";
import { PLAN, PRICE_TEXT } from "@/lib/domain/plan";
import { guideLd, pageMetadata, type Faq } from "@/lib/seo";
import { isWaitlist } from "@/lib/site-mode";

// Intent: "I have my lab report. Help me understand it."
// Facts come from the code: the panel from lib/domain/markers.ts, the steps from
// lib/platform/analyze.ts, limits from components/platform/Uploader.tsx, privacy
// wording from onboarding's consent. Reads are AI-analysed; nobody else reviews
// them, so the page never says otherwise. No marker thresholds here: those are
// D-Human's own safety limits, not advice, and await a doctor's review.

const PATH = "/blood-report-analysis";
const TITLE = "Blood test report analysis with AI, in plain words | D-Human";
const H1 = "Blood test report analysis, in plain words";
const DESCRIPTION = `Upload a lab report as a PDF or photos and get an AI-analysed read in English, Hindi or Hinglish, aimed at how you train. Not a diagnosis. ${
  isWaitlist ? "Join the waitlist." : `${PLAN.freeReads} reads free.`
}`;

export const metadata: Metadata = pageMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

const KNOWN = MARKERS.filter((m) => !m.derived);
const DERIVED = MARKERS.filter((m) => m.derived);
const GROUPS = (Object.keys(PANELS) as Panel[])
  .map((p) => ({ name: PANELS[p], count: KNOWN.filter((m) => m.panel === p).length }))
  .filter((g) => g.count > 0);

const FAQS: Faq[] = [
  {
    q: "Is this a diagnosis?",
    a: "No. It's an AI-analysed read of your results against their ranges. It talks about markers, ranges and risk, never “you have” a condition. When a result is worth showing a doctor, the read says so first.",
  },
  {
    q: "Does a doctor review my report?",
    a: "No. Reads are AI-analysed. D-Human's safety rules, written in code, decide when a read must send you to a doctor, and they apply whatever the AI writes.",
  },
  {
    q: "Which reports can I upload?",
    a: "Blood reports from any lab, as a PDF or up to 6 photos of the pages, up to 4 MB. Full body checkups and panels for blood count, thyroid, sugar, cholesterol, liver, kidney, vitamins, iron and hormones can all be read.",
  },
  {
    q: "Can I get my read in Hindi?",
    a: "Yes. Reads come in English, Hindi or Hinglish. You pick one when you set up, and can change it in Settings.",
  },
  {
    q: "What happens to my report?",
    a: "Your file stays in your D-Human account, private to you. Claude, an AI model made by Anthropic, reads it for us; that processing happens outside India, on Anthropic's servers. D-Human doesn't sell your data or share it with brands, and you can delete everything, any time, from Settings.",
  },
  {
    q: "How much does it cost?",
    a: isWaitlist
      ? "D-Human is opening in stages. Join the waitlist for early access and launch pricing."
      : `Your first ${PLAN.freeReads} reads are free. After that, a ${PRICE_TEXT} pass gives ${PLAN.passReads} reads over ${PLAN.days} days. It's one payment and doesn't renew.`,
  },
  {
    q: "Can I book a blood test through D-Human?",
    a: "Not yet. Blood tests through D-Human are coming soon. For now, upload a recent report from any lab.",
  },
];

export default function BloodReportAnalysisPage() {
  return (
    <>
      <JsonLd data={guideLd({ path: PATH, name: H1, description: DESCRIPTION, faqs: FAQS })} />
      <GuideHero
        path={PATH}
        title={H1}
        lead="Upload your lab report as a PDF or photos. D-Human's AI copies your results, checks each one against its range, and writes a read in plain words, aimed at your sport, your goal and the event you're training for. It flags anything worth showing a doctor."
        facts={[
          { label: "Upload", value: "A PDF, or up to 6 photos" },
          { label: "Reads in", value: "English, Hindi or Hinglish" },
          { label: "Knows", value: `${KNOWN.length} markers by name, plus ${DERIVED.length} worked out` },
          ...(isWaitlist
            ? [{ label: "Access", value: "Opening in stages" }]
            : [{ label: "Free", value: `${PLAN.freeReads} report reads, then ${PRICE_TEXT} for ${PLAN.days} days` }]),
        ]}
      />

      <Section id="how" tone="paper" layout="stack" title="How a read works">
        <Steps
          steps={[
            { title: "Upload", body: "A PDF from your lab's email or app, or photos of the pages." },
            { title: "AI copies your results", body: "Every marker D-Human knows, plus anything your lab flagged, with your lab's own ranges." },
            { title: "The numbers are checked", body: "Units are converted, each result is placed against its range, and ratios your report didn't print are worked out." },
            { title: "You get your read", body: "A verdict aimed at your event, what's going well, what to work on first, and when to retest." },
          ]}
        />
      </Section>

      <Section id="read" title="What's in a read">
        <Points
          items={[
            "A verdict aimed at what you train for, like a race or a first gym block.",
            "What's going well, so the read isn't only problems.",
            "What to work on, in order, with food first.",
            "Every marker by group, on a rail that shows where it sits in its range.",
            "Questions worth asking a doctor, and when to retest which markers.",
          ]}
        />
        <p className="mt-8 max-w-[62ch] text-graphite">
          Once you have a read, D-Human can build a supplement stack from it, only where a marker points.{" "}
          <TextLink href="/supplements-from-blood-test">How the stack works</TextLink>.
        </p>
      </Section>

      <Section
        id="markers"
        tone="paper"
        title="The markers it knows"
        intro={`${KNOWN.length} markers in ${GROUPS.length} groups, matched against the names labs print. Your lab's own range always wins; if the report prints none, D-Human uses a typical adult range and labels it “typical range”.`}
      >
        <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
          {GROUPS.map((gr) => (
            <li key={gr.name} className="flex items-baseline justify-between gap-3 border-b border-rule py-2.5">
              <span>{gr.name}</span>
              <span className="font-semibold">{gr.count}</span>
            </li>
          ))}
        </ul>
        <Block tone="paper" title="Worked out from your results">
          <p>When your report doesn&apos;t print them, D-Human calculates these, converting units first, and marks them “calculated from your results”:</p>
          <p className="text-ink">{DERIVED.map((m) => m.name).join(", ")}.</p>
        </Block>
        <Block tone="paper" title="Indian report formats">
          <p>
            Platelets in lakhs or per cumm, glucose in mg/dL or mmol/L, vitamin D in ng/mL or nmol/L: about 20 common lab units are
            converted before anything is compared. A marker printed twice keeps its worst reading.
          </p>
        </Block>
      </Section>

      <Section id="safety" title="Safety, built in">
        <Points
          items={[
            "It's an AI read, not a diagnosis, and every read says so.",
            "No doctor reviews reads. Instead, results past D-Human's conservative limits always turn the verdict to “Doctor first”, whatever else the read says, and a few ask you to get medical advice the same day.",
            "A supplement is never suggested for a result that needs a doctor.",
            "If a result comes in a unit D-Human can't check, the read won't give a clear go.",
            "If the name on the report doesn't match your profile, the read says so.",
            "Accounts are for adults, 18 and over.",
          ]}
        />
        <p className="mt-8 max-w-[62ch] text-graphite">
          <TextLink href="/sources-and-safety">Sources and safety</TextLink> has the full rules.
        </p>
      </Section>

      <Section id="why" tone="paper" title="Why start with a report">
        <p>
          <span className="display-num block text-[clamp(4.5rem,3rem+6vw,8rem)]">76%</span>
          <span className="mt-3 block max-w-[34ch] text-smoke">
            deficient in vitamin D, across 2.2 lakh lab tests in 27 Indian cities (2023).
          </span>
        </p>
        <p className="mt-8 max-w-[52ch]">
          You can&apos;t tell which side of that line you&apos;re on without a number. A report you already have is the place to
          start.
        </p>
      </Section>

      <Section id="faq" title="Questions">
        <FaqList faqs={FAQS} tone="ink" />
      </Section>

      <GuideCta title="Know your numbers before you buy another bottle." body="Upload a report you already have, and read it in plain words." />

      <SourcesAndMore path={PATH} sources={[VITAMIN_D_RESEARCH]} />
    </>
  );
}
