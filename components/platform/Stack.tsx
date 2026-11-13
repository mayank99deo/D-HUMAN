"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { StackPlan } from "@/lib/ai/schemas";
import { BUDGETS, budgetOf, fitBudget, rupees, typicalFor } from "@/lib/domain/budget";
import { OFFLINE, send } from "./net";

type StackState = { id: string; status: string; error: string | null; plan: StackPlan | null; demo: boolean; made: string };
type Item = StackPlan["items"][number];
/** A result the safety floor kept out of the stack. */
export type Flagged = { name: string; urgent: boolean };

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const pricedBrands = (item: Item) => item.brands.some((b) => typeof b.monthly_inr === "number");

// The Stack screen. The supplements lead, in priority order and fitted to the
// person's monthly budget (lib/domain/budget.ts); doctor notes close the page in a
// small card. Only a held stack (an urgent result, or pregnancy) says so at the top.
export function StackClient({
  stack,
  stale,
  aiOff,
  markerNames,
  budget: savedBudget,
  flagged,
  hold,
}: {
  stack: StackState | null;
  stale: boolean;
  aiOff: boolean;
  markerNames: Record<string, string>;
  budget: string | null;
  flagged: Flagged[];
  hold: "urgent" | "pregnant" | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [building, setBuilding] = useState(stack?.status === "building" ? stack.id : null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [budget, setBudget] = useState(budgetOf(savedBudget)?.id ?? null);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  useEffect(() => {
    if (!building) return;
    let alive = true;
    (async () => {
      for (let i = 0; i < 120 && alive; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await fetch(`/api/stack/${building}`, { cache: "no-store" }).catch(() => null);
        const data = res?.ok ? await res.json().catch(() => null) : null;
        if (data && data.status !== "building") {
          setBuilding(null);
          startTransition(() => router.refresh());
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [building, router]);

  async function build() {
    if (starting) return;
    setError(null);
    setStarting(true);
    const r = await send<{ id: string; message: string }>("/api/stack");
    setStarting(false);
    if (!r.ok)
      return setError(
        r.offline ? OFFLINE : r.data.message ? r.data.message : r.data.error === "ai_off" ? "Stacks aren't switched on yet on this server." : r.data.error === "rate_limited" ? "Try again in a little while." : "We couldn't start your stack. Try again.",
      );
    if (r.data.id) setBuilding(r.data.id);
  }

  // The stack re-fits at once; the choice is saved for next time (and other devices).
  async function chooseBudget(id: (typeof BUDGETS)[number]["id"]) {
    setBudget(id);
    setBudgetError(null);
    const r = await send("/api/profile", { body: { supplementBudget: id } });
    if (!r.ok) setBudgetError(r.offline ? "No connection, so this budget isn't saved yet. It still applies here." : "We couldn't save your budget. It still applies here.");
  }

  const plan = stack?.status === "ready" ? stack.plan : null;
  const items = useMemo(() => plan?.items ?? [], [plan]);
  const fit = useMemo(() => fitBudget(items, budget), [items, budget]);
  const chosen = budgetOf(budget);
  const capped = chosen?.cap != null;

  const urgentNames = flagged.filter((f) => f.urgent).map((f) => f.name);
  // The end card: results kept out of the stack (urgent ones are already at the top), and any other note.
  const doctorNames = flagged.filter((f) => !(hold === "urgent" && f.urgent)).map((f) => f.name);
  const doctorNotes = hold === "pregnant" ? [] : (plan?.see_doctor ?? []).filter((line) => !flagged.some((f) => line.startsWith(f.name)));

  const title = !plan
    ? "Your stack"
    : hold
      ? "Your stack is on hold."
      : fit.included.length
        ? fit.later.length
          ? `${fit.included.length} for your budget.`
          : `${fit.included.length} for you. Nothing else.`
        : fit.later.length
          ? "Nothing fits this budget yet."
          : doctorNames.length || doctorNotes.length
            ? "Nothing to add for now."
            : "You don't need anything.";

  // "About ₹0" never shows: a stack we can't price at all just doesn't state a total.
  const about = fit.total > 0 ? `About ${rupees(fit.total)} a month` : null;
  const summary = !chosen
    ? "Pick one and we'll fit your stack to it: the most important first, then the best brands it allows."
    : !fit.included.length
      ? `Even the most important one costs more than ${chosen.label} a month. Try the next budget up.`
      : capped
        ? `${about ? `${about}, within ${chosen.label}.` : `Fitted to ${chosen.label}.`}${fit.later.length ? ` ${fit.later.length} more when your budget allows.` : ""}`
        : chosen.id === "not_sure"
          ? `${about ? `${about} with our top brand picks. ` : ""}Pick a budget and we'll fit it.`
          : about
            ? `${about}, with the best brands we found.`
            : "With the best brands we found.";

  const noPrices = items.length > 0 && !items.some(pricedBrands);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">{title}</h1>

      {plan && hold && (
        <p className="error-mark mt-4 max-w-prose text-lg">
          {hold === "urgent" && urgentNames.length
            ? `${list(urgentNames)} ${urgentNames.length > 1 ? "need" : "needs"} medical advice today, so we've held your stack until a doctor has seen ${urgentNames.length > 1 ? "them" : "it"}.`
            : "You're pregnant or breastfeeding, so we've held your stack: take nothing new without your doctor."}
        </p>
      )}

      {aiOff && !plan && <p className="error-mark mt-6 text-sm">Stacks aren&apos;t switched on yet on this server.</p>}

      {building ? (
        <section className="mt-10" aria-live="polite">
          <p className="text-lg font-semibold">Building your stack…</p>
          <p className="mt-2 text-graphite">Weighing your markers against what you eat. The first look for brands sold in India can take a minute.</p>
          <div className="mt-6 h-px overflow-hidden bg-line">
            <div className="h-px w-1/3 animate-pulse bg-paper" />
          </div>
        </section>
      ) : (
        (!plan || stale) && (
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button type="button" onClick={build} disabled={starting} className="button-primary h-13 px-8">
              {starting ? "Starting…" : plan ? "Rebuild from my latest report" : "Build my stack"}
            </button>
            {stack?.status === "failed" && <p className="error-mark text-sm">{stack.error}</p>}
            {error && <p className="error-mark text-sm">{error}</p>}
          </div>
        )
      )}

      {plan && (
        <>
          {stack?.demo && <p className="mt-4 text-sm text-graphite">Demo stack: AI is off on this machine.</p>}

          {items.length > 0 && (
            <section className="mt-8" aria-labelledby="budget">
              <h2 id="budget" className="font-semibold">
                Your monthly budget for supplements
              </h2>
              <div role="radiogroup" aria-labelledby="budget" className="mt-3 flex flex-wrap gap-2">
                {BUDGETS.map((b) => (
                  <label key={b.id} className="choice relative">
                    <input type="radio" name="budget" value={b.id} checked={budget === b.id} onChange={() => chooseBudget(b.id)} className="sr-only" />
                    {b.label}
                  </label>
                ))}
              </div>
              <p className="mt-3 text-sm text-graphite" aria-live="polite">
                {summary}
              </p>
              {budgetError && <p className="error-mark mt-2 text-sm">{budgetError}</p>}
            </section>
          )}

          {fit.included.length > 0 && (
            <ol className="mt-10 space-y-4">
              {fit.included.map((i, n) => {
                const it = items[i];
                const pick = fit.pick[i];
                const typical = typicalFor(it);
                const others = it.brands.map((b, j) => ({ b, j })).filter(({ j }) => j !== pick);
                return (
                  <li key={i} className="border border-line-strong">
                    {/* Numbered like the pointers: an order to read in, most important first. */}
                    <div className="grid grid-cols-[2.5rem_1fr] items-baseline gap-x-3 p-5">
                      <span aria-hidden className="display-num text-3xl text-graphite">
                        {n + 1}
                      </span>
                      <div className="min-w-0">
                        <h2 className="text-2xl font-bold leading-tight semiwide">{it.nutrient}</h2>
                        <p className="mt-1 text-sm text-graphite">For {it.markers.map((k) => markerNames[k] ?? k).join(", ") || it.diet_gap}</p>
                        {fit.cost[i] != null && (
                          <p className="mt-1 text-sm font-semibold">
                            {fit.typical[i] && typical ? `About ${rupees(typical[0])}–${rupees(typical[1]).slice(1)} a month (typical price)` : `About ${rupees(fit.cost[i]!)} a month`}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="px-5 text-[0.9375rem] leading-relaxed">{it.why}</p>
                    <dl className="mt-4 grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
                      {[
                        ["Form", it.form],
                        ["Dose", it.dose],
                        ["When", it.timing],
                        ["For how long", it.duration],
                      ].map(([k, v]) => (
                        <div key={k} className="bg-ink p-4">
                          <dt className="text-xs text-graphite">{k}</dt>
                          <dd className="mt-1 text-sm font-semibold">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {it.cautions && <p className="error-mark border-t border-line px-5 py-3 text-sm">{it.cautions}</p>}
                    {it.brands.length > 0 && (
                      <div className="border-t border-line px-5 py-4">
                        {pick != null && (
                          <>
                            <p className="text-xs text-graphite">{capped ? "Our pick for your budget (not a partner)" : "Our top pick (not a partner)"}</p>
                            <Brand b={it.brands[pick]} strong />
                          </>
                        )}
                        {others.length > 0 && (
                          <>
                            <p className={`text-xs text-graphite ${pick != null ? "mt-4" : ""}`}>{pick != null ? "Other options" : "Brands to consider (not partners)"}</p>
                            <ul className="mt-2 space-y-2">
                              {others.map(({ b, j }) => (
                                <li key={j}>
                                  <Brand b={b} />
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {fit.later.length > 0 && (
            <section className="mt-12" aria-labelledby="later">
              <h2 id="later" className="text-2xl font-bold semiwide">
                When your budget allows
              </h2>
              <p className="mt-2 text-graphite">Less pressing than the ones above, or more than your budget has left. Food first covers them for now.</p>
              <ul className="mt-3">
                {fit.later.map((i) => {
                  const it = items[i];
                  const cheapest = Math.min(...it.brands.map((b) => b.monthly_inr ?? Infinity));
                  const from = Number.isFinite(cheapest) ? cheapest : (typicalFor(it)?.[0] ?? null);
                  return (
                    <li key={i} className="border-t border-line py-4">
                      <p className="font-semibold">{it.nutrient}</p>
                      <p className="mt-1 text-graphite">
                        {it.why}
                        {from != null && ` From about ${rupees(from)} a month.`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {plan.food_first.length > 0 && (
            <section className="mt-12" aria-labelledby="food">
              <h2 id="food" className="text-2xl font-bold semiwide">
                Food first
              </h2>
              <ul className="mt-3 space-y-3">
                {plan.food_first.map((f, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="glyph glyph-in mt-2" aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {plan.skip.length > 0 && (
            <section className="mt-12" aria-labelledby="skip">
              <h2 id="skip" className="text-2xl font-bold semiwide">
                You don&apos;t need these
              </h2>
              <ul className="mt-3">
                {plan.skip.map((s, i) => (
                  <li key={i} className="border-t border-line py-4">
                    <p className="font-semibold line-through decoration-1">{s.name}</p>
                    <p className="mt-1 text-graphite">{s.why}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!building && !stale && (
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <button type="button" onClick={build} disabled={starting} className="link-quiet min-h-11 text-sm">
                {starting ? "Starting…" : noPrices && !aiOff ? "Rebuild to get current brand prices" : "Rebuild with my latest food log"}
              </button>
              {stack?.status === "failed" && <p className="error-mark text-sm">{stack.error}</p>}
              {error && <p className="error-mark text-sm">{error}</p>}
            </div>
          )}
        </>
      )}

      <aside className="mt-10 border border-line-strong p-5 text-[0.9375rem]">
        <p className="font-semibold">We don&apos;t partner with any supplement brand.</p>
        <p className="mt-2 text-graphite">
          Every pick comes from your blood report and what you eat, and nothing else. The brands are suggestions found on merit; D-Human earns nothing from them. Prices are
          as listed when we last looked, for a month at the dose shown, and they change. Check with your doctor before starting anything, especially if you take medicines,
          are pregnant, or have a kidney or liver condition.
        </p>
      </aside>

      {/* Doctor notes close the page, small: results kept out of the stack, and any other note. */}
      {plan && (doctorNames.length > 0 || doctorNotes.length > 0) && (
        <section className="mt-6 border border-line p-4 text-sm" aria-labelledby="doctor">
          <h2 id="doctor" className="font-semibold">
            Worth showing a doctor
          </h2>
          {doctorNames.length > 0 && (
            <p className="mt-1 text-graphite">
              {list(doctorNames)}. We&apos;ve left {doctorNames.length > 1 ? "these" : "this"} out of your stack; a doctor&apos;s look will help you even more.
            </p>
          )}
          {doctorNotes.map((note, i) => (
            <p key={i} className="mt-1 text-graphite">
              {note}
            </p>
          ))}
        </section>
      )}
    </main>
  );
}

function Brand({ b, strong = false }: { b: Item["brands"][number]; strong?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4">
      <span className="min-w-0">
        <span className={strong ? "font-bold" : "font-semibold"}>{b.brand}</span> <span className="text-graphite">{b.product}</span>
        {typeof b.monthly_inr === "number" && (
          <span className="block text-sm">
            About {rupees(b.monthly_inr)} a month{b.price_inr && b.pack ? `: ${rupees(b.price_inr)} for ${b.pack}` : ""}
          </span>
        )}
        {b.note && <span className="block text-sm text-graphite">{b.note}</span>}
      </span>
      {b.url && /^https?:\/\//.test(b.url) && (
        <a href={b.url} target="_blank" rel="noopener noreferrer nofollow" className="link-quiet min-h-11 py-2 text-sm">
          View product
        </a>
      )}
    </div>
  );
}
