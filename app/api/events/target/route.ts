import { z } from "zod";
import { appActor, isAppRequest } from "@/lib/api/actor";
import { privateJson } from "@/lib/api/respond";
import { apiUser } from "@/lib/auth/session";
import { pickTargetEvent } from "@/lib/platform/events";
import { json, unauthorized } from "@/lib/platform/http";

const body = z.object({ eventId: z.string().uuid().nullable() });

// Picks (or, with null, clears) the event the read and the bib aim at, from the person's list. It
// sets off no search, so it costs nothing. Naming a new event in mind is POST /api/profile, which
// for the apps counts against the week's event searches. The web's request is answered exactly as
// before; an app's is taken as its token and answered privately.
export async function POST(request: Request) {
  const app = isAppRequest(request);
  const user = app ? ((await appActor(request))?.user ?? null) : await apiUser();
  if (!user) return app ? privateJson({ error: "signed_out" }, 401) : unauthorized();
  const reply = app ? privateJson : json;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "invalid" }, 400);
  // False when the event doesn't exist or belongs to someone else's private search.
  const saved = await pickTargetEvent(user.id, parsed.data.eventId);
  if (!saved) return reply({ error: "not_found" }, 404);
  return reply({ status: "saved" });
}
