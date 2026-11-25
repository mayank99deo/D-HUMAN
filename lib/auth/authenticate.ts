import "server-only";
import { after } from "next/server";
import { BEARER_HEADER, clientHeader, fromBrowser } from "./app-token";
import { dueForTouch, findBearerSession, touchAppSession, type BearerSession } from "./bearer";
import { sameOrigin } from "./origin";
import { getSessionUser, type SessionUser } from "./session";

// One resolver for every route the apps use (the mobile repo's docs/API.md §2.4; QA's A2–A5).
//
// - A request carrying Authorization is a bearer request and nothing else: it never falls back
//   to the cookie, so a cookie can't fill in for a bad token (A4).
// - The header must be exactly `Bearer dht_<43 base64url characters>` (A3), and the request
//   must carry no Origin and no Sec-Fetch-* header: tokens are for the apps, not for pages (A4).
// - Anything else is the web's cookie request, resolved exactly as the pages resolve it.
//
// Routes the apps don't use yet keep apiUser() (lib/auth/session.ts), which treats any
// request carrying Authorization as signed out; each route takes app tokens only once it
// calls authenticate().

export type Actor = { via: "cookie"; user: SessionUser } | { via: "bearer"; user: SessionUser; session: BearerSession };

export async function authenticate(request: Request): Promise<Actor | null> {
  const auth = request.headers.get("authorization");
  if (auth !== null) {
    if (!BEARER_HEADER.test(auth) || fromBrowser(request)) return null;
    const session = await findBearerSession(auth.slice("Bearer ".length));
    if (!session) return null;
    // Sliding expiry, off the critical path and at most once an hour per phone.
    if (dueForTouch(session)) {
      const client = clientHeader(request);
      after(() => touchAppSession(session, client).catch((error) => console.error("[auth] couldn't record app use:", error instanceof Error ? error.message : error)));
    }
    return { via: "bearer", user: session.user, session };
  }
  const user = await getSessionUser();
  return user ? { via: "cookie", user } : null;
}

/**
 * The origin rule (A5). Cookie requests must come from our own pages, exactly as before. A
 * request carrying Authorization skips it: authenticate() then accepts only a valid app token
 * with no Origin, which no other site can send (browsers can't add Authorization across sites
 * without a CORS preflight, and no route approves one, A7).
 */
export const originOk = (request: Request) => request.headers.has("authorization") || sameOrigin(request);
