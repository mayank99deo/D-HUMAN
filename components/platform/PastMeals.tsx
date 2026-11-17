"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { HISTORY_DAYS, type MealView } from "@/lib/domain/meals";
import { MealRow } from "./MealRow";
import { OFFLINE, send } from "./net";
import { TargetBar } from "./Target";

export type PastDay = { date: string; label: string; meals: MealView[] };

// The days before today, newest first. Each day folds open to its meals; yesterday
// starts open, since "what did I eat yesterday?" is the usual question.
export function PastMeals({ days, target }: { days: PastDay[]; target: { kcal: number; proteinG: number } }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    const r = await send(`/api/food/${id}`, { method: "DELETE" });
    setRemoving(null);
    if (!r.ok) return setError(r.offline ? `That meal wasn't deleted. ${OFFLINE}` : "That meal wasn't deleted. Try again.");
    startTransition(() => router.refresh());
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <Link href="/fuel" className="link-quiet inline-flex min-h-11 items-center text-sm">
        Back to Fuel
      </Link>
      <h1 className="verdict-type mt-4 text-[clamp(2.25rem,6.5vw,3.5rem)]">Past meals</h1>
      <p className="mt-3 max-w-prose text-graphite">The {HISTORY_DAYS} days before today. Tap a day to see what you ate.</p>

      {error && (
        <p role="alert" className="error-mark mt-6 text-sm">
          {error}
        </p>
      )}

      {days.length === 0 ? (
        <section className="mt-10 border-t border-line pt-6">
          <p className="text-lg">No meals logged in the last {HISTORY_DAYS} days.</p>
          <p className="mt-2 text-graphite">What you log today shows up here tomorrow.</p>
          <Link href="/fuel" className="button-primary mt-6 h-12">
            Log a meal
          </Link>
        </section>
      ) : (
        <ul className={`mt-8 border-b border-line ${refreshing ? "opacity-70" : ""}`}>
          {days.map((day, i) => {
            const kcal = day.meals.reduce((t, m) => t + m.kcal, 0);
            const protein = day.meals.reduce((t, m) => t + m.proteinG, 0);
            return (
              <li key={day.date} className="border-t border-line">
                <details className="group" open={i === 0 && day.label === "Yesterday"}>
                  <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[1fr_auto_1.25rem] items-center gap-x-4 py-4 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className="block text-lg font-bold semiwide">{day.label}</span>
                      <span className="block text-sm text-graphite">
                        {day.meals.length} meal{day.meals.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-bold">{Math.round(kcal).toLocaleString("en-IN")} kcal</span>
                      <span className="block text-sm text-graphite">{Math.round(protein)} g protein</span>
                    </span>
                    <svg viewBox="0 0 20 20" className="h-5 w-5 text-graphite transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden>
                      <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.75" />
                    </svg>
                    <span className="col-span-3 pt-3" aria-hidden>
                      <TargetBar value={kcal} target={target.kcal} className="" />
                    </span>
                  </summary>
                  <ul className="pb-2">
                    {day.meals.map((m) => (
                      <MealRow key={m.id} meal={m} deleting={removing === m.id} disabled={!!removing} onDelete={() => remove(m.id)} />
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {days.length > 0 && (
        <p className="mt-8 text-sm text-graphite">
          Each bar is that day against your energy target of {target.kcal.toLocaleString("en-IN")} kcal. Meals older than {HISTORY_DAYS} days
          aren&apos;t listed here, and still count in your wraps.
        </p>
      )}
    </main>
  );
}
