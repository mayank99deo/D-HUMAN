import { SignalField } from "@/components/signal-field/SignalField";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";

export function Closing() {
  return (
    <section
      id="join"
      aria-labelledby="join-title"
      className="relative isolate overflow-hidden border-t border-paper/15 py-28 sm:py-40"
    >
      <SignalField className="absolute inset-0 -z-20 h-full w-full" seed={3} focus={[0.85, 0.4]} />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#000_0%,rgb(0_0_0/0.85)_40%,rgb(0_0_0/0.2)_100%)]"
      />
      <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
        <h2 id="join-title" className="wide max-w-[16ch] text-title font-extrabold">
          Know your numbers before you buy another bottle.
        </h2>
        <p className="mt-6 max-w-[44ch] text-graphite">
          Join the waitlist for early access and launch pricing.
        </p>
        <div className="mt-10 max-w-xl">
          <WaitlistForm source="closing" />
        </div>
      </div>
    </section>
  );
}
