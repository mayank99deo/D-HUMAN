import { z } from "zod";
import { wrapsData, wrapsJson } from "@/lib/api/views/wraps";
import { apiMember } from "@/lib/platform/api-member";
import { AiUnavailableError } from "@/lib/ai/client";
import { appOnly, isAppRequest } from "@/lib/api/actor";
import { updateRequired } from "@/lib/api/version";
import { appRefusal } from "@/lib/api/errors";
import { privateJson, viewResponse } from "@/lib/api/respond";
import { apiUser } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/platform/http";
import { getProfile, localDate } from "@/lib/platform/profile";
import { makeWrap, periodRange } from "@/lib/platform/wraps";
import { allowRequest, secondsUntilReset } from "@/lib/waitlist/rate-limit";

export const maxDuration = 120;

const body = z.object({ period: z.enum(["week", "month", "year"]), offset: z.number().int().min(-60).max(0) });

// The apps' Wraps: each period's card, with its story when made, as the web's /wraps lists them.
// ?period=week lists weeks only (G5); ?week=YYYY-MM-DD adds that week, as the weekly email's link
// does on the web. Marker cards carry the flag of a result they name (G12). Apps only (a web
// cookie gets 403 bearer_required); private, no-store, with an ETag. Reads only: making a wrap is
// POST, which stays the web's for now.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  const url = new URL(request.url);
  const data = await wrapsData(member.user.id, member.profile, { weeksOnly: url.searchParams.get("period") === "week", week: url.searchParams.get("week") });
  return viewResponse(request, wrapsJson(data));
}

// Makes a period's wrap. The web's request is resolved and answered exactly as before; an app's
// is taken as its token (409 consent_needed for old consent) and answered privately, with words.
export async function POST(request: Request) {
  const app = isAppRequest(request);
  const outdated = app ? updateRequired(request) : null; // 426 for an app below the oldest version served
  if (outdated) return outdated;
  const member = app ? await appOnly(request, { write: true }) : null;
  if (member && !member.ok) return member.response;
  const user = member ? member.user : await apiUser();
  if (!user) return unauthorized();
  const reply = (b: unknown, status = 200) => (app ? privateJson(b, status) : json(b, status));
  if (!allowRequest(`wrap:${user.id}`, 12, 60 * 60_000))
    return app ? appRefusal("rate_limited", 429, { message: "That's a lot of wraps in an hour. Try again a bit later.", retryAfter: secondsUntilReset(`wrap:${user.id}`) }) : json({ error: "rate_limited" }, 429);
  const profile = member ? member.profile : await getProfile(user.id);
  if (!profile) return json({ error: "not_onboarded" }, 409);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return app ? appRefusal("invalid", 400, { message: "Pick a week, month or year." }) : json({ error: "invalid" }, 400);
  const { period, offset } = parsed.data;
  const { start, end } = periodRange(period, localDate(profile.timezone), offset);
  try {
    const wrap = await makeWrap(user.id, profile, period, start, end);
    return reply("empty" in wrap ? { empty: true } : { id: wrap.id });
  } catch (error) {
    if (error instanceof AiUnavailableError) return app ? appRefusal("ai_off", 503, { message: "Wraps aren't switched on yet on this server." }) : json({ error: "ai_off" }, 503);
    console.error("[wrap]", error);
    return app ? appRefusal("failed", 500) : json({ error: "failed" }, 500);
  }
}
