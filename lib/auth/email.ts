import "server-only";
import { Resend } from "resend";

const FONT = "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export async function sendSignInCode(email: string, code: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV !== "production") {
      // Local dev without Resend: the code goes to the server log instead.
      console.info(`[auth] Sign-in code for ${email}: ${code}`);
      return true;
    }
    console.error("[auth] RESEND_API_KEY is not set; cannot send sign-in codes");
    return false;
  }
  if (process.env.NODE_ENV !== "production") console.info(`[auth] Sign-in code for ${email}: ${code}`);

  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#000;padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#fff" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px 32px 8px;font:700 13px/1 ${FONT};letter-spacing:5px;color:#000">D-HUMAN</td></tr>
<tr><td style="padding:24px 32px 8px;font:16px/24px ${FONT};color:#5c5c5c">Your sign-in code</td></tr>
<tr><td style="padding:0 32px 24px;font:800 44px/1.1 ${FONT};letter-spacing:6px;color:#000">${spaced}</td></tr>
<tr><td style="padding:0 32px 32px;font:14px/22px ${FONT};color:#5c5c5c;border-top:1px solid #d4d4d4;padding-top:20px">It works for 10 minutes. If you didn't ask for it, ignore this email; nobody can sign in without the code.</td></tr>
</table></td></tr></table></body></html>`;

  const { error } = await new Resend(key).emails.send({
    from: process.env.RESEND_FROM || "D-Human <hello@dhuman.fit>",
    to: email,
    subject: `${spaced} is your D-Human code`,
    html,
    text: `Your D-Human sign-in code: ${spaced}\n\nIt works for 10 minutes. If you didn't ask for it, ignore this email.`,
  });
  if (error) {
    console.error("[auth] Sign-in email failed:", error.name, error.message);
    return false;
  }
  return true;
}
