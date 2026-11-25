import { privateJson } from "@/lib/api/respond";
import { authenticate } from "@/lib/auth/authenticate";
import { endSessionByPublicId } from "@/lib/auth/bearer";

// Ends one session from the app's device list. Someone else's handle, or one already gone,
// gets the same 404 (QA test 27). Apps only for now, like the list.
export async function DELETE(request: Request, ctx: RouteContext<"/api/me/sessions/[publicId]">) {
  const actor = await authenticate(request);
  if (!actor) return privateJson({ error: "signed_out" }, 401);
  if (actor.via !== "bearer") return privateJson({ error: "bearer_required" }, 403);
  const { publicId } = await ctx.params;
  if (!(await endSessionByPublicId(actor.user.id, publicId))) return privateJson({ error: "not_found" }, 404);
  return privateJson({ status: "signed_out" });
}
