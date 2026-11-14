import type { Metadata } from "next";
import { Closing } from "@/components/site/Closing";
import { Footer } from "@/components/site/Footer";
import { Fuel } from "@/components/site/Fuel";
import { Header } from "@/components/site/Header";
import { Hero } from "@/components/site/Hero";
import { Loop } from "@/components/site/Loop";
import { Problem } from "@/components/site/Problem";
import { Reports } from "@/components/site/Reports";
import { HOME_DESCRIPTION, HOME_TITLE, homeLd, ldJson, pageMetadata } from "@/lib/seo";
import { isWaitlist } from "@/lib/site-mode";
// Hidden in both modes for now. To bring one back, restore its import and its line in <main>.
// import { Plans } from "@/components/site/Plans";
// import { Tests } from "@/components/site/Tests";

// Open mode's slides settle into place on wide screens. Proximity, never mandatory, so a
// tall slide never traps anyone; off on phones (slides run taller than the screen there)
// and for reduced motion. Hoisted into <head> by React and gone when the page unmounts.
const SNAP = "@media (min-width: 1024px) and (prefers-reduced-motion: no-preference) { html { scroll-snap-type: y proximity; } }";

// The canonical URL and share tags; title and description as in the root layout.
export const metadata: Metadata = pageMetadata({ path: "/", title: HOME_TITLE, description: HOME_DESCRIPTION });

// Who we are and the site, plus (open mode) the app with its free start, as the Start
// free form states it. Invisible; read by search engines.
function StructuredData() {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(homeLd()) }} />;
}

export default function Home() {
  // Waitlist mode: the page exactly as it was, ending after "Test first. Supplement second."
  if (isWaitlist) {
    return (
      <>
        <StructuredData />
        <Header />
        <main>
          <Hero />
          <Problem />
          <Loop />
          {/* <Tests /> */}
          {/* <Plans /> */}
        </main>
        <Footer />
      </>
    );
  }

  // Open mode, for the pilot: five slides, alternating black and white.
  // 1 black: the hero and Start free. 2 white: Fuel, calorie tracking in your language.
  // 3 black: blood reports, the 76% figure and tests through D-Human coming soon.
  // 4 white: the phone, test first and supplement second. 5 black: Start free again,
  // with the footer filling out the last screen.
  return (
    <>
      <style href="landing-snap" precedence="default">
        {SNAP}
      </style>
      <StructuredData />
      <Header />
      <main>
        <Hero />
        <Fuel />
        <Reports />
        <Loop slide />
        <Closing className="flex snap-start flex-col justify-center py-20 lg:min-h-[calc(100svh-5rem-13rem)]" />
      </main>
      <Footer />
    </>
  );
}
