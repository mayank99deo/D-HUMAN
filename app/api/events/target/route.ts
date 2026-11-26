import { z } from "zod";
import { notForApp } from "@/lib/auth/authenticate";
import { apiUser } from "@/lib/auth/session";
import { pickTargetEvent } from "@/lib/platform/events";
import { json, unauthorized } from "@/lib/platform/http";

const body = z.object({ eventId: z.string().uuid().nullable() });

export async function POST(request: Request) {
  const refused = await notForApp(request); // not open to the apps yet: 403 not_for_app
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  // False when the event doesn't exist or belongs to someone else's private search.
  const saved = await pickTargetEvent(user.id, parsed.data.eventId);
  if (!saved) return json({ error: "not_found" }, 404);
  return json({ status: "saved" });
}
