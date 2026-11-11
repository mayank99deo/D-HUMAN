"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { PASS_DETAIL, PASS_TEXT, PLAN, PRICE_TEXT, type PlanView, type Refusal } from "@/lib/domain/plan";
import { buyPass } from "./checkout";
import { send } from "./net";

/** Pays for a pass, then refreshes the page so it shows the new plan. */
export function PayButton({ label = `Pay ${PRICE_TEXT}` }: { label?: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [waiting, setWaiting] = useState(false);

  // While the bank confirms, ask Razorpay again every few seconds, for about a minute.
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      if (n >= 12) clearInterval(t);
      const r = await send<{ granted: boolean }>("/api/billing/sync");
      if (r.data.granted || n >= 12) clearInterval(t);
      startTransition(() => router.refresh());
    }, 5000);
    return () => clearInterval(t);
  }, [waiting, router]);

  async function pay() {
    setBusy(true);
    setNote(null);
    const r = await buyPass();
    setBusy(false);
    if (r.state === "paid") {
      setNote({ text: "Paid. Your pass is ready." });
      startTransition(() => router.refresh());
    } else if (r.state === "pending") {
      setNote({ text: "Your bank is still confirming the payment. This page updates when it's done, so don't pay again." });
      setWaiting(true);
    } else if (r.state === "error") {
      setNote({ text: r.message, error: true });
    }
  }

  return (
    <div>
      <button type="button" onClick={pay} disabled={busy || waiting} className="button-primary h-13 w-full sm:w-auto sm:px-10">
        {busy ? "Opening payment…" : label}
      </button>
      {note && (
        <p role={note.error ? "alert" : "status"} className={`mt-3 text-sm ${note.error ? "error-mark" : ""}`}>
          {note.text}
        </p>
      )}
      <p className="mt-3 text-xs text-graphite">Payments by Razorpay: UPI, cards, net banking and wallets.</p>
    </div>
  );
}

const TITLES: Record<Refusal, string> = {
  free_reads_used: `Your ${PLAN.freeReads} free report reads are used.`,
  pass_reads_used: `That's the ${PLAN.passReads} report reads in your pass.`,
  free_meals_used: `Your ${PLAN.freeMeals} free meal logs are used.`,
  meals_today_used: `That's ${PLAN.mealsPerDay} meal logs today.`,
};

/** Shown in place of the upload or logging controls when the plan doesn't allow one more. */
export function Paywall({ plan, refusal }: { plan: PlanView; refusal: Refusal }) {
  const until = plan.pass?.until;
  let body: string;
  let offer = false;
  if (refusal === "meals_today_used") {
    body = `${PLAN.mealsPerDay} a day is the most for now. Log more tomorrow.`;
  } else if (refusal === "pass_reads_used") {
    if (plan.queuedUntil) body = `Your next pass starts when this one ends, on ${until}, with ${PLAN.passReads} more reads.`;
    else if (plan.canBuy) {
      body = `Your pass ends on ${until}. A new one starts the day it ends, with ${PLAN.passReads} more reads.`;
      offer = true;
    } else body = `Your pass runs until ${until}. You can buy the next one in its last ${PLAN.renewWithinDays} days.`;
  } else {
    // The price sits above in large type; the words say what it buys.
    offer = plan.canBuy;
    body = offer ? PASS_DETAIL : PASS_TEXT;
  }

  return (
    <section className="mt-8 border border-line-strong p-5 sm:p-6" aria-labelledby="paywall">
      <h2 id="paywall" className="text-xl font-bold semiwide">
        {TITLES[refusal]}
      </h2>
      {offer && (
        <p className="mt-4 flex items-baseline gap-3">
          <span className="display-num text-5xl">{PRICE_TEXT}</span>
          <span className="text-graphite">for {PLAN.days} days</span>
        </p>
      )}
      <p className="mt-3 max-w-prose text-graphite">{body}</p>
      {offer && <div className="mt-6">{plan.paymentsOn ? <PayButton /> : <p className="text-sm">Payments open soon.</p>}</div>}
    </section>
  );
}

/** One line on what's left, for the top of Upload and Fuel. The paywall speaks for itself when shown. */
export function PlanLine({ plan, kind }: { plan: PlanView; kind: "read" | "meal" }) {
  if (kind === "read" ? plan.readBlock : plan.mealBlock) return null;
  let text: string;
  if (kind === "read") {
    const left = Math.max(0, plan.reads.limit - plan.reads.used);
    text = plan.reads.free
      ? `${left} of ${plan.reads.limit} free report reads left.`
      : `${left} of ${plan.reads.limit} report reads left in your pass, which runs until ${plan.pass?.until}.`;
  } else {
    const today = Math.max(0, plan.meals.perDay - plan.meals.today);
    text = `${today} of ${plan.meals.perDay} meal logs left today.`;
    if (plan.meals.freeLimit != null) text += ` ${Math.max(0, plan.meals.freeLimit - plan.meals.used)} of your ${plan.meals.freeLimit} free logs left.`;
  }
  return <p className="mt-3 text-sm text-graphite">{text}</p>;
}

export type PaidPass = { id: string; paidOn: string; amount: string; from: string; until: string; ref: string };

/** "Your plan" in Settings: what's left, buying a pass, and past payments. */
export function PlanCard({ plan, passes }: { plan: PlanView; passes: PaidPass[] }) {
  const readsLeft = Math.max(0, plan.reads.limit - plan.reads.used);
  const mealsToday = Math.max(0, plan.meals.perDay - plan.meals.today);
  return (
    <section className="mt-10 border border-line-strong p-5 sm:p-6" aria-labelledby="plan">
      <h2 id="plan" className="text-xl font-bold semiwide">
        {plan.pass ? `Pass until ${plan.pass.until}` : "Free plan"}
      </h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-graphite">Report reads</dt>
          <dd className="mt-1 font-semibold">
            {readsLeft} of {plan.reads.limit} left{plan.reads.free ? "" : " in this pass"}
          </dd>
        </div>
        <div>
          <dt className="text-graphite">Meal logs</dt>
          <dd className="mt-1 font-semibold">
            {mealsToday} of {plan.meals.perDay} left today
            {plan.meals.freeLimit != null && `, ${Math.max(0, plan.meals.freeLimit - plan.meals.used)} of ${plan.meals.freeLimit} free left`}
          </dd>
        </div>
      </dl>
      {plan.queuedUntil && <p className="mt-4 text-sm text-graphite">Your next pass is paid and runs until {plan.queuedUntil}.</p>}
      {plan.canBuy && (
        <div className="mt-6">
          <p className="mb-4 max-w-prose text-graphite">{plan.pass ? `Your pass ends soon. A new one starts the day it ends. ${PASS_TEXT}` : PASS_TEXT}</p>
          {plan.paymentsOn ? <PayButton label={plan.pass ? `Buy the next 30 days for ${PRICE_TEXT}` : `Pay ${PRICE_TEXT}`} /> : <p className="text-sm">Payments open soon.</p>}
        </div>
      )}
      {passes.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="text-sm text-graphite">Payments</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {passes.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-x-4">
                <span>
                  {p.amount} on {p.paidOn}, for {p.from} to {p.until}
                </span>
                <span className="break-all text-graphite">{p.ref}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
