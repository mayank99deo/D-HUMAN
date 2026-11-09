import { z } from "zod";
import { AiUnavailableError } from "@/lib/ai/client";
import { apiUser } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/platform/http";
import { getProfile, localDate } from "@/lib/platform/profile";
import { makeWrap, periodRange } from "@/lib/platform/wraps";
import { allowRequest } from "@/lib/waitlist/rate-limit";

export const maxDuration = 120;

const body = z.object({ period: z.enum(["week", "month", "year"]), offset: z.number().int().min(-60).max(0) });

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!allowRequest(`wrap:${user.id}`, 12, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const profile = await getProfile(user.id);
  if (!profile) return json({ error: "not_onboarded" }, 409);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  const { period, offset } = parsed.data;
  const { start, end } = periodRange(period, localDate(profile.timezone), offset);
  try {
    const wrap = await makeWrap(user.id, profile, period, start, end);
    return json("empty" in wrap ? { empty: true } : { id: wrap.id });
  } catch (error) {
    if (error instanceof AiUnavailableError) return json({ error: "ai_off" }, 503);
    console.error("[wrap]", error);
    return json({ error: "failed" }, 500);
  }
}
