import { z } from "zod";
import { sameOrigin } from "@/lib/auth/origin";
import { apiUser } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/platform/http";
import { markWrapFinished } from "@/lib/platform/wrap-viewer";

// The wrap viewer reached a story's last card ("One thing"): wraps.finished_at, which tells
// us who saw the advice, not just who opened the weekly email. Only the person's own wrap,
// first time only. The answer is the same either way, so it can't probe other wraps.

const body = z.object({ id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) });

export async function POST(request: Request) {
  // Acts on the session alone: only from our own pages (lib/auth/origin.ts).
  if (!sameOrigin(request)) return json({ error: "bad_origin" }, 403);
  const user = await apiUser();
  if (!user) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  await markWrapFinished(user.id, parsed.data.id);
  return json({ ok: true });
}
