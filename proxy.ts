import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { signInPath } from "@/lib/auth/next-path";

// A signed-out visit to an app screen goes to sign in, carrying the screen as `next`, query
// included, so a tap on an email's "Play my wrap" (/wraps?week=…&e=…) lands back on that
// wrap once the code is in. Pages can't do this themselves: a Server Component never sees
// its own URL, so requireUser() can only send people to plain /signin.
//
// It runs only when the session cookie is missing. The matcher says so, and Vercel checks
// matchers before invoking anything, so signed-in requests (every tab switch and prefetch)
// never reach this function. A cookie whose session has ended still gets the pages'
// own redirect to /signin, without `next`; that's rare (sessions and cookies expire together).
//
// Matchers must be literals (Next reads them at build time): the screens are SIGN_IN_FIRST
// in lib/auth/next-path.ts and the cookie is SESSION_COOKIE. tests/return-path.test.ts
// checks they agree.
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  return NextResponse.redirect(new URL(signInPath(`${pathname}${search}`), request.url), 307);
}

export const config = {
  matcher: [
    {
      source: "/:screen(home|fuel|wraps|stack|settings|reports|upload|onboarding)/:rest*",
      missing: [{ type: "cookie", key: "dh_session" }],
    },
  ],
};
