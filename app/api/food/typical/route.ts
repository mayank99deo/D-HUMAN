import { z } from "zod";
import { AiRefusalError, AiUnavailableError } from "@/lib/ai/client";
import { apiUser } from "@/lib/auth/session";
import { saveTypicalDay } from "@/lib/platform/food";
import { json, unauthorized } from "@/lib/platform/http";
import { getProfile } from "@/lib/platform/profile";
import { allowRequest } from "@/lib/waitlist/rate-limit";

export const maxDuration = 120;

const body = z.object({ description: z.string().trim().min(10).max(2000) });

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!allowRequest(`typical:${user.id}`, 10, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const profile = await getProfile(user.id);
  if (!profile) return json({ error: "not_onboarded" }, 409);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "too_short" }, 400);
  try {
    const day = await saveTypicalDay(user.id, profile, parsed.data.description);
    return json({ day });
  } catch (error) {
    if (error instanceof AiUnavailableError) return json({ error: "ai_off" }, 503);
    if (error instanceof AiRefusalError) return json({ error: "refused", message: "We couldn't read that description. Try listing what you eat, meal by meal." }, 422);
    console.error("[typical-day]", error);
    return json({ error: "failed" }, 500);
  }
}
