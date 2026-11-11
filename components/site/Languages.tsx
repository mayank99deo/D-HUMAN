import type { ReactNode } from "react";
import { LANGUAGES, type LanguageId } from "@/lib/domain/options";
import { Hindi } from "./Hindi";

// The three languages a person can pick in onboarding and Settings. Labels and
// the report lines come from lib/domain/options.ts, the same samples people see
// when they choose. The meal note is an example written for this page, matching
// the tip on the Fuel card above; marker names stay in English, as the app's
// language rule asks (lib/ai/client.ts).
const MEAL_NOTE: Record<LanguageId, string> = {
  en: "Ferritin was low on your report. Squeeze lemon on the dal: vitamin C helps your body absorb its iron.",
  hi: "रिपोर्ट में आपका ferritin कम था। दाल पर नींबू निचोड़ लें: विटामिन C की मदद से शरीर दाल का आयरन बेहतर सोख पाता है।",
  hinglish: "Report mein aapka ferritin low tha. Dal pe nimbu nichod lo: vitamin C se body dal ka iron better absorb karti hai.",
};

// A paragraph in the language's own script and font.
function Line({ id, className, children }: { id: LanguageId; className: string; children: ReactNode }) {
  return id === "hi" ? (
    <Hindi as="p" className={className}>
      {children}
    </Hindi>
  ) : (
    <p className={className}>{children}</p>
  );
}

export function Languages() {
  return (
    <section aria-labelledby="languages-title" className="paper py-24 sm:py-32">
      <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
        <h2 id="languages-title" className="semiwide max-w-[18ch] text-title font-bold">
          English, <Hindi>हिंदी</Hindi> or Hinglish.
        </h2>
        <p className="mt-6 max-w-[46ch] text-smoke">
          Pick your language when you sign up, and change it any time in Settings. Meal notes, report reads,
          wraps and stacks come back in it.
        </p>

        <ul className="mt-14 grid border-t border-ink lg:grid-cols-3 lg:gap-8">
          {LANGUAGES.map((l) => (
            <li key={l.id} className="border-b border-rule py-7 lg:border-b-0 lg:pt-6 lg:pb-0">
              <Line id={l.id} className="wide text-sm font-extrabold">
                {l.label}
              </Line>
              <p className="mt-5 text-sm text-smoke">Meal note</p>
              <Line
                id={l.id}
                className={`semiwide mt-1 text-lg font-semibold sm:text-2xl ${l.id === "hi" ? "leading-normal" : "leading-snug"}`}
              >
                {MEAL_NOTE[l.id]}
              </Line>
              <p className="mt-6 text-sm text-smoke">Report read</p>
              <Line id={l.id} className="mt-1 font-semibold">
                {l.sample}
              </Line>
            </li>
          ))}
        </ul>

        <p className="mt-10 max-w-[62ch] text-sm text-smoke">
          Example lines. Voice logging listens in Hindi when <Hindi>हिंदी</Hindi> is your language, and in Indian
          English otherwise. Buttons and menus are in English for now.
        </p>
      </div>
    </section>
  );
}
