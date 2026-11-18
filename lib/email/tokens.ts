import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { absoluteUrl } from "@/lib/site-url";
import {
  EMAIL_CATEGORIES,
  FEEDBACK_TOKEN_DAYS,
  type EmailCategory,
  type FeedbackTokenPayload,
  type StopTokenPayload,
} from "./types";

// Signed links in emails: v1.<base64url JSON payload>.<base64url HMAC-SHA-256>.
//
// - The key comes from EMAIL_LINK_SECRET, derived once per purpose ("stop", "fb"), and the
//   purpose is also inside the signed payload. So a stop link can never pass as a feedback
//   link, and the other way round, even if one key leaked.
// - Person ids go in links, never email addresses.
// - Stop links never expire: people stop emails from old messages. Rotating
//   EMAIL_LINK_SECRET breaks every stop link ever sent, so keep it stable. It is a
//   separate secret from AUTH_SECRET on purpose: AUTH_SECRET is the one to rotate after a
//   sign-in incident, and that must not silently break stop links.
// - Local dev without the secret uses a fixed one, as lib/auth/crypto.ts does.

const VERSION = "v1";
/** Far longer than any real token (about 130 characters); refuses junk before any work. */
const MAX_TOKEN_LENGTH = 512;
const B64URL = /^[A-Za-z0-9_-]+$/;

type Purpose = "stop" | "fb";

function linkSecret(): string | null {
  const secret = process.env.EMAIL_LINK_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) return null;
  return "d-human-local-email-link-secret";
}

/** False in production until EMAIL_LINK_SECRET is set: emails with stop links must not go out then. */
export const emailLinksReady = () => linkSecret() !== null;

function keyFor(purpose: Purpose): Buffer | null {
  const secret = linkSecret();
  return secret ? createHmac("sha256", secret).update(`d-human/email-link/${VERSION}/${purpose}`).digest() : null;
}

function sign(purpose: Purpose, payload: StopTokenPayload | FeedbackTokenPayload): string {
  const key = keyFor(purpose);
  if (!key) throw new Error("EMAIL_LINK_SECRET is not set");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(`${VERSION}.${body}`).digest("base64url");
  return `${VERSION}.${body}.${sig}`;
}

/** The checked payload, or null for anything forged, altered, malformed or meant for another purpose. */
function open(purpose: Purpose, token: unknown): unknown {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, body, sig] = parts;
  if (version !== VERSION || !B64URL.test(body) || !B64URL.test(sig)) return null;
  const key = keyFor(purpose);
  if (!key) return null;
  const expected = createHmac("sha256", key).update(`${VERSION}.${body}`).digest();
  const received = Buffer.from(sig, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const personId = z.string().min(1).max(64);
const stopSchema = z.strictObject({ p: z.literal("stop"), u: personId, k: z.enum(EMAIL_CATEGORIES) });
const feedbackSchema = z.strictObject({ p: z.literal("fb"), u: personId, s: z.string().min(1).max(40), x: z.number().int().positive() });

// ── Stop links ──────────────────────────────────────────────────────────────

export function stopToken(userId: string, category: EmailCategory): string {
  return sign("stop", { p: "stop", u: userId, k: category });
}

export function readStopToken(token: unknown): StopTokenPayload | null {
  const parsed = stopSchema.safeParse(open("stop", token));
  return parsed.success ? parsed.data : null;
}

/** The footer's "Stop weekly wraps": a page that stops it by a POST once it has loaded, never on opening. */
export function stopPageUrl(userId: string, category: EmailCategory, origin?: string): string {
  return `${base(origin)}/email/stop?t=${stopToken(userId, category)}`;
}

/** For the List-Unsubscribe header (RFC 8058): the mail app POSTs here when someone taps its Unsubscribe button. */
export function oneClickUrl(userId: string, category: EmailCategory, origin?: string): string {
  return `${base(origin)}/api/email/unsubscribe?t=${stopToken(userId, category)}`;
}

const base = (origin?: string) => (origin ?? absoluteUrl("/")).replace(/\/+$/, "");

// ── Feedback links (lane F) ─────────────────────────────────────────────────

export function feedbackToken(userId: string, survey: string, now = Date.now()): string {
  const x = Math.floor(now / 1000) + FEEDBACK_TOKEN_DAYS * 24 * 60 * 60;
  return sign("fb", { p: "fb", u: userId, s: survey, x });
}

export function readFeedbackToken(token: unknown, now = Date.now()): FeedbackTokenPayload | null {
  const parsed = feedbackSchema.safeParse(open("fb", token));
  if (!parsed.success || parsed.data.x * 1000 < now) return null;
  return parsed.data;
}
