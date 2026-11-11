import { apiUser } from "@/lib/auth/session";
import { reconcileOrders } from "@/lib/platform/billing";
import { json, unauthorized } from "@/lib/platform/http";
import { allowRequest } from "@/lib/waitlist/rate-limit";

// While a bank confirms a payment, the Pay button asks here every few seconds:
// it checks this person's unpaid orders with Razorpay and grants any that were paid.
export async function POST() {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!allowRequest(`sync:${user.id}`, 30, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  try {
    return json({ granted: await reconcileOrders(user.id) });
  } catch (error) {
    console.error("[billing] sync", error);
    return json({ granted: false });
  }
}
