// Razorpay signatures, both HMAC-SHA256 as hex:
// - Checkout success: the order id from our own database, "|", the payment id, keyed with the API key secret.
// - Webhooks: the raw request body exactly as received, keyed with the webhook secret.
import { createHmac, timingSafeEqual } from "node:crypto";

export const hmacHex = (secret: string, message: string | Uint8Array) =>
  (typeof message === "string" ? createHmac("sha256", secret).update(message, "utf8") : createHmac("sha256", secret).update(message)).digest("hex");

function sameHex(expected: string, given: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(given.toLowerCase(), "utf8"));
}

export const checkoutSignatureOk = (orderId: string, paymentId: string, signature: string, keySecret: string) =>
  !!orderId && !!paymentId && !!keySecret && sameHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);

export const webhookSignatureOk = (rawBody: string | Uint8Array, signature: string, webhookSecret: string) =>
  !!webhookSecret && sameHex(hmacHex(webhookSecret, rawBody), signature);
