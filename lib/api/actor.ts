import "server-only";

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
