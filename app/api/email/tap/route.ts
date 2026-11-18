import { z } from "zod";
import { apiUser } from "@/lib/auth/session";
import { recordTap } from "@/lib/email/send";
import { json, unauthorized } from "@/lib/platform/http";

// Records the first tap on an email's link (`e` = the send id). The app posts it once a
// page opened from an email loads signed in, then drops `e` from the address bar.
// The answer is the same whether or not `e` matched, so it can't probe other people's sends.

const body = z.object({ e: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) });

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  await recordTap(user.id, parsed.data.e);
  return json({ ok: true });
}
