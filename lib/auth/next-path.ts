// Where sign-in sends people afterwards: back to the screen they were heading for, when
// that is one of our own app screens. Email links (a week's wrap, Settings → Emails) and
// the blog's "Try it" buttons go through /signin?next=…, so `next` comes from outside and
// must never become an open redirect. Pure, with no server-only imports: the sign-in
// page, the verify route, onboarding and proxy.ts all use it.

/**
 * Screens a signed-out visit to which is sent to sign in first (proxy.ts matches the same
 * list). /write is the blog editor: it checks the writer itself, but a signed-out writer
 * should come back to the post they opened. /feedback isn't here: its signed link works
 * without a session, and nothing signs people in on the way to it.
 */
export const SIGN_IN_FIRST = ["/home", "/fuel", "/wraps", "/stack", "/settings", "/reports", "/upload", "/onboarding", "/write"] as const;

/** Every path `next` may lead to. */
export const RETURN_PREFIXES = SIGN_IN_FIRST;

/** Screens that don't need the app's onboarding first: writers needn't be app users (architecture §2.5). */
const SKIPS_ONBOARDING = ["/write"] as const;

const HOME = "/home";
const ONBOARDING = "/onboarding";
/** Long enough for any real app path with its query; anything longer is refused. */
const MAX_LENGTH = 1024;
/** A stand-in origin for parsing. A path that resolves anywhere else was never just a path. */
const BASE = "https://return.invalid";

/** `path` is `prefix` itself or below it ("/fuel/past" is under "/fuel"; "/fuelish" isn't). */
export function isUnder(path: string, prefix: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0];
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// Backslashes (browsers read "/\evil.com" as "//evil.com"), spaces and control characters
// (browsers strip tabs and newlines, so "/<tab>/evil.com" becomes "//evil.com").
function hasUnsafeCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0x5c) return true;
  }
  return false;
}

/**
 * `raw` as a path on this site to go to after sign-in, or null when it isn't one we allow.
 * Allowed: a single leading slash, then a path under RETURN_PREFIXES, with any query and
 * fragment. Refused: other sites ("//host", "https://…", "/\host"), schemes, encoded or
 * dot-segment tricks that land outside the list, and anything unusual. The answer is the
 * parsed, normalised path, so what is checked is exactly what the browser will open.
 */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > MAX_LENGTH) return null;
  if (raw[0] !== "/" || raw[1] === "/" || hasUnsafeCharacter(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (!RETURN_PREFIXES.some((prefix) => isUnder(url.pathname, prefix))) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Where to go once signed in. Onboarding comes first for someone who hasn't finished it,
 * carrying `next` along so its last screen leads there; /write goes straight there.
 */
export function afterSignIn(onboarded: boolean, next: string | null): string {
  if (onboarded) return next ?? HOME;
  if (next && SKIPS_ONBOARDING.some((prefix) => isUnder(next, prefix))) return next;
  if (!next || isUnder(next, HOME)) return ONBOARDING;
  if (isUnder(next, ONBOARDING)) return next;
  return `${ONBOARDING}?next=${encodeURIComponent(next)}`;
}

/** The `next` onboarding should lead to when it ends: never onboarding itself. */
export function onboardingNext(raw: unknown): string | null {
  const next = safeNext(raw);
  return next && !isUnder(next, ONBOARDING) ? next : null;
}

/** The sign-in page for someone heading to `path`. Plain /signin when that's just home. */
export function signInPath(path: string): string {
  const next = safeNext(path);
  return next && next !== HOME ? `/signin?next=${encodeURIComponent(next)}` : "/signin";
}
