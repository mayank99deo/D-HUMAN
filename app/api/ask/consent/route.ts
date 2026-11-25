import type { AskConsentOk } from "@/lib/ask/types";
import { notForApp } from "@/lib/auth/authenticate";
import { sameOrigin } from "@/lib/auth/origin";
import { apiUser } from "@/lib/auth/session";
import { acceptAskConsent, askFail, askGateError, askJson, dayFields, errorClass, istDay } from "@/lib/platform/ask";
import { getProfile } from "@/lib/platform/profile";

// Ask's one-time notice, for people who agreed to D-Human before Ask existed: "Got it" sets
// profiles.ask_consent_at once (contract §3.5, §13). Until then POST /api/ask answers
// consent_needed. People who agree at onboarding now get it set there (app/api/profile).

export async function POST(request: Request) {
  const refused = await notForApp(request); // not open to the apps yet: 403 not_for_app
  if (refused) return refused;
  if (!sameOrigin(request)) return askFail("bad_origin");
  const user = await apiUser();
  if (!user) return askFail("signed_out");
  const days = dayFields(istDay());
  try {
    const profile = await getProfile(user.id);
    const gate = askGateError(user, profile);
    if (gate) return askFail(gate, days);
    const at = await acceptAskConsent(user.id);
    if (!at) return askFail("not_onboarded", days);
    return askJson({ consentAt: at.toISOString() } satisfies AskConsentOk);
  } catch (error) {
    console.error(`[ask] consent error class=${errorClass(error)}`);
    return askFail("error", days);
  }
}
