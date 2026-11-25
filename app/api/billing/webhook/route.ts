import { webhookSecret } from "@/lib/billing/razorpay";
import { webhookSignatureOk } from "@/lib/billing/signature";
import { handleWebhook } from "@/lib/platform/billing";
import { json } from "@/lib/platform/http";

export const maxDuration = 30;
const MAX_BYTES = 256 * 1024;

// Razorpay webhooks (set up in the Razorpay Dashboard with the events payment.captured,
// payment.authorized and order.paid). The signature is checked over the raw body,
// before anything is parsed. Razorpay retries anything but a quick 2xx for 24 hours,
// and may send an event more than once or out of order; settling is idempotent.
export async function POST(request: Request) {
  const secret = webhookSecret();
  if (!secret) return json({ error: "not_configured" }, 503);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return json({ error: "too_large" }, 413);
  // The exact bytes Razorpay signed, never a re-encoded copy.
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BYTES) return json({ error: "too_large" }, 413);
  if (!webhookSignatureOk(raw, request.headers.get("x-razorpay-signature") ?? "", secret)) return json({ error: "bad_signature" }, 401);

  let event: Parameters<typeof handleWebhook>[0];
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return json({ error: "invalid" }, 400);
  }
  try {
    const result = await handleWebhook(event);
    if (result !== "ignored") console.info(`[billing] webhook ${event.event} ${request.headers.get("x-razorpay-event-id") ?? ""}: ${result}`);
    // Authorised but not captured (a capture failed): ask Razorpay to send it again rather than drop the payment.
    if (result === "pending") return json({ error: "pending" }, 503);
    return json({ ok: true });
  } catch (error) {
    console.error("[billing] webhook", event.event, error);
    // A 5xx makes Razorpay retry later.
    return json({ error: "failed" }, 500);
  }
}
