import "server-only";
import { Resend } from "resend";

let client: Resend | null = null;

function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client ??= new Resend(key);
  return client;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STEPS = [
  ["Test", "Blood, urine, gut and more. Most of it from home."],
  ["Read", "A doctor-reviewed report in plain words."],
  ["Stack", "Supplements matched to your markers, from clean-label brands."],
  ["Retest", "Key markers again at 3–4 months, to show what moved."],
] as const;

function welcomeEmail(email: string) {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const canReply = Boolean(process.env.RESEND_REPLY_TO);
  const logo = site?.startsWith("https://")
    ? `<img src="${site}/brand/wordmark-black.png" width="180" height="16" alt="D-Human" style="display:block;border:0;height:16px;width:180px">`
    : `<span style="font:700 18px/1 Arial,Helvetica,sans-serif;letter-spacing:6px;color:#000">D-HUMAN</span>`;

  const steps = STEPS.map(
    ([title, body], i) => `
      <tr>
        <td valign="top" style="padding:0 16px 16px 0;font:700 14px/20px Arial,Helvetica,sans-serif;color:#000;width:20px">${i + 1}</td>
        <td valign="top" style="padding:0 0 16px;font:15px/22px Arial,Helvetica,sans-serif;color:#000"><strong>${title}.</strong> ${body}</td>
      </tr>`,
  ).join("");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#ffffff">
    <div style="display:none;max-height:0;overflow:hidden">Test first. Supplement second. Here is what happens next.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
      <tr>
        <td align="center" style="padding:40px 20px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
            <tr><td style="padding-bottom:40px">${logo}</td></tr>
            <tr><td style="font:700 28px/34px Arial,Helvetica,sans-serif;color:#000;padding-bottom:16px">You're on the list.</td></tr>
            <tr><td style="font:16px/24px Arial,Helvetica,sans-serif;color:#000;padding-bottom:32px">
              Thanks for joining the D-Human waitlist. When early access opens, you'll hear from us first, along with pricing for each plan.
            </td></tr>
            <tr><td style="border-top:2px solid #000;padding-top:24px;font:700 14px/20px Arial,Helvetica,sans-serif;color:#000;padding-bottom:16px">How D-Human works</td></tr>
            <tr><td><table role="presentation" cellpadding="0" cellspacing="0">${steps}</table></td></tr>
            <tr><td style="font:16px/24px Arial,Helvetica,sans-serif;color:#000;padding:8px 0 32px">
              We only recommend a supplement when a marker points to it. No test result, no pitch.
            </td></tr>
            ${canReply ? `<tr><td style="font:16px/24px Arial,Helvetica,sans-serif;color:#000;padding-bottom:32px">Questions? Reply to this email. It reaches the founding team.</td></tr>` : ""}
            <tr><td style="border-top:1px solid #d9d9d9;padding-top:16px;font:12px/18px Arial,Helvetica,sans-serif;color:#5c5c5c">
              You're getting this because ${escapeHtml(email)} joined the waitlist${site ? ` at <a href="${site}" style="color:#5c5c5c">${escapeHtml(site.replace(/^https?:\/\//, ""))}</a>` : ""}.
              D-Human offers wellness guidance, not diagnosis or treatment.
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "You're on the list.",
    "",
    "Thanks for joining the D-Human waitlist. When early access opens, you'll hear from us first, along with pricing for each plan.",
    "",
    "How D-Human works",
    ...STEPS.map(([title, body], i) => `${i + 1}. ${title}. ${body}`),
    "",
    "We only recommend a supplement when a marker points to it. No test result, no pitch.",
    ...(canReply ? ["", "Questions? Reply to this email. It reaches the founding team."] : []),
    "",
    `You're getting this because ${email} joined the waitlist${site ? ` at ${site}` : ""}.`,
    "D-Human offers wellness guidance, not diagnosis or treatment.",
  ].join("\n");

  return { html, text };
}

export async function sendWelcomeEmail(email: string) {
  const r = resend();
  if (!r) {
    console.warn("[waitlist] RESEND_API_KEY is not set; skipped the welcome email");
    return;
  }
  const { html, text } = welcomeEmail(email);
  const { error } = await r.emails.send(
    {
      from: process.env.RESEND_FROM ?? "D-Human <onboarding@resend.dev>",
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
