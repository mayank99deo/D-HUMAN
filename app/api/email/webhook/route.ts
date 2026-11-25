import { carriesAppToken, refuseAppToken } from "@/lib/auth/app-token";
import { verifyWebhook, webhookHeaders } from "@/lib/email/client";
import { handleResendEvent } from "@/lib/email/suppress";
import { json } from "@/lib/platform/http";

export const maxDuration = 30;
const MAX_BYTES = 256 * 1024;

// Resend webhooks (set up in Resend → Webhooks, events email.delivered, email.bounced,
// email.complained, email.suppressed and email.failed, plus suppression.added and
// suppression.removed so our mirror follows Resend's list). email.delivered only feeds the
// founders' status page (/write/status); without it, a delivered email shows as "Sent". The signature is checked over the exact bytes Resend sent,
// before anything is parsed, with the SDK's own check. Every effect is an upsert or a
// guarded update, so Resend's retries and replays are harmless.
export async function POST(request: Request) {
  // Never for the apps (A6).
  if (carriesAppToken(request)) return refuseAppToken();
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json({ error: "not_configured" }, 503);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return json({ error: "too_large" }, 413);
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BYTES) return json({ error: "too_large" }, 413);

  const event = verifyWebhook(raw.toString("utf8"), webhookHeaders(request.headers), secret);
  if (!event) return json({ error: "bad_signature" }, 401);

  try {
    const result = await handleResendEvent(event);
    // The event type and Resend's message id only: never an address.
    if (result !== "ignored") console.info(`[email] webhook ${event.type} ${request.headers.get("svix-id") ?? ""}: ${result}`);
    return json({ ok: true });
  } catch (error) {
    console.error("[email] webhook", event.type, error instanceof Error ? error.message : error);
    // A 5xx makes Resend try again later.
    return json({ error: "failed" }, 500);
  }
}
