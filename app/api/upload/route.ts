import { viewResponse } from "@/lib/api/respond";
import { uploadJson } from "@/lib/api/views/upload";
import { aiMode } from "@/lib/ai/client";
import { apiMember } from "@/lib/platform/api-member";
import { targetEvent } from "@/lib/platform/events";
import { currentPlanDetail } from "@/lib/platform/plan-state";

// The apps' Upload screen: the plan (may another read start?), the event the read will aim at,
// the facts for the wait, and the upload limits. The same loaders as the web's /upload page, in
// parallel. Private, no-store, with an ETag. Reads only: it never starts an event search.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  const [target, plan] = await Promise.all([targetEvent(member.user.id, member.profile, member.persona), currentPlanDetail(member.user.id, member.profile.timezone)]);
  return viewResponse(request, uploadJson({ persona: member.persona, target, plan, aiOff: aiMode() === "off" }));
}
