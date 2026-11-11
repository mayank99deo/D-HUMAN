import { z } from "zod";
import { apiUser } from "@/lib/auth/session";
import { RazorpayError } from "@/lib/billing/razorpay";
import { confirmCheckout } from "@/lib/platform/billing";
import { json, unauthorized } from "@/lib/platform/http";
import { allowRequest } from "@/lib/waitlist/rate-limit";

const body = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(128),
});

// Checkout's success callback lands here. The pass is granted only once the
// signature matches the order we stored and Razorpay's own record shows the payment captured.
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!allowRequest(`verify:${user.id}`, 20, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  const p = parsed.data;
  try {
    const r = await confirmCheckout(user.id, { orderId: p.razorpay_order_id, paymentId: p.razorpay_payment_id, signature: p.razorpay_signature });
    if (r === "granted" || r === "already") return json({ ok: true });
    if (r === "pending") return json({ pending: true }, 202);
    console.warn(`[billing] verify refused for ${user.id}: ${r}`);
    return json({ error: "invalid" }, 400);
  } catch (error) {
    console.error("[billing] verify", error instanceof RazorpayError ? `${error.status} ${error.message}` : error);
    // The webhook will still settle a real payment; tell the person to wait rather than pay again.
    return json({ pending: true }, 202);
  }
}
