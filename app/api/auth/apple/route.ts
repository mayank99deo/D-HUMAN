import { privateJson } from "@/lib/api/respond";
import { fromBrowser } from "@/lib/auth/app-token";
import { SIGN_IN_WORDS } from "@/lib/auth/sign-in-words";

// Sign in with Apple for the apps (the mobile repo's docs/API.md §2.8). Not built yet:
// verifying Apple's identity token needs Packd's Apple Developer enrolment (the Services ID,
// the Sign in with Apple key, the Team ID). Until then it says so, plainly, and the app offers
// the emailed code. It follows the token route's rule already: never for a browser (A1).
export async function POST(request: Request) {
  if (fromBrowser(request)) return privateJson({ error: "not_for_browsers", message: SIGN_IN_WORDS.not_for_browsers }, 400);
  return privateJson({ error: "apple_unavailable", message: SIGN_IN_WORDS.apple_unavailable }, 501);
}
