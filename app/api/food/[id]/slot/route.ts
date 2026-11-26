import { z } from "zod";
import { appOnly } from "@/lib/api/actor";
import { appRefusal } from "@/lib/api/errors";
import { changeSlot } from "@/lib/api/meals";
import { privateJson } from "@/lib/api/respond";
import { mealJson } from "@/lib/api/views/parts";

// Moves a logged meal to another slot ("Logged as lunch", Change), for the apps only. It changes
// nothing else: not the day, the numbers or the plan's count. Setting the slot it already has
// answers the same, so a resend is safe. 404 for a meal that's gone or someone else's.
const body = z.object({ meal: z.enum(["breakfast", "lunch", "dinner", "snack"]) });

export async function POST(request: Request, ctx: RouteContext<"/api/food/[id]/slot">) {
  const member = await appOnly(request, { write: true });
  if (!member.ok) return member.response;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return appRefusal("invalid", 400, { message: "Pick breakfast, lunch, dinner or a snack." });
  const { id } = await ctx.params;
  const log = await changeSlot(member.user.id, id, parsed.data.meal);
  if (!log) return appRefusal("not_found", 404, { message: "That meal is gone." });
  return privateJson({ meal: mealJson(log, member.profile.timezone) });
}
