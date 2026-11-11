// What a person may use, free or with a pass. Pure rules, so they can be tested
// without a database; lib/platform/plan.ts counts the uses and applies them.
//
// Free: 2 report reads and 20 meal logs in total, per account.
// A pass: ₹49, one payment through Razorpay, never renews. It covers 30 days with
// 3 report reads in those days. Everyone gets at most 5 meal logs a day.

export const PLAN = {
  pricePaise: 4900,
  currency: "INR",
  days: 30,
  freeReads: 2,
  freeMeals: 20,
  passReads: 3,
  mealsPerDay: 5,
  /** A new pass can be bought this close to the end of the current one; it starts when that ends. */
  renewWithinDays: 3,
} as const;

export const PRICE_TEXT = `₹${PLAN.pricePaise / 100}`;

export type UseKind = "read" | "meal";
export type Refusal = "free_reads_used" | "pass_reads_used" | "free_meals_used" | "meals_today_used";
export type Pass = { startsAt: Date; endsAt: Date };
export type Counts = { readsTotal: number; readsInPass: number; mealsTotal: number; mealsToday: number };

const DAY_MS = 24 * 60 * 60_000;

/** Why one more use of this kind isn't allowed, or null when it is. */
export function refusalFor(kind: UseKind, pass: Pass | null, c: Counts): Refusal | null {
  if (kind === "read") {
    if (pass) return c.readsInPass >= PLAN.passReads ? "pass_reads_used" : null;
    return c.readsTotal >= PLAN.freeReads ? "free_reads_used" : null;
  }
  // Out of free logs comes first: waiting for tomorrow wouldn't help.
  if (!pass && c.mealsTotal >= PLAN.freeMeals) return "free_meals_used";
  if (c.mealsToday >= PLAN.mealsPerDay) return "meals_today_used";
  return null;
}

/** No pass, or one that ends within a few days. */
export function canBuy(pass: { endsAt: Date } | null, now = new Date()): boolean {
  return !pass || pass.endsAt.getTime() - now.getTime() <= PLAN.renewWithinDays * DAY_MS;
}

/** A new pass starts now, or when the latest paid one ends if that's later. */
export function passWindow(latestEnd: Date | null, now = new Date()): Pass {
  const startsAt = latestEnd && latestEnd > now ? latestEnd : now;
  return { startsAt, endsAt: new Date(startsAt.getTime() + PLAN.days * DAY_MS) };
}

/** What a pass gives, without the price. */
export const PASS_DETAIL = `${PLAN.passReads} report reads and up to ${PLAN.mealsPerDay} meal logs a day. One payment; it doesn't renew.`;
export const PASS_TEXT = `${PRICE_TEXT} for ${PLAN.days} days: ${PASS_DETAIL}`;

/** What screens get to know about a person's plan; dates are already formatted in their time zone. */
export type PlanView = {
  pass: { until: string } | null;
  /** A pass bought ahead, starting when the current one ends. */
  queuedUntil: string | null;
  reads: { used: number; limit: number; free: boolean };
  meals: { today: number; perDay: number; used: number; freeLimit: number | null };
  readBlock: Refusal | null;
  mealBlock: Refusal | null;
  canBuy: boolean;
  paymentsOn: boolean;
};

/** Server words for a refusal; screens add the dates. */
export const REFUSAL_MESSAGES: Record<Refusal, string> = {
  free_reads_used: `You've used your ${PLAN.freeReads} free report reads. ${PASS_TEXT}`,
  pass_reads_used: `You've used the ${PLAN.passReads} report reads in your pass. More open with your next pass.`,
  free_meals_used: `You've used your ${PLAN.freeMeals} free meal logs. ${PASS_TEXT}`,
  meals_today_used: `That's ${PLAN.mealsPerDay} meal logs today, the most for one day. Log more tomorrow.`,
};
