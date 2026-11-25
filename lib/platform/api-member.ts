import "server-only";
import { privateJson } from "@/lib/api/respond";
import { authenticate, type Actor } from "@/lib/auth/authenticate";
import type { Profile } from "@/lib/db/schema";
import type { Persona } from "@/lib/domain/persona";
import { personaFor } from "./profile";

// requireMember() for the routes the apps use: the person, their profile and persona, or an
// answer to send. Pages redirect; a route says 401 signed_out or 409 not_onboarded instead
// (the mobile repo's docs/API.md §2.4). An app token's lookup already joined the profile, so
// for the apps this is one database step, not two.

export type ApiMember = { ok: true; actor: Actor; user: Actor["user"]; profile: Profile; persona: Persona };
export type ApiRefusal = { ok: false; response: Response };

/**
 * The signed-in app and its person's profile (null before onboarding begins), or a 401 to send.
 * Apps only: the web's pages read their own data, so a web cookie gets 403 bearer_required and
 * these JSON reads add nothing the web can reach (only additions the apps use).
 */
export async function apiSignedIn(request: Request): Promise<{ ok: true; actor: Actor & { via: "bearer" }; profile: Profile | null } | ApiRefusal> {
  const actor = await authenticate(request);
  if (!actor) return { ok: false, response: privateJson({ error: "signed_out" }, 401) };
  if (actor.via !== "bearer") return { ok: false, response: privateJson({ error: "bearer_required" }, 403) };
  return { ok: true, actor, profile: actor.session.profile };
}

/** The signed-in, onboarded person, or a 401 or 409 to send. */
export async function apiMember(request: Request): Promise<ApiMember | ApiRefusal> {
  const signedIn = await apiSignedIn(request);
  if (!signedIn.ok) return signedIn;
  const { actor, profile } = signedIn;
  if (!profile?.onboardedAt) return { ok: false, response: privateJson({ error: "not_onboarded", message: "Finish setting up first." }, 409) };
  return { ok: true, actor, user: actor.user, profile, persona: personaFor(profile) };
}
