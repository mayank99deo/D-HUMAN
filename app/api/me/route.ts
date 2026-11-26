import { viewResponse } from "@/lib/api/respond";
import { apiSignedIn } from "@/lib/platform/api-member";
import { meJson, meReports } from "@/lib/api/views/me";
import { meView } from "@/lib/platform/views/me";

// The apps' "who am I": onboarding state, consent, persona and the whole profile, from the
// same builder as the web's app layout (lib/platform/views/me.ts), plus the hold (G1) and the
// reports version (G11). Works before onboarding. Private, no-store, with an ETag: a repeat with
// If-None-Match answers 304.
export async function GET(request: Request) {
  const signedIn = await apiSignedIn(request);
  if (!signedIn.ok) return signedIn.response;
  const reports = await meReports(signedIn.actor.user.id, signedIn.profile);
  return viewResponse(request, meJson(meView(signedIn.actor.user, signedIn.profile), reports));
}
