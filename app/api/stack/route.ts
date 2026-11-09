import { after } from "next/server";
import { AiUnavailableError } from "@/lib/ai/client";
import { apiUser } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/platform/http";
import { startStack } from "@/lib/platform/stack";
import { allowRequest } from "@/lib/waitlist/rate-limit";

export const maxDuration = 300;

export async function POST() {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!allowRequest(`stack:${user.id}`, 5, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  try {
    const started = await startStack(user.id);
    if (!started) return json({ error: "no_report" }, 409);
    after(() => started.job);
    return json({ id: started.id });
  } catch (error) {
    if (error instanceof AiUnavailableError) return json({ error: "ai_off" }, 503);
    throw error;
  }
}
