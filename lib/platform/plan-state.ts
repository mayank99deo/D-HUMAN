import "server-only";
import { settleStaleReads } from "./analyze";
import { reconcileOrders } from "./billing";
import { planView, type PlanView } from "./plan";

const log = (what: string) => (e: unknown) => console.error(`[plan] ${what}`, e);
const within = <T>(job: Promise<T>, ms: number) => Promise.race([job, new Promise<undefined>((r) => setTimeout(r, ms))]);

/**
 * The plan as screens show it. Reads that died are settled first, so they never
 * count. With `reconcile`, unpaid orders are checked with Razorpay too (briefly),
 * in case a webhook was missed.
 */
export async function currentPlan(userId: string, timezone: string | null | undefined, { reconcile = false } = {}): Promise<PlanView> {
  await settleStaleReads(userId).catch(log("settling dead reads"));
  if (reconcile) await within(reconcileOrders(userId).catch(log("checking unpaid orders")), 4_000);
  return planView(userId, timezone);
}
