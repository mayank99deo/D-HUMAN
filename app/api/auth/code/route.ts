import { z } from "zod";
import { issueCode } from "@/lib/auth/codes";
import { reviewAccount } from "@/lib/auth/review";
import { sendSignInCode } from "@/lib/auth/email";
import { isSuppressed, SUPPRESSED_MESSAGE } from "@/lib/email/suppress";
import { allowRequest, clientIp } from "@/lib/waitlist/rate-limit";

const body = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });

export async function POST(request: Request) {
  if (!allowRequest(`code:${clientIp(request.headers)}`, 8, 10 * 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_email" }, { status: 400 });

  const { email } = parsed.data;
  // The apps only (they send X-DHuman-Client; the web never does). G15: the App Review address,
  // while review sign-in is on, answers as usual with no email sent: the reviewer signs in with
  // the review code, and a code email would use the day's small Resend budget for nothing.
  const app = /^(ios|android)\//.test(request.headers.get("x-dhuman-client") ?? "");
  if (app && reviewAccount()?.email === email) return Response.json({ status: "sent" });
  // Resend drops all mail to an address that hard-bounced or reported spam, sign-in codes
  // included. The code still goes (our copy of that list may be out of date), but the
  // screen says why it may not arrive instead of leaving the person waiting. The check
  // can never block or fail a code.
  const [issued, suppressed] = await Promise.all([issueCode(email), isSuppressed(email).catch(() => false)]);
  if (!issued.ok) return Response.json({ error: "rate_limited" }, { status: 429 });
  let why = "";
  const sent = await sendSignInCode(email, issued.code, { why: (r) => (why = r) });
  // G14, the apps only: when the day's email allowance is used up, say so, so the app doesn't
  // say "try again in a minute". It comes back at midnight UTC, when Resend's day starts.
  if (!sent && app && why === "daily_quota_exceeded") {
    const wait = Math.ceil((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1) - Date.now()) / 1000);
    return Response.json({ error: "unavailable_today", message: "We can't send sign-in codes for the rest of today. Try again tomorrow." }, { status: 503, headers: { "retry-after": String(wait) } });
  }
  if (!sent) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json(suppressed ? { status: "sent", notice: "suppressed", message: SUPPRESSED_MESSAGE } : { status: "sent" });
}
