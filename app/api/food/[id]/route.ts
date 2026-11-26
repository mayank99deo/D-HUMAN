import { appActor, isAppRequest } from "@/lib/api/actor";
import { privateJson } from "@/lib/api/respond";
import { apiUser } from "@/lib/auth/session";
import { deleteMeal } from "@/lib/platform/food";
import { json, unauthorized } from "@/lib/platform/http";

// Deletes one of the person's own meals; deleting one that's already gone (or never was, or is
// someone else's) answers the same, so the apps can send it again after a lost answer. The
// web's path and answers are as before; an app's request is taken as its token, privately.
export async function DELETE(request: Request, ctx: RouteContext<"/api/food/[id]">) {
  const app = isAppRequest(request);
  const user = app ? ((await appActor(request))?.user ?? null) : await apiUser();
  if (!user) return app ? privateJson({ error: "signed_out" }, 401) : unauthorized();
  const { id } = await ctx.params;
  await deleteMeal(user.id, id);
  return app ? privateJson({ status: "deleted" }) : json({ status: "deleted" });
}
