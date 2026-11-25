import { eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { verifyCode } from "@/lib/auth/codes";
import { afterSignIn, safeNext } from "@/lib/auth/next-path";
import { startSession } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { pushUserRow } from "@/lib/sheets/users";
import { allowRequest, clientIp } from "@/lib/waitlist/rate-limit";

const body = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  code: z.string().transform((c) => c.replace(/\D/g, "")).pipe(z.string().length(6)),
  // The screen they were heading for (/signin?next=…). Checked by safeNext: anything but
  // one of our own app paths is dropped, never an error, so sign-in always works.
  next: z.unknown().optional(),
});

export async function POST(request: Request) {
  if (!allowRequest(`verify:${clientIp(request.headers)}`, 20, 10 * 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const result = await verifyCode(parsed.data.email, parsed.data.code);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });

  await startSession(result.userId);
  // A new account gets its row in the founders' Sheet after the response (lib/sheets/users.ts).
  if (result.isNew) after(() => pushUserRow(result.userId));
  const d = await db();
  const [profile] = await d
    .select({ onboardedAt: schema.profiles.onboardedAt })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, result.userId))
    .limit(1);
  return Response.json({ next: afterSignIn(Boolean(profile?.onboardedAt), safeNext(parsed.data.next)) });
}
