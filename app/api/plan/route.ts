import { viewResponse } from "@/lib/api/respond";
import { planJson } from "@/lib/api/views/parts";
import { apiMember } from "@/lib/platform/api-member";
import { currentPlanDetail } from "@/lib/platform/plan-state";

// The apps' plan, for the paywall and every limit line: reads and meal logs used and allowed,
// the pass and when it ends, and why one more read or meal isn't allowed now. No words and no
// price: the apps write their own and take the price from the store (gap G3). Dead reads are
// settled first, as on the web, so they never count. Private, no-store, with an ETag.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  return viewResponse(request, planJson(await currentPlanDetail(member.user.id, member.profile.timezone)));
}
