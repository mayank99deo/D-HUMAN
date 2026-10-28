import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Hero } from "@/components/site/Hero";
import { Loop } from "@/components/site/Loop";
import { Problem } from "@/components/site/Problem";
// Hidden for now: the page ends after "Test first. Supplement second."
// To bring a section back, restore its import and its line in <main>.
// import { Closing } from "@/components/site/Closing";
// import { Plans } from "@/components/site/Plans";
// import { Tests } from "@/components/site/Tests";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Problem />
        <Loop />
        {/* <Tests /> */}
        {/* <Plans /> */}
        {/* <Closing /> */}
      </main>
      <Footer />
    </>
  );
}
