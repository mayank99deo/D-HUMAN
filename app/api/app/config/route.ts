import { publicView } from "@/lib/api/respond";
import { configJson } from "@/lib/api/views/app";

// The apps' remote config: the oldest version still served and the latest, the store link, the
// API's address, and the switches turned off (APP_SWITCHES_OFF: voice, snap, again, reminders,
// appleSignIn, iap, doses). Switches only ever turn things off. No sign-in; public for 5 minutes,
// with an ETag. The apps call it at launch and when they come back after a minute away.
export async function GET(request: Request) {
  return publicView(request, configJson(), 300);
}
