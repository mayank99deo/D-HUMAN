import "server-only";
import { consentCurrent } from "@/lib/domain/consent";
import { appRefusal, consentNeeded } from "./errors";
import { privateJson } from "./respond";

// For routes the web and the apps share. A request carrying Authorization is an app's, and is
// taken only as a valid app token (lib/auth/authenticate.ts); every other request keeps the
// route's own web path (apiUser(), its own answers), untouched. So the web's code path, its
// answers and its tests stay exactly as they were. The resolver is loaded only for an app's
// request, so the web's requests never even load it.

/** Whether this request is an app's: it carries Authorization. */
export const isAppRequest = (request: Request) => request.headers.has("authorization");

/** An app's request resolved as its token, with the profile its lookup joined; null when it isn't valid. */
export async function appActor(request: Request) {
  const { authenticate } = await import("@/lib/auth/authenticate");
  const actor = await authenticate(request);
  return actor?.via === "bearer" ? actor : null;
}

type AppActor = NonNullable<Awaited<ReturnType<typeof appActor>>>;

/**
 * For routes only the apps use: the onboarded person behind a valid app token, or the refusal
 * to send. A request with no Authorization (the web) gets 403 bearer_required; a write from
 * someone who agreed to older consent wording gets 409 consent_needed.
 */
export async function appOnly(
  request: Request,
  { write }: { write: boolean },
): Promise<{ ok: true; actor: AppActor; user: AppActor["user"]; profile: NonNullable<AppActor["session"]["profile"]> } | { ok: false; response: Response }> {
  const refuse = (response: Response) => ({ ok: false as const, response });
  if (!isAppRequest(request)) return refuse(appRefusal("bearer_required", 403, { message: "This is for the D-Human app." }));
  const actor = await appActor(request);
  if (!actor) return refuse(privateJson({ error: "signed_out" }, 401));
  const profile = actor.session.profile;
  if (!profile?.onboardedAt) return refuse(appRefusal("not_onboarded", 409));
  if (write && !consentCurrent(profile.consentAt)) return refuse(consentNeeded());
  return { ok: true, actor, user: actor.user, profile };
}
