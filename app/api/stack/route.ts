import { after } from "next/server";
import { AiUnavailableError } from "@/lib/ai/client";
import { apiUser } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/platform/http";
import { STACK_MESSAGES, startStack } from "@/lib/platform/stack";
import { allowRequest } from "@/lib/waitlist/rate-limit";

export const maxDuration = 300;

export async function POST() {
  const user = await apiUser();
  if (!user) return unauthorized();
  // A first speed bump per server; the daily cap is counted in the database by startStack.
  if (!allowRequest(`stack:${user.id}`, 5, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  try {
    const started = await startStack(user.id);
    if (started.kind === "no_report") return json({ error: "no_report" }, 409);
    if (started.kind === "daily_limit") return json({ error: "daily_limit", message: STACK_MESSAGES.daily_limit }, 429);
    // Already building: hand back that one, so a second tap follows the same stack.
    if (started.kind === "building") return json({ id: started.id });
    after(() => started.job);
    return json({ id: started.id });
  } catch (error) {
    if (error instanceof AiUnavailableError) return json({ error: "ai_off" }, 503);
    throw error;
  }
}
