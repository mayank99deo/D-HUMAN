import { viewResponse } from "@/lib/api/respond";
import { settingsJson } from "@/lib/api/views/app";
import { getPrefs } from "@/lib/email/prefs";
import { apiMember } from "@/lib/platform/api-member";
import { paidPasses } from "@/lib/platform/plan";
import { currentPlanDetail } from "@/lib/platform/plan-state";

// The apps' Settings: the plan (unpaid orders checked with Razorpay first, briefly, as on the
// web), the passes bought with dates only, the email settings, and how the weekly wrap reaches
// the person (G6). The same three loaders as the web's /settings, in parallel. The profile comes
// from GET /api/me; the devices from GET /api/me/sessions. Private, no-store, with an ETag.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  const { user, profile } = member;
  const [plan, passes, emails] = await Promise.all([currentPlanDetail(user.id, profile.timezone, { reconcile: true }), paidPasses(user.id, profile.timezone), getPrefs(user.id)]);
  return viewResponse(request, settingsJson({ email: user.email, plan, passes, emails }));
}
