// Fitting a stack to a monthly budget. The stack's items arrive in priority order
// (lib/domain/supplements.ts: results outside the range first, then the edge of
// range, then the biggest food gaps). The budget decides two things:
//   1. which items make it: the most important first, each at its cheapest good
//      brand, until the budget is spent; the rest wait for "when your budget allows";
//   2. which brand each one gets: then, in the same order, each is upgraded to the
//      best brand the money left over allows (brands come best first).
// Pure, so the Stack screen re-fits instantly when the budget changes, and tests run it.

export const BUDGETS = [
  { id: "under_1000", label: "Under ₹1,000", cap: 1000 },
  { id: "1000_2000", label: "₹1,000–2,000", cap: 2000 },
  { id: "2000_3000", label: "₹2,000–3,000", cap: 3000 },
  { id: "3000_4000", label: "₹3,000–4,000", cap: 4000 },
  { id: "4000_5000", label: "₹4,000–5,000", cap: 5000 },
  { id: "5000_plus", label: "Above ₹5,000", cap: null },
  { id: "not_sure", label: "Not sure", cap: null },
] as const;

export type BudgetId = (typeof BUDGETS)[number]["id"];
export const BUDGET_IDS = BUDGETS.map((b) => b.id) as [BudgetId, ...BudgetId[]];
export const budgetOf = (id: string | null | undefined) => BUDGETS.find((b) => b.id === id) ?? null;

/**
 * Typical cost of a month at the stack's own dose, cheapest good brand to premium,
 * in rupees. Used only when the brand search found no price (older stacks, a failed
 * search, AI off), and always shown as "typical". Rough figures from Indian
 * pharmacies and marketplaces in 2026; brand prices from the search win whenever they exist.
 */
export const TYPICAL_MONTHLY_INR: Record<string, [number, number]> = {
  vitamin_d3: [150, 600],
  b12: [120, 500],
  iron: [150, 600],
  folate: [80, 400],
  magnesium: [500, 1500],
  omega3: [600, 2500],
  calcium: [250, 800],
  protein: [1800, 4000],
  zinc: [150, 600],
};

// Stacks built before 2026-11-13 don't carry their rule; the nutrient name (kept in
// English even in translated stacks) says which one it is.
const RULE_BY_NAME: [RegExp, string][] = [
  [/vitamin d/i, "vitamin_d3"],
  [/b12/i, "b12"],
  [/^iron/i, "iron"],
  [/folate|folic/i, "folate"],
  [/magnesium/i, "magnesium"],
  [/omega/i, "omega3"],
  [/calcium/i, "calcium"],
  [/protein/i, "protein"],
  [/zinc/i, "zinc"],
];
export const ruleOf = (item: { rule?: string | null; nutrient?: string }) => item.rule ?? RULE_BY_NAME.find(([re]) => re.test(item.nutrient ?? ""))?.[1] ?? null;
export const typicalFor = (item: { rule?: string | null; nutrient?: string }) => TYPICAL_MONTHLY_INR[ruleOf(item) ?? ""] ?? null;

/** A month of a brand at the stack's dose, from its pack price and how long a pack lasts. */
export function monthlyInr(priceInr: unknown, days: unknown): number | null {
  if (typeof priceInr !== "number" || typeof days !== "number") return null;
  if (!Number.isFinite(priceInr) || !Number.isFinite(days) || priceInr < 20 || priceInr > 50_000 || days < 5 || days > 400) return null;
  const monthly = Math.round((priceInr * 30) / days);
  return monthly >= 10 && monthly <= 20_000 ? monthly : null;
}

export type PricedItem = { rule?: string | null; nutrient?: string; brands: { monthly_inr?: number | null }[] };

export type Fit = {
  /** Item indexes that fit, in priority order. */
  included: number[];
  /** Item indexes that don't fit this budget, in priority order. */
  later: number[];
  /** The brand picked for each item (index into its brands), or null when none has a price. */
  pick: (number | null)[];
  /** Monthly rupees for each item: the picked brand's, else the typical low end; null when unknown. */
  cost: (number | null)[];
  /** The cost came from the typical table, not a brand. */
  typical: boolean[];
  /** Sum of the included items' costs. */
  total: number;
  /** The budget's top, or null for "Above ₹5,000", "Not sure" and no budget yet. */
  cap: number | null;
};

const priced = (item: PricedItem) =>
  item.brands.map((b, j) => ({ j, m: typeof b.monthly_inr === "number" && b.monthly_inr > 0 ? b.monthly_inr : null })).filter((o): o is { j: number; m: number } => o.m != null);

export function fitBudget(items: PricedItem[], budget: string | null | undefined): Fit {
  const cap = budgetOf(budget)?.cap ?? null;
  const limit = cap ?? Infinity;
  const n = items.length;
  const pick: (number | null)[] = Array(n).fill(null);
  const cost: (number | null)[] = Array(n).fill(null);
  const typical: boolean[] = Array(n).fill(false);
  const included: number[] = [];
  const later: number[] = [];
  let total = 0;

  // 1. The most important first, each at its cheapest brand.
  items.forEach((item, i) => {
    const options = priced(item);
    const cheapest = options.length ? options.reduce((a, b) => (b.m < a.m ? b : a)) : null;
    const fallback = cheapest ? null : (typicalFor(item)?.[0] ?? null);
    const c = cheapest?.m ?? fallback ?? 0;
    if (total + c > limit) return void later.push(i);
    included.push(i);
    pick[i] = cheapest?.j ?? null;
    cost[i] = cheapest?.m ?? fallback;
    typical[i] = !cheapest && fallback != null;
    total += c;
  });

  // 2. In the same order, the best brand the money left allows (brands come best first).
  for (const i of included) {
    const options = priced(items[i]).sort((a, b) => a.j - b.j);
    const current = cost[i] ?? 0;
    const better = options.find((o) => o.j < (pick[i] ?? Infinity) && total - current + o.m <= limit);
    if (better) {
      total += better.m - current;
      pick[i] = better.j;
      cost[i] = better.m;
    }
  }

  return { included, later, pick, cost, typical, total, cap };
}

/** "₹1,240" */
export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
