import { z } from "zod";
import { issueCode } from "@/lib/auth/codes";
import { sendSignInCode } from "@/lib/auth/email";
import { allowRequest, clientIp } from "@/lib/waitlist/rate-limit";

const body = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });

export async function POST(request: Request) {
  if (!allowRequest(`code:${clientIp(request.headers)}`, 8, 10 * 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_email" }, { status: 400 });

  const { email } = parsed.data;
  const issued = await issueCode(email);
  if (!issued.ok) return Response.json({ error: "rate_limited" }, { status: 429 });
  const sent = await sendSignInCode(email, issued.code);
  if (!sent) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json({ status: "sent" });
}
