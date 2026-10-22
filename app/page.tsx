import { Closing } from "@/components/site/Closing";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Hero } from "@/components/site/Hero";
import { Loop } from "@/components/site/Loop";
import { Plans } from "@/components/site/Plans";
import { Problem } from "@/components/site/Problem";
import { Tests } from "@/components/site/Tests";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Problem />
        <Loop />
        <Tests />
        <Plans />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
