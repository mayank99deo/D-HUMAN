import { after } from "next/server";
import { appOnly, isAppRequest } from "@/lib/api/actor";
import { appRefusal } from "@/lib/api/errors";
import { privateJson, viewResponse } from "@/lib/api/respond";
import { stackJson } from "@/lib/api/views/stack";
import { AiUnavailableError } from "@/lib/ai/client";
import { apiMember } from "@/lib/platform/api-member";
import { stackData, stackView } from "@/lib/platform/views/stack";
import { apiUser } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/platform/http";
import { STACK_MESSAGES, startStack } from "@/lib/platform/stack";
import { allowRequest, secondsUntilReset } from "@/lib/waitlist/rate-limit";

export const maxDuration = 300;

// The apps' Stack, from the same loader and builder as the web's /stack page
// (lib/platform/views/stack.ts): the stack, why it's out of date or held, the hold's words, the
// flagged results, and a fit for every budget slab. A held or out-of-date stack carries no
// doses. Apps only (a web cookie gets 403 bearer_required); private, no-store, with an ETag.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  return viewResponse(request, stackJson(stackView(member, await stackData(member))));
}

// Builds a stack. The web's request is resolved and answered exactly as before. An app's is
// taken as its token, answered privately with words, and first asks two things the web doesn't:
// consent to the current wording (409 consent_needed) and the health question (409
// health_check_needed, gap G2): conditions, pregnancy among them, and medicines.
export async function POST(request: Request) {
  const app = isAppRequest(request);
  const member = app ? await appOnly(request, { write: true }) : null;
  if (member && !member.ok) return member.response;
  const user = member ? member.user : await apiUser();
  if (!user) return unauthorized();
  if (member && !member.profile.healthCheckedAt)
    return appRefusal("health_check_needed", 409, { message: "Before your first stack, tell us about any health conditions and medicines." });
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => (app ? privateJson(body, status, headers) : json(body, status));
  // A first speed bump per server; the daily cap is counted in the database by startStack.
  if (!allowRequest(`stack:${user.id}`, 5, 60 * 60_000))
    return app ? appRefusal("rate_limited", 429, { message: "That's a lot of builds in an hour. Try again a bit later.", retryAfter: secondsUntilReset(`stack:${user.id}`) }) : json({ error: "rate_limited" }, 429);
  try {
    const started = await startStack(user.id);
    if (started.kind === "no_data") return reply({ error: "no_data", message: STACK_MESSAGES.no_data }, 409);
    if (started.kind === "daily_limit") return reply({ error: "daily_limit", message: STACK_MESSAGES.daily_limit }, 429, app ? { "retry-after": "3600" } : {});
    // Already building: hand back that one, so a second tap follows the same stack.
    if (started.kind === "building") return reply({ id: started.id });
    after(() => started.job);
    return reply({ id: started.id });
  } catch (error) {
    if (error instanceof AiUnavailableError) return app ? appRefusal("ai_off", 503, { message: "Stack building isn't switched on yet on this server." }) : json({ error: "ai_off" }, 503);
    throw error;
  }
}
