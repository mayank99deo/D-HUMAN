import { SignalField } from "@/components/signal-field/SignalField";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";

export function Hero() {
  return (
    <section id="top" className="relative isolate flex min-h-svh flex-col justify-end overflow-hidden pt-28 pb-14 sm:pb-20">
      <SignalField className="absolute inset-0 -z-20 h-full w-full" focus={[0.72, 0.62]} />
      {/* Keeps the copy readable where it sits over the field. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,#000_0%,rgb(0_0_0/0.75)_35%,rgb(0_0_0/0)_70%)] lg:bg-[linear-gradient(to_right,#000_0%,rgb(0_0_0/0.8)_32%,rgb(0_0_0/0)_62%)]"
      />

      <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
        <h1 className="headline text-display">
          <span className="block">Your body</span>
          <span className="block">speaks data.</span>
        </h1>
        <p className="semiwide mt-5 text-lead font-medium sm:mt-7">
          {/* Each beat stays whole when the line wraps on narrow screens. */}
          <span className="inline-block">Hear it.</span> <span className="inline-block">Use it.</span>{" "}
          <span className="inline-block">Own it.</span>
        </p>
        <p className="mt-8 max-w-[48ch] text-graphite sm:mt-10">
          D-Human tests your blood, gut and body, has a doctor review the results, and recommends
          supplements only where your markers point. Then we retest to show what moved.
        </p>
        <div className="mt-9 max-w-xl">
          <WaitlistForm source="hero" />
        </div>
      </div>
    </section>
  );
}
