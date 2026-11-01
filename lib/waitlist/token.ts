import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// A signup gets a token that lets the same browser add its optional
// follow-up answers, without letting anyone edit another person's row.
// The key is derived from the webhook secret so there is one secret to manage.

function signingKey() {
  const secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!secret) throw new Error("GOOGLE_SHEETS_WEBHOOK_SECRET is not set");
  return createHmac("sha256", secret).update("d-human/waitlist-details/v1").digest();
}

export function signEmail(email: string) {
  return createHmac("sha256", signingKey()).update(email.toLowerCase()).digest("base64url");
}

export function verifyEmailToken(email: string, token: string) {
  const expected = Buffer.from(signEmail(email));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// For calls from the Apps Script itself. Hashing gives both sides the same
// length, which timingSafeEqual requires.
export function verifyWebhookSecret(value: string) {
  const secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!secret) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(value), digest(secret));
}
