import { z } from "zod";
import { issueCode } from "@/lib/auth/codes";
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
  // Resend drops all mail to an address that hard-bounced or reported spam, sign-in codes
  // included. The code still goes (our copy of that list may be out of date), but the
  // screen says why it may not arrive instead of leaving the person waiting. The check
  // can never block or fail a code.
  const [issued, suppressed] = await Promise.all([issueCode(email), isSuppressed(email).catch(() => false)]);
  if (!issued.ok) return Response.json({ error: "rate_limited" }, { status: 429 });
  const sent = await sendSignInCode(email, issued.code);
  if (!sent) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json(suppressed ? { status: "sent", notice: "suppressed", message: SUPPRESSED_MESSAGE } : { status: "sent" });
}
