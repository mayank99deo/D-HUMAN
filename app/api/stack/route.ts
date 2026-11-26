import { after } from "next/server";
import { viewResponse } from "@/lib/api/respond";
import { stackJson } from "@/lib/api/views/stack";
import { AiUnavailableError } from "@/lib/ai/client";
import { apiMember } from "@/lib/platform/api-member";
import { stackData, stackView } from "@/lib/platform/views/stack";
import { notForApp } from "@/lib/auth/authenticate";
import { apiUser } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/platform/http";
import { STACK_MESSAGES, startStack } from "@/lib/platform/stack";
import { allowRequest } from "@/lib/waitlist/rate-limit";

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

export async function POST(request: Request) {
  const refused = await notForApp(request); // not open to the apps yet: 403 not_for_app
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  // A first speed bump per server; the daily cap is counted in the database by startStack.
  if (!allowRequest(`stack:${user.id}`, 5, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  try {
    const started = await startStack(user.id);
    if (started.kind === "no_data") return json({ error: "no_data", message: STACK_MESSAGES.no_data }, 409);
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
