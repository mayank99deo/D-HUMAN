"use client";

import { useEffect, useState } from "react";
import { OrbitScreen, type OrbitFact, type OrbitStep } from "./Orbit";

// The waiting screen while Claude reads a meal or a usual day: the orbit, with
// facts picked for the person's age, height and weight bands, and their bands
// circling in the outer ring. Reading a meal has no step-by-step progress from
// the server, so the ring fills on a curve that slows near the end and jumps
// to 100% when the answer arrives.

export type MealRun = {
  kind: "meal" | "typical";
  startedAt: number;
  state: "running" | "done" | "error";
  result?: { title: string; kcal: number; proteinG: number; tip: string | null; demo: boolean };
  patterns?: string[];
  error?: string;
};

const STEPS: Record<MealRun["kind"], string[]> = {
  meal: ["Looking at your plate", "Sizing the portions", "Counting the nutrients", "Checking it against your markers"],
  typical: ["Reading your day", "Splitting it into meals", "Counting the nutrients", "Finding your patterns"],
};

export function MealOrbit({ run, facts, categories, onClose }: { run: MealRun; facts: OrbitFact[]; categories: string[]; onClose: () => void }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (run.state !== "running") return;
    const id = setInterval(() => setElapsed(Date.now() - run.startedAt), 250);
    return () => clearInterval(id);
  }, [run.state, run.startedAt]);

  const running = run.state === "running";
  const p = running ? 0.06 + 0.86 * (1 - Math.exp(-elapsed / 3500)) : run.state === "done" ? 1 : 0.06;
  // Step reached: moves with the ring while reading; all done when finished; none ticked after an error.
  const at = running ? Math.min(3, Math.floor((p / 0.92) * 4)) : run.state === "done" ? 4 : -1;
  const steps: OrbitStep[] = STEPS[run.kind].map((text, i) => ({ text, state: i < at ? "done" : i === at ? "now" : "next" }));

  const done =
    run.kind === "meal" && run.result ? (
      <div>
        <p className="text-sm text-graphite">Logged{run.result.demo ? " (demo estimate)" : ""}</p>
        <p className="mt-1 line-clamp-2 text-[clamp(1.05rem,3.4vw,1.75rem)] font-bold leading-tight">{run.result.title}</p>
        <p className="mt-2 flex items-baseline justify-center gap-4">
          <span>
            <span className="display-num text-2xl sm:text-3xl">{Math.round(run.result.kcal)}</span> <span className="text-xs text-graphite sm:text-sm">kcal</span>
          </span>
          <span>
            <span className="display-num text-2xl sm:text-3xl">{Math.round(run.result.proteinG)}</span> <span className="text-xs text-graphite sm:text-sm">g protein</span>
          </span>
        </p>
        {run.result.tip && <p className="mx-auto mt-2 line-clamp-3 max-w-[22rem] text-xs leading-snug sm:text-sm">{run.result.tip}</p>}
      </div>
    ) : (
      <div>
        <p className="text-[clamp(1.05rem,3.4vw,1.75rem)] font-bold leading-tight">Your usual day is saved.</p>
        {run.patterns?.[0] && <p className="mx-auto mt-2 line-clamp-3 max-w-[22rem] text-xs leading-snug sm:text-sm">{run.patterns[0]}</p>}
      </div>
    );

  return (
    <div role="dialog" aria-modal aria-label={run.kind === "meal" ? "Reading your meal" : "Reading your usual day"} className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-ink px-3 py-6">
      <OrbitScreen
        facts={facts}
        ring={categories.length ? categories : ["Picked for you"]}
        steps={steps}
        progress={p}
        state={run.state}
        ripples={Math.round(p * 12)}
        caption={categories.length ? "Facts picked for your age, height and weight" : "Facts while you wait"}
        done={done}
        error={run.error}
        actions={
          <button type="button" onClick={onClose} className="button-primary h-11 px-8 sm:h-12">
            {run.state === "error" ? "Back to Fuel" : "Done"}
          </button>
        }
      />
      {running && (
        <button type="button" onClick={onClose} className="link-quiet mt-8 min-h-11 py-3 text-sm">
          Close. We&apos;ll keep reading it.
        </button>
      )}
    </div>
  );
}
