import { z } from "zod";
import { eq } from "drizzle-orm";
import { appOnly, isAppRequest } from "@/lib/api/actor";
import { updateRequired } from "@/lib/api/version";
import { claimUsualDay } from "@/lib/api/app-limits";
import { appRefusal } from "@/lib/api/errors";
import { privateJson } from "@/lib/api/respond";
import { AiRefusalError, AiUnavailableError } from "@/lib/ai/client";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { USUAL_DAY_REPEAT_MS, dietPictureFrom, saveTypicalDay } from "@/lib/platform/food";
import { json, unauthorized } from "@/lib/platform/http";
import { getProfile } from "@/lib/platform/profile";
import { allowRequest, secondsUntilReset } from "@/lib/waitlist/rate-limit";

export const maxDuration = 120;

const body = z.object({ description: z.string().trim().min(10).max(2000) });

/** The same words saved moments ago: saveTypicalDay hands that save back with no AI call. */
async function isRecentSave(userId: string, description: string) {
  const d = await db();
  const [b] = await d.select({ description: schema.dietBaselines.description, updatedAt: schema.dietBaselines.updatedAt }).from(schema.dietBaselines).where(eq(schema.dietBaselines.userId, userId)).limit(1);
  return !!b && b.description === description && Date.now() - b.updatedAt.getTime() < USUAL_DAY_REPEAT_MS;
}

const REFUSED = "We couldn't read that description. Try listing what you eat, meal by meal.";

// Saves the person's usual day. The web's request is resolved and answered exactly as before.
// An app's is taken as its token (409 consent_needed for old consent), answered privately with
// words, and its answer adds `short` and `runs` (gap G7): whether the day is too light to count
// (the diet picture's own rule) and how many estimates were averaged, so the result screen needs
// no second fetch. A save sent again with the same words within 3 minutes returns that save.
export async function POST(request: Request) {
  const app = isAppRequest(request);
  const outdated = app ? updateRequired(request) : null; // 426 for an app below the oldest version served
  if (outdated) return outdated;
  const member = app ? await appOnly(request, { write: true }) : null;
  if (member && !member.ok) return member.response;
  const user = member ? member.user : await apiUser();
  if (!user) return unauthorized();
  if (!allowRequest(`typical:${user.id}`, 10, 60 * 60_000))
    return app ? appRefusal("rate_limited", 429, { message: "That's a lot of saves in an hour. Try again a bit later.", retryAfter: secondsUntilReset(`typical:${user.id}`) }) : json({ error: "rate_limited" }, 429);
  const profile = member ? member.profile : await getProfile(user.id);
  if (!profile) return json({ error: "not_onboarded" }, 409);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return app ? appRefusal("too_short", 400, { message: "Describe a whole day, meal by meal, in a few more words." }) : json({ error: "too_short" }, 400);
  // Apps only: a save that will call the AI counts against the day's few (lib/api/app-limits.ts).
  // A resend of the words just saved reads that save instead, so it isn't counted.
  if (app && !(await isRecentSave(user.id, parsed.data.description))) {
    const refused = await claimUsualDay(user.id);
    if (refused) return refused;
  }
  try {
    const day = await saveTypicalDay(user.id, profile, parsed.data.description);
    if (!app) return json({ day });
    const short = dietPictureFrom(profile, [], { estimate: day }).usualDayShort;
    return privateJson({ day, short, runs: day.runs ?? 1 });
  } catch (error) {
    if (error instanceof AiUnavailableError) return app ? appRefusal("ai_off", 503, { message: "Food reading isn't switched on yet on this server." }) : json({ error: "ai_off" }, 503);
    if (error instanceof AiRefusalError) return app ? appRefusal("refused", 422, { message: REFUSED }) : json({ error: "refused", message: REFUSED }, 422);
    console.error("[typical-day]", error);
    return app ? appRefusal("failed", 500) : json({ error: "failed" }, 500);
  }
}
