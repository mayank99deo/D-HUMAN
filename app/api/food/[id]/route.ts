import { apiUser } from "@/lib/auth/session";
import { deleteMeal } from "@/lib/platform/food";
import { json, unauthorized } from "@/lib/platform/http";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/food/[id]">) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  await deleteMeal(user.id, id);
  return json({ status: "deleted" });
}
