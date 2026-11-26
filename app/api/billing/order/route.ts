import { notForApp } from "@/lib/auth/authenticate";
import { apiUser } from "@/lib/auth/session";
import { RazorpayError } from "@/lib/billing/razorpay";
import { startPass } from "@/lib/platform/billing";
import { json, unauthorized } from "@/lib/platform/http";
import { allowRequest } from "@/lib/waitlist/rate-limit";

// Starts a ₹49 pass: creates a Razorpay order and returns what Checkout needs.
export async function POST(request: Request) {
  const refused = await notForApp(request); // not open to the apps yet: 403 not_for_app
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!allowRequest(`order:${user.id}`, 10, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  try {
    const r = await startPass(user);
    if (!r.ok) return json({ error: r.reason }, r.reason === "payments_off" ? 503 : 409);
    return json(r.checkout);
  } catch (error) {
    console.error("[billing] order", error instanceof RazorpayError ? `${error.status} ${error.message}` : error);
    return json({ error: "failed" }, 502);
  }
}
