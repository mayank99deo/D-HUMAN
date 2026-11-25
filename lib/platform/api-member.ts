import "server-only";
import { privateJson } from "@/lib/api/respond";
import { authenticate, type Actor } from "@/lib/auth/authenticate";
import type { Profile } from "@/lib/db/schema";
import type { Persona } from "@/lib/domain/persona";
import { getProfile, personaFor } from "./profile";

// requireMember() for the routes the apps use: the person, their profile and persona, or an
// answer to send. Pages redirect; a route says 401 signed_out or 409 not_onboarded instead
// (the mobile repo's docs/API.md §2.4). An app token's lookup already joined the profile, so
// for the apps this is one database step, not two.

export type ApiMember = { ok: true; actor: Actor; user: Actor["user"]; profile: Profile; persona: Persona };
export type ApiRefusal = { ok: false; response: Response };

/** The signed-in person and their profile (null before onboarding begins), or a 401 to send. */
export async function apiSignedIn(request: Request): Promise<{ ok: true; actor: Actor; profile: Profile | null } | ApiRefusal> {
  const actor = await authenticate(request);
  if (!actor) return { ok: false, response: privateJson({ error: "signed_out" }, 401) };
  const profile = actor.via === "bearer" ? actor.session.profile : await getProfile(actor.user.id);
  return { ok: true, actor, profile };
}

/** The signed-in, onboarded person, or a 401 or 409 to send. */
export async function apiMember(request: Request): Promise<ApiMember | ApiRefusal> {
  const signedIn = await apiSignedIn(request);
  if (!signedIn.ok) return signedIn;
  const { actor, profile } = signedIn;
  if (!profile?.onboardedAt) return { ok: false, response: privateJson({ error: "not_onboarded", message: "Finish setting up first." }, 409) };
  return { ok: true, actor, user: actor.user, profile, persona: personaFor(profile) };
}
