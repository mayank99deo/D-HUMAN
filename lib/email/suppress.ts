import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { WebhookEventPayload } from "resend";
import { db, schema } from "@/lib/db";
import { setPrefs } from "./prefs";
import type { SendStatus, SuppressionReason } from "./types";

// Hard bounces and spam reports. Resend suppresses such an address for all mail from the
// account, sign-in codes included; we keep a mirror (hashed, so it can't be read back as
// an address) to skip lifecycle email and to tell the person at sign-in. The mirror
// outlives account deletion, to keep honouring "don't email me".

const suppressions = schema.emailSuppressions;
const sends = schema.emailSends;

/** SHA-256 of the lowercase address, as SQL computes it: encode(sha256(convert_to(lower(email), 'UTF8')), 'hex'). */
export const emailHash = (email: string) => createHash("sha256").update(email.toLowerCase(), "utf8").digest("hex");

/** What the sign-in screen says when an address is on the list (architecture spec §3.10). */
export const SUPPRESSED_MESSAGE =
  "Emails to this address bounced or were marked as spam, so your code may not arrive. Write to hello@dhuman.fit and we'll sort it out.";

export async function isSuppressed(email: string): Promise<boolean> {
  const d = await db();
  const [row] = await d.select({ h: suppressions.emailHash }).from(suppressions).where(eq(suppressions.emailHash, emailHash(email))).limit(1);
  return Boolean(row);
}

export async function suppress(email: string, reason: SuppressionReason): Promise<void> {
  const d = await db();
  // A spam report outranks a bounce in what it tells us, so it replaces one; nothing else changes the first reason.
  await d
    .insert(suppressions)
    .values({ emailHash: emailHash(email), reason })
    .onConflictDoUpdate({
      target: suppressions.emailHash,
      set: { reason: sql`case when excluded.reason = 'complaint' then 'complaint' else ${suppressions.reason} end` },
    });
}

/** When the address is taken off Resend's list (Mayank does that in Resend's dashboard). */
export async function unsuppress(email: string): Promise<void> {
  const d = await db();
  await d.delete(suppressions).where(eq(suppressions.emailHash, emailHash(email)));
}

// ── Resend webhook events ───────────────────────────────────────────────────

/** "Name <a@b.c>" or "a@b.c" → "a@b.c". */
function address(value: string | undefined): string | null {
  if (!value) return null;
  const inside = /<([^>]+)>/.exec(value)?.[1] ?? value;
  const trimmed = inside.trim();
  return trimmed.includes("@") ? trimmed : null;
}

// A later event never undoes a stronger one: a "failed" that arrives late can't hide a spam report.
const OVERWRITABLE: Record<"bounced" | "complained" | "suppressed" | "failed", SendStatus[]> = {
  complained: ["sending", "sent", "failed", "unknown", "bounced", "suppressed"],
  bounced: ["sending", "sent", "failed", "unknown", "suppressed"],
  suppressed: ["sending", "sent", "failed", "unknown"],
  failed: ["sending", "sent", "unknown"],
};

/**
 * Finds our send for a Resend email: by Resend's id, or by the send_id tag (set on every
 * lifecycle email) when the id was never recorded. Sign-in codes have neither.
 */
async function markSend(providerId: string, tagSendId: string | undefined, status: keyof typeof OVERWRITABLE, error?: string) {
  const d = await db();
  const allowed = OVERWRITABLE[status];
  const set = { status, ...(error ? { error } : {}) };
  const [byProvider] = await d
    .update(sends)
    .set(set)
    .where(and(eq(sends.providerId, providerId), inArray(sends.status, allowed)))
    .returning({ userId: sends.userId });
  if (byProvider) return byProvider.userId;
  if (!tagSendId) {
    const [known] = await d.select({ userId: sends.userId }).from(sends).where(eq(sends.providerId, providerId)).limit(1);
    return known?.userId ?? null;
  }
  // Recorded under its tag only (a crash between Resend's answer and our write): adopt Resend's id too.
  const [byTag] = await d
    .update(sends)
    .set({ ...set, providerId: sql`coalesce(${sends.providerId}, ${providerId})` })
    .where(and(eq(sends.id, tagSendId), inArray(sends.status, allowed)))
    .returning({ userId: sends.userId });
  if (byTag) return byTag.userId;
  const [known] = await d.select({ userId: sends.userId }).from(sends).where(eq(sends.id, tagSendId)).limit(1);
  return known?.userId ?? null;
}

async function userIdByEmail(email: string): Promise<string | null> {
  const d = await db();
  const [row] = await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email.toLowerCase())).limit(1);
  return row?.id ?? null;
}

export type WebhookResult = "bounced" | "bounced_soft" | "complained" | "suppressed" | "failed" | "suppression_added" | "suppression_removed" | "ignored";

/**
 * Applies one verified Resend event. Every write is an upsert or a guarded update, so
 * Resend's retries and replays (same svix-id) change nothing the second time. Throws only
 * on a database error, so the route answers 500 and Resend tries again.
 */
export async function handleResendEvent(event: WebhookEventPayload): Promise<WebhookResult> {
  switch (event.type) {
    case "email.bounced": {
      const to = address(event.data.to?.[0]);
      // Only a "Permanent" bounce is a hard bounce, the kind Resend suppresses. A full
      // mailbox ("Transient") or an "Undetermined" one marks the send but not the address,
      // so the mirror never holds an address Resend still mails. Anything else Resend
      // suppresses arrives as suppression.added.
      const permanent = String(event.data.bounce?.type ?? "").toLowerCase() === "permanent";
      await Promise.all([
        markSend(event.data.email_id, event.data.tags?.send_id, "bounced", `bounce:${event.data.bounce?.type ?? "unknown"}`.slice(0, 200)),
        permanent && to ? suppress(to, "bounce") : null,
      ]);
      return permanent ? "bounced" : "bounced_soft";
    }
    case "email.complained": {
      const to = address(event.data.to?.[0]);
      const [userId] = await Promise.all([markSend(event.data.email_id, event.data.tags?.send_id, "complained"), to ? suppress(to, "complaint") : null]);
      // A spam report turns off every email someone could stop, whatever they had chosen.
      const person = userId ?? (to ? await userIdByEmail(to) : null);
      if (person) await setPrefs(person, { weekly: false, questions: false }, "complaint");
      return "complained";
    }
    case "email.suppressed": {
      const to = address(event.data.to?.[0]);
      await Promise.all([markSend(event.data.email_id, event.data.tags?.send_id, "suppressed"), to ? suppress(to, "resend") : null]);
      return "suppressed";
    }
    case "email.failed": {
      await markSend(event.data.email_id, event.data.tags?.send_id, "failed", `resend:${event.data.failed?.reason ?? "failed"}`.slice(0, 200));
      return "failed";
    }
    // Resend's own list changing (subscribe to these too, so the mirror follows the dashboard).
    case "suppression.added": {
      const to = address(event.data.email);
      if (to) await suppress(to, event.data.origin === "bounce" ? "bounce" : event.data.origin === "complaint" ? "complaint" : "resend");
      return "suppression_added";
    }
    case "suppression.removed": {
      const to = address(event.data.email);
      if (to) await unsuppress(to);
      return "suppression_removed";
    }
    default:
      return "ignored";
  }
}
