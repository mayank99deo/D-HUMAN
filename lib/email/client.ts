import "server-only";
import { Resend, type WebhookEventPayload } from "resend";
import { KIND_CATEGORY, type EmailKind } from "./types";

// The one place lifecycle email meets Resend: the client, the From and Reply-To addresses,
// and the webhook check. Sign-in codes keep their own sender (lib/auth/email.ts) and never
// pass through here, so nothing in lifecycle email can hold them up.

let client: Resend | null = null;

/**
 * Lifecycle email and the founders' alert go only from production: VERCEL_ENV=production
 * on Vercel, or a local run with EMAIL_SEND_LOCAL=1 (to try the pipeline; without a
 * RESEND_API_KEY it then logs instead of sending). Preview deployments and ordinary local
 * runs send nothing, even with a key and a real database.
 */
export function sendingAllowed(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  return !process.env.VERCEL && process.env.EMAIL_SEND_LOCAL === "1";
}

/** For the log line when sending is held back: where we are, never who it was for. */
export const whereRunning = () => (process.env.VERCEL ? `VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}` : "local run without EMAIL_SEND_LOCAL=1");

/**
 * "live": RESEND_API_KEY is set. "log": local dev without a key; sends are logged (kind and
 * send id only) and recorded as sent, as sign-in codes are logged. "off": production
 * without a key; nothing is claimed or sent.
 */
export function emailMode(): "live" | "log" | "off" {
  if (process.env.RESEND_API_KEY) return "live";
  return process.env.NODE_ENV === "production" ? "off" : "log";
}

export function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client ??= new Resend(key);
  return client;
}

/** dhuman.fit is verified in Resend, so any address on it can send. */
export const fromAddress = () => process.env.RESEND_FROM || "D-Human <hello@dhuman.fit>";

/** Where replies go; undefined means replies reach no one, so templates shouldn't invite them. */
export function replyToFor(kind: EmailKind): string | undefined {
  const feedback = KIND_CATEGORY[kind] === "questions" ? process.env.FEEDBACK_REPLY_TO : undefined;
  return feedback || process.env.RESEND_REPLY_TO || undefined;
}

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null };

/** Resend signs webhooks the Standard Webhooks way (svix-* headers); some proxies use webhook-*. */
export function webhookHeaders(headers: Headers): WebhookHeaders {
  return {
    id: headers.get("svix-id") ?? headers.get("webhook-id"),
    timestamp: headers.get("svix-timestamp") ?? headers.get("webhook-timestamp"),
    signature: headers.get("svix-signature") ?? headers.get("webhook-signature"),
  };
}

/**
 * The event, if `payload` (the exact body Resend sent) carries a valid signature from the
 * last 5 minutes for RESEND_WEBHOOK_SECRET; otherwise null. Uses the SDK's own check.
 */
export function verifyWebhook(payload: string, headers: WebhookHeaders, secret: string): WebhookEventPayload | null {
  if (!headers.id || !headers.timestamp || !headers.signature) return null;
  try {
    // verify() never calls the API, so a placeholder key is fine when none is set locally.
    const sdk = resend() ?? new Resend("re_verify_only");
    const event = sdk.webhooks.verify({
      payload,
      headers: { id: headers.id, timestamp: headers.timestamp, signature: headers.signature },
      webhookSecret: secret,
    });
    return event && typeof event === "object" ? event : null;
  } catch {
    return null;
  }
}
