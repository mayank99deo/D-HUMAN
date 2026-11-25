import { z } from "zod";
import { notForApp } from "@/lib/auth/authenticate";
import { sameOrigin } from "@/lib/auth/origin";
import { apiUser } from "@/lib/auth/session";
import { recordTap } from "@/lib/email/send";
import { json, unauthorized } from "@/lib/platform/http";

// Records the first tap on an email's link (`e` = the send id). The app posts it once a
// page opened from an email loads signed in, then drops `e` from the address bar.
// The answer is the same whether or not `e` matched, so it can't probe other people's sends.

const body = z.object({ e: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) });

export async function POST(request: Request) {
  const refused = await notForApp(request); // not open to the apps yet: 403 not_for_app
  if (refused) return refused;
  // Acts on the session alone: only from our own pages (lib/auth/origin.ts).
  if (!sameOrigin(request)) return json({ error: "bad_origin" }, 403);
  const user = await apiUser();
  if (!user) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  await recordTap(user.id, parsed.data.e);
  return json({ ok: true });
}
