import { SignalField } from "@/components/signal-field/SignalField";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { isWaitlist } from "@/lib/site-mode";
import { StartForm } from "./StartForm";

export function Hero() {
  return (
    <section
      id="top"
      // Open mode's first slide is a snap point too (app/page.tsx); waitlist mode's class is unchanged.
      className={`relative isolate flex min-h-svh flex-col justify-end overflow-hidden pt-28 pb-14 sm:pb-20${isWaitlist ? "" : " snap-start"}`}
    >
      <SignalField className="absolute inset-0 -z-20 h-full w-full" focus={[0.72, 0.62]} />
      {/* Keeps the copy readable where it sits over the field. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,#000_0%,rgb(0_0_0/0.75)_35%,rgb(0_0_0/0)_70%)] lg:bg-[linear-gradient(to_right,#000_0%,rgb(0_0_0/0.8)_32%,rgb(0_0_0/0)_62%)]"
      />

      <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
        <h1 className="headline text-display">
          {/* The space keeps "body speaks" two words for screen readers and search. */}
          <span className="block">Your body</span>{" "}
          <span className="block">speaks data.</span>
        </h1>
        <p className="semiwide mt-5 text-lead font-medium sm:mt-7">Hack your health.</p>
        {isWaitlist ? (
          <p className="mt-8 max-w-[48ch] text-graphite sm:mt-10">
            D-Human tests your blood, gut and body, analyses the results with AI, and recommends
            supplements only where your markers point. Then we retest to show what moved.
          </p>
        ) : (
          // Open mode leads with Fuel, the pilot's everyday habit; the blood report read comes second.
          <>
            <p className="mt-8 max-w-[40ch] text-pretty font-medium sm:mt-10 sm:text-xl">
              Calorie and protein tracking for Indian meals.
            </p>
            <p className="mt-3 max-w-[44ch] text-pretty text-graphite">
              Snap, say or type what you ate, in your language. Add a blood report and AI reads that too.
            </p>
          </>
        )}
        {/* "Join the waitlist" links land here while the closing section is hidden. Open mode keeps
            the anchor so old links to /#join still reach the start form. */}
        <div id="join" className="mt-9 max-w-xl scroll-mt-6">
          {isWaitlist ? <WaitlistForm source="hero" /> : <StartForm />}
        </div>
      </div>
    </section>
  );
}
