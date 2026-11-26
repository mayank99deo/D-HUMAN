import { z } from "zod";
import { appOnly } from "@/lib/api/actor";
import { appPlanLimit, appRefusal } from "@/lib/api/errors";
import { eatenAtInReach, logAgain } from "@/lib/api/meals";
import { privateJson } from "@/lib/api/respond";
import { mealJson } from "@/lib/api/views/parts";
import { MEAL_KEY } from "@/lib/platform/food";
import { allowRequest, secondsUntilReset } from "@/lib/waitlist/rate-limit";

// "Log again", for the apps only: one of the person's own meals from the last 28 days logged
// again as a new meal, copied with no AI call (lib/api/meals.ts). It counts as a meal log like
// any other (Mayank, 2026-11-26); the app sends it after its 4-second Undo, so a mistap costs
// nothing. Idempotent on `key`: the same try sent again answers with the meal it logged.
const body = z.object({
  key: z.string().regex(MEAL_KEY),
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/food/[id]/again">) {
  const member = await appOnly(request, { write: true });
  if (!member.ok) return member.response;
  const { user, profile } = member;
  // Shares the meal route's hourly speed bump.
  if (!allowRequest(`food:${user.id}`, 40, 60 * 60_000)) return appRefusal("rate_limited", 429, { retryAfter: secondsUntilReset(`food:${user.id}`) });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return appRefusal("invalid", 400);
  const eatenAt = parsed.data.eatenAt ? new Date(parsed.data.eatenAt) : undefined;
  if (eatenAt && !eatenAtInReach(eatenAt)) return appRefusal("bad_time", 400);
  const { id } = await ctx.params;
  const result = await logAgain(user.id, profile, id, { key: parsed.data.key, eatenAt, meal: parsed.data.meal });
  if ("notFound" in result) return appRefusal("not_found", 404);
  if ("refusal" in result) return appPlanLimit(result.refusal);
  return privateJson({ meal: mealJson(result.log, profile.timezone), ...(result.repeat ? { repeat: true } : {}) });
}
