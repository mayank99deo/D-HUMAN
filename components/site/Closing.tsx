import { SignalField } from "@/components/signal-field/SignalField";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { isWaitlist } from "@/lib/site-mode";
import { StartForm } from "./StartForm";

// `className` lets open mode's last slide stretch this section above the footer.
export function Closing({ className = "py-28 sm:py-40" }: { className?: string }) {
  return (
    <section
      // The hero holds #join in open mode, so this one can't share it.
      id={isWaitlist ? "join" : "start"}
      aria-labelledby="join-title"
      // The landing header is 5rem tall: html's 3.5rem scroll padding plus this.
      className={`relative isolate scroll-mt-6 overflow-hidden border-t border-paper/15 ${className}`}
    >
      <SignalField className="absolute inset-0 -z-20 h-full w-full" seed={3} focus={[0.85, 0.4]} />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#000_0%,rgb(0_0_0/0.85)_40%,rgb(0_0_0/0.2)_100%)]"
      />
      <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
        <h2 id="join-title" className="wide max-w-[16ch] text-title font-extrabold">
          {isWaitlist ? "Know your numbers before you buy another bottle." : "Start with your next meal."}
        </h2>
        <p className="mt-6 max-w-[44ch] text-graphite">
          {isWaitlist
            ? "Join the waitlist for early access and launch pricing."
            : "Snap it, say it or type it, in your language."}
        </p>
        <div className="mt-10 max-w-xl">
          {isWaitlist ? <WaitlistForm source="closing" /> : <StartForm />}
        </div>
      </div>
    </section>
  );
}
