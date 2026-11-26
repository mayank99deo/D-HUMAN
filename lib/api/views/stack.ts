import "server-only";
import type { StackPlan } from "@/lib/ai/schemas";
import { BUDGET_IDS, fitBudget, type BudgetId, type Fit } from "@/lib/domain/budget";
import type { StackView } from "@/lib/platform/views/stack";

// The apps' Stack (lib/api/schemas.ts StackResponse), shaped from the web page's own view
// (lib/platform/views/stack.ts). What the web's Stack screen works out in the browser, the
// apps get from here (the mobile repo's docs/API.md §3.3): a fit for every budget slab, the gap
// notes split into a lead and the rest, and the hold's words (gap G13). The web's own client
// code is never touched; tests/app-stack.test.ts checks these words against it.

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The hold's line, word for word as the web's Stack screen writes it (components/platform/Stack.tsx). */
export function holdLine(hold: "urgent" | "pregnant", urgentNames: string[]): string {
  return hold === "urgent" && urgentNames.length
    ? `${list(urgentNames)} ${urgentNames.length > 1 ? "need" : "needs"} medical advice today, so we've held your stack until a doctor has seen ${urgentNames.length > 1 ? "them" : "it"}.`
    : "You're pregnant or breastfeeding, so we've held your stack: take nothing new without your doctor.";
}

/** As splitNote in components/platform/stack-state.ts: a long note's first sentence, and the rest. */
const NOTE_SHORT = 140;
export function splitNote(note: string): [string, string | null] {
  if (note.length <= NOTE_SHORT) return [note, null];
  const m = note.match(/^([\s\S]{20,}?[.!?।])\s+(\S[\s\S]*)$/u);
  return m ? [m[1], m[2]] : [note, null];
}

function planJson(plan: StackPlan) {
  return {
    items: plan.items.map((i) => ({
      nutrient: i.nutrient,
      dose: i.dose,
      why: i.why ?? null,
      markers: i.markers ?? [],
      dietGap: i.diet_gap ?? null,
      form: i.form ?? null,
      timing: i.timing ?? null,
      duration: i.duration ?? null,
      cautions: i.cautions ?? null,
      rule: i.rule ?? null,
      brands: (i.brands ?? []).map((b) => ({
        brand: b.brand,
        product: b.product ?? null,
        url: b.url ?? null,
        note: b.note ?? null,
        priceInr: b.price_inr ?? null,
        pack: b.pack ?? null,
        monthlyInr: b.monthly_inr ?? null,
      })),
    })),
    skip: (plan.skip ?? []).map((s) => ({ name: s.name, why: s.why ?? null })),
    foodFirst: plan.food_first ?? [],
    seeDoctor: plan.see_doctor ?? [],
    gaps: (plan.gaps ?? []).map((g) => {
      const [lead, more] = splitNote(g.note);
      return { key: g.key, label: g.label, pct: g.pct, iu: g.iu ?? null, outcome: g.outcome, note: g.note, lead, more, rule: g.rule };
    }),
    gapsBasis: plan.gaps_basis ?? null,
  };
}

/**
 * GET /api/stack. No plan and no fits, so no dose reaches the phone, when the stack is held or out
 * of date (QA test 32), when the doses switch is off (dosesOff), and when the person hasn't
 * answered the health question yet (healthCheckNeeded: a stack built on the web before the app
 * asked it). The web's own Stack screen is unchanged.
 */
export function stackJson(v: StackView, o: { dosesOff: boolean; healthCheckNeeded: boolean } = { dosesOff: false, healthCheckNeeded: false }) {
  if (v.state === "start_with_food") return v;
  const plan = v.stack?.status === "ready" ? v.stack.plan : null;
  const shown = plan && !v.hold && !v.staleReason && !o.dosesOff && !o.healthCheckNeeded ? plan : null;
  const fits = shown ? (Object.fromEntries(BUDGET_IDS.map((id) => [id, fitBudget(shown.items, id)])) as Record<BudgetId, Fit>) : null;
  return {
    state: v.state,
    stack: v.stack ? { id: v.stack.id, status: v.stack.status, error: v.stack.error, plan: shown ? planJson(shown) : null, demo: v.stack.demo, made: v.stack.made } : null,
    staleReason: v.staleReason,
    basis: v.basis,
    hasReport: v.hasReport,
    body: v.body,
    markerNames: v.markerNames,
    budget: v.budget,
    fits,
    flagged: v.flagged,
    hold: v.hold,
    holdLine: v.hold ? holdLine(v.hold, v.flagged.filter((f) => f.urgent).map((f) => f.name)) : null,
    dosesOff: o.dosesOff,
    healthCheckNeeded: o.healthCheckNeeded,
    aiOff: v.aiOff,
  };
}
