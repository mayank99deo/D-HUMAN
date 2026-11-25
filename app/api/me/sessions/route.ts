import { privateJson, viewResponse } from "@/lib/api/respond";
import { authenticate } from "@/lib/auth/authenticate";
import { listSessions } from "@/lib/auth/bearer";

// The app's Settings → Devices: where this person is signed in, web and app, most recently
// used first, by public handle only (A9). Apps only for now: the web's Settings doesn't show
// it (the web is on hold), so a cookie gets 403.
export async function GET(request: Request) {
  const actor = await authenticate(request);
  if (!actor) return privateJson({ error: "signed_out" }, 401);
  if (actor.via !== "bearer") return privateJson({ error: "bearer_required" }, 403);
  return viewResponse(request, { sessions: await listSessions(actor.user.id, actor.session.id) });
}
