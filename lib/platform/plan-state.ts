import "server-only";
import { settleStaleReads } from "./analyze";
import { reconcileOrders } from "./billing";
import { planDetail, type PlanView } from "./plan";

const log = (what: string) => (e: unknown) => console.error(`[plan] ${what}`, e);
const within = <T>(job: Promise<T>, ms: number) => Promise.race([job, new Promise<undefined>((r) => setTimeout(r, ms))]);

/**
 * The plan as screens show it. Reads that died are settled first, so they never
 * count. With `reconcile`, unpaid orders are checked with Razorpay too (briefly),
 * in case a webhook was missed.
 */
export async function currentPlan(userId: string, timezone: string | null | undefined, { reconcile = false } = {}): Promise<PlanView> {
  return (await currentPlanDetail(userId, timezone, { reconcile })).view;
}

/** currentPlan, with the moments behind its dates (planDetail), for the apps. */
export async function currentPlanDetail(userId: string, timezone: string | null | undefined, { reconcile = false } = {}) {
  await settleStaleReads(userId).catch(log("settling dead reads"));
  if (reconcile) await within(reconcileOrders(userId).catch(log("checking unpaid orders")), 4_000);
  return planDetail(userId, timezone);
}

export type PlanDetail = Awaited<ReturnType<typeof currentPlanDetail>>;
