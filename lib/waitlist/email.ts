import "server-only";
import { Resend } from "resend";
import { siteUrl } from "@/lib/site-url";
import { welcomeEmail } from "./welcome-email";

let client: Resend | null = null;

function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client ??= new Resend(key);
  return client;
}

export async function sendWelcomeEmail(email: string) {
  const r = resend();
  if (!r) {
    console.warn("[waitlist] RESEND_API_KEY is not set; skipped the welcome email");
    return;
  }
  const site = siteUrl();
  const { html, text } = welcomeEmail({
    email,
    // Email clients only load images over https.
    siteUrl: site?.startsWith("https://") ? site : undefined,
    canReply: Boolean(process.env.RESEND_REPLY_TO),
  });
  const { error } = await r.emails.send(
    {
      // dhuman.fit is verified in Resend, so any address on it can send.
      from: process.env.RESEND_FROM || "D-Human <hello@dhuman.fit>",
      to: email,
      replyTo: process.env.RESEND_REPLY_TO || undefined,
      subject: "You're on the D-Human waitlist",
      html,
      text,
    },
    { idempotencyKey: `welcome/${email}` },
  );
  if (error) console.error("[waitlist] Welcome email failed:", error.name, error.message);
}

// Adds the signup to Resend Contacts (and a segment, if configured) so launch
// news can go out from Resend's Broadcasts screen with unsubscribe handled.
export async function saveContact(email: string) {
  const r = resend();
  if (!r) return;
  const segmentId = process.env.RESEND_SEGMENT_ID;
  const { error } = await r.contacts.create({
    email,
    unsubscribed: false,
    ...(segmentId ? { segments: [{ id: segmentId }] } : {}),
  });
  if (error) console.error("[waitlist] Saving Resend contact failed:", error.name, error.message);
}

export async function updateContactName(email: string, firstName: string) {
  const r = resend();
  if (!r) return;
  const { error } = await r.contacts.update({ email, firstName });
  if (error) console.error("[waitlist] Updating Resend contact failed:", error.name, error.message);
}
