import { SITE_HOST } from "@/lib/site-url";

// Requests that act on a signed-in session must come from our own pages. Browsers send
// an Origin header on every POST made with fetch(), and another site can't forge it, so
// a missing or foreign Origin is refused. The host comes from the request itself (or the
// canonical host); X-Forwarded-Host is never trusted, as a client can set it.
//
// Requests that carry their own signed link (the stop and feedback pages) don't need this:
// the link is the authority, and those pages send "Origin: null" on their no-JavaScript
// form posts because they set no-referrer.

/** Whether the request's Origin is this site. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let from: string;
  try {
    from = new URL(origin).host;
  } catch {
    return false;
  }
  return from === new URL(request.url).host || from === request.headers.get("host") || from === SITE_HOST;
}
