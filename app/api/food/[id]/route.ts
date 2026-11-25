import { notForApp } from "@/lib/auth/authenticate";
import { apiUser } from "@/lib/auth/session";
import { deleteMeal } from "@/lib/platform/food";
import { json, unauthorized } from "@/lib/platform/http";

export async function DELETE(request: Request, ctx: RouteContext<"/api/food/[id]">) {
  const refused = await notForApp(request); // not open to the apps yet: 403 not_for_app
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  await deleteMeal(user.id, id);
  return json({ status: "deleted" });
}
