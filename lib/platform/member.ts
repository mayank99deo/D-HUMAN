import "server-only";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getProfile, personaFor } from "./profile";

// For every signed-in page: the user, their profile and persona, or a redirect
// to sign in or to finish onboarding.
export async function requireMember() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  if (!profile?.onboardedAt) redirect("/onboarding");
  return { user, profile, persona: personaFor(profile) };
}
