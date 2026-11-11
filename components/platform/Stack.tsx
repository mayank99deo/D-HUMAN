"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { StackPlan } from "@/lib/ai/schemas";
import { OFFLINE, send } from "./net";

type StackState = { id: string; status: string; error: string | null; plan: StackPlan | null; demo: boolean; made: string };

export function StackClient({ stack, stale, aiOff, markerNames }: { stack: StackState | null; stale: boolean; aiOff: boolean; markerNames: Record<string, string> }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [building, setBuilding] = useState(stack?.status === "building" ? stack.id : null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

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

  const plan = stack?.status === "ready" ? stack.plan : null;
  const doctor = plan && plan.see_doctor.length > 0;
  // A doctor list always comes first. With nothing to take (an urgent flag
  // empties the stack), the page must not read as "all clear".
  const title = !plan ? "Your stack" : plan.items.length ? `${plan.items.length} for you. Nothing else.` : doctor ? "See a doctor first." : "You don't need anything.";
  const doctorList = doctor && (
    <section className="mt-8 border border-paper p-5" aria-labelledby="doctor">
      <h2 id="doctor" className="error-mark text-xl font-bold semiwide">
        See a doctor first
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        {plan.see_doctor.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      {plan.items.length === 0 && <p className="mt-3 text-sm text-graphite">Hold off on new supplements until a doctor has seen these. Food first still applies.</p>}
    </section>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">{title}</h1>

      {doctorList}

      <aside className="mt-6 border border-line-strong p-5 text-[0.9375rem]">
        <p className="font-semibold">We don&apos;t partner with any supplement brand.</p>
        <p className="mt-2 text-graphite">
          Every pick comes from your blood report and what you eat, and nothing else. The brands are suggestions found on merit; D-Human earns nothing from them. Check with your doctor before starting anything, especially if you take medicines, are pregnant, or have a kidney or liver condition.
        </p>
      </aside>

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
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {(!plan || stale) && (
            <button type="button" onClick={build} disabled={starting} className="button-primary h-13 px-8">
              {starting ? "Starting…" : plan ? "Rebuild from my latest report" : "Build my stack"}
            </button>
          )}
          {plan && !stale && (
            <button type="button" onClick={build} disabled={starting} className="link-quiet min-h-11 text-sm">
              {starting ? "Starting…" : "Rebuild with my latest food log"}
            </button>
          )}
          {stack?.status === "failed" && <p className="error-mark text-sm">{stack.error}</p>}
          {error && <p className="error-mark text-sm">{error}</p>}
        </div>
      )}

      {plan && (
        <>
          {stack?.demo && <p className="mt-4 text-sm text-graphite">Demo stack: AI is off on this machine.</p>}
          {plan.items.length > 0 && (
            <ol className="mt-10 space-y-4">
              {plan.items.map((it, i) => (
                <li key={i} className="border border-line-strong">
                  {/* Numbered like the pointers: an order to read in, not a control to flip. */}
                  <div className="grid grid-cols-[2.5rem_1fr] items-baseline gap-x-3 p-5">
                    <span aria-hidden className="display-num text-3xl text-graphite">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-2xl font-bold leading-tight semiwide">{it.nutrient}</h2>
                      <p className="mt-1 text-sm text-graphite">For {it.markers.map((k) => markerNames[k] ?? k).join(", ") || it.diet_gap}</p>
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
                      <p className="text-xs text-graphite">Brands to consider (not partners)</p>
                      <ul className="mt-2 space-y-2">
                        {it.brands.map((b, j) => (
                          <li key={j} className="flex flex-wrap items-baseline justify-between gap-x-4">
                            <span>
                              <span className="font-semibold">{b.brand}</span> <span className="text-graphite">{b.product}</span>
                              {b.note && <span className="block text-sm text-graphite">{b.note}</span>}
                            </span>
                            {b.url && /^https?:\/\//.test(b.url) && (
                              <a href={b.url} target="_blank" rel="noopener noreferrer nofollow" className="link-quiet min-h-11 py-2 text-sm">
                                View product
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ol>
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
        </>
      )}
    </main>
  );
}
