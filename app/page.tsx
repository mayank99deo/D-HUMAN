import { Closing } from "@/components/site/Closing";
import { Footer } from "@/components/site/Footer";
import { Fuel } from "@/components/site/Fuel";
import { Header } from "@/components/site/Header";
import { Hero } from "@/components/site/Hero";
import { Languages } from "@/components/site/Languages";
import { Loop } from "@/components/site/Loop";
import { Problem } from "@/components/site/Problem";
import { TestsSoon } from "@/components/site/TestsSoon";
import { isWaitlist } from "@/lib/site-mode";
// Hidden in both modes for now. To bring one back, restore its import and its line in <main>.
// import { Plans } from "@/components/site/Plans";
// import { Tests } from "@/components/site/Tests";

export default function Home() {
  // Waitlist mode: the page exactly as it was, ending after "Test first. Supplement second."
  if (isWaitlist) {
    return (
      <>
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

  // Open mode, for the pilot: Fuel (calorie tracking) leads, the three languages next, then
  // blood reports, then one more way to start.
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Fuel />
        <Languages />
        <Problem kicker="Blood reports" />
        <Loop />
        <TestsSoon />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
