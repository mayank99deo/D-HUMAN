import { randomBytes } from "node:crypto";

// The native apps' bearer tokens (the mobile repo's docs/API.md §2): the format, how long
// they last, and the header checks every route can afford. No database here, so routes that
// only refuse app tokens (cron, webhooks, the waitlist) don't load it.

const DAY = 86_400_000;

/** The apps' sign-in: 90 days after last use, never past 365 days from the code; at most 10 phones a person. */
export const APP_SESSION = {
  idleMs: 90 * DAY,
  maxMs: 365 * DAY,
  perPerson: 10,
  /** last_used_at (and the sliding expiry) is written at most this often per token. */
  touchEveryMs: 60 * 60 * 1000,
} as const;

/** `dht_` and 32 random bytes in base64url: 47 characters. The prefix lets log scrubbers and secret scanners spot one. */
export const newAppToken = () => `dht_${randomBytes(32).toString("base64url")}`;

/**
 * The only Authorization value an app request may carry: exactly one space, a capital B, and a
 * well-formed token. Two headers arrive joined with ", " and fail it; so does anything else (A3).
 */
export const BEARER_HEADER = /^Bearer dht_[A-Za-z0-9_-]{43}$/;

/**
 * Headers only browsers send. Every fetch POST from a page carries Origin, and modern browsers
 * add Sec-Fetch-* to every request; a page can remove neither. The apps send neither. So no
 * page, not even a script injected into ours, can get a token or use one (A1, A4).
 */
export function fromBrowser(request: Request): boolean {
  if (request.headers.has("origin")) return true;
  for (const name of request.headers.keys()) if (name.startsWith("sec-fetch-")) return true;
  return false;
}

/**
 * Whether the request carries an app token, well-formed or not. The routes that must never
 * serve the apps refuse it (A6) by this header check alone, with no database lookup. Only
 * `dht_` tokens: the daily cron and the Sheets form send their own `Bearer <secret>` and are
 * unaffected.
 */
export const carriesAppToken = (request: Request) => /^\s*bearer\s+dht_/i.test(request.headers.get("authorization") ?? "");

/** What the apps read when a route isn't theirs. */
export const NOT_FOR_APP_WORDS = "The app can't do this yet. You can do it at d-human.fit.";

/**
 * The refusal for an app token where apps don't belong, or don't yet: 403 not_for_app, and
 * nothing else runs. Never 401: only a missing, malformed, expired or revoked token gets that,
 * because a 401 makes the app wipe its sign-in, and the token is fine; the route isn't open to it.
 */
export const refuseAppToken = () =>
  Response.json({ error: "not_for_app", message: NOT_FOR_APP_WORDS }, { status: 403, headers: { "cache-control": "private, no-store" } });

/**
 * The X-DHuman-Client header (`ios/1.0.0 (42)`), kept only for version counts (A13): never
 * for security, limits or words. Anything odd is dropped, never an error.
 */
export function clientHeader(request: Request): string | null {
  const value = request.headers.get("x-dhuman-client")?.trim();
  return value && value.length <= 64 && /^[A-Za-z0-9 ./()_-]+$/.test(value) ? value : null;
}
