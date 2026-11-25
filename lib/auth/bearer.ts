import "server-only";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Profile } from "@/lib/db/schema";
import { APP_SESSION, newAppToken } from "./app-token";
import { keyedDigest, sha256 } from "./crypto";

// The apps' sessions: rows in `sessions` with kind 'bearer', beside the web's cookies, so the
// cascade from users, the daily purge of expired rows and the single lookup all keep working.
// Only the token's SHA-256 is stored; the token itself is shown once, in the sign-in answer.
//
// Lifetime (Mayank's default, plan §2 row 8): 90 days after last use, never past 365 days
// from the code. No refresh tokens and no rotation: every request checks the database, so
// revocation is instant, and a rotated token lost in a dropped answer on a weak signal would
// sign the person out. Dates go to the database through columns only (lib/db/params.ts).

const s = schema.sessions;

export type BearerSession = {
  id: string;
  publicId: string;
  user: { id: string; email: string };
  /** Joined in the same query, so a screen needs one database step fewer. Null before onboarding starts. */
  profile: Profile | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  absoluteExpiresAt: Date | null;
  client: string | null;
};

/** How long a resent sign-in (same email, code and key) still gets its token back. A code lives as long. */
export const RESEND_WINDOW_MS = 10 * 60 * 1000;

/**
 * The token for a sign-in sent with a resend key (the app's random key for this one try).
 * iOS never resends a POST by itself, so the app does, with the same key; when the first
 * answer was lost on a dropped connection, the resend must get the same token, and the
 * person must end up with one session, not two. So with a key the token isn't random: it
 * is keyed by AUTH_SECRET over the email, the code and the key. Nothing about it is stored
 * but its SHA-256, like every token, and only someone holding all three gets it again.
 */
export const signInToken = (email: string, code: string, key: string) => `dht_${keyedDigest("app-sign-in", email, code, key)}`;

/** Signs the app in: a new token for this person and phone. The 11th phone signs out the one used longest ago. */
export async function startAppSession(
  userId: string,
  device: { label: string | null; client: string | null },
  { now = new Date(), token = newAppToken() }: { now?: Date; token?: string } = {},
): Promise<{ token: string; publicId: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + APP_SESSION.idleMs);
  const d = await db();
  const id = sha256(token);
  // A keyed token is the same for a resend that crossed the first: the key on id keeps it one session.
  const [inserted] = await d
    .insert(s)
    .values({
      id,
      userId,
      kind: "bearer",
      expiresAt,
      absoluteExpiresAt: new Date(now.getTime() + APP_SESSION.maxMs),
      lastUsedAt: now,
      deviceLabel: device.label,
      client: device.client,
    })
    .onConflictDoNothing({ target: s.id })
    .returning({ publicId: s.publicId, expiresAt: s.expiresAt });
  const row = inserted ?? (await d.select({ publicId: s.publicId, expiresAt: s.expiresAt }).from(s).where(and(eq(s.id, id), eq(s.userId, userId), eq(s.kind, "bearer"))).limit(1))[0];
  if (!row) throw new Error("app session id taken by another account");
  // Parallel sign-ins each run this after their own insert, so the count settles at the cap.
  const keep = d
    .select({ id: s.id })
    .from(s)
    .where(and(eq(s.userId, userId), eq(s.kind, "bearer")))
    .orderBy(desc(sql`coalesce(${s.lastUsedAt}, ${s.createdAt})`), desc(s.createdAt))
    .offset(APP_SESSION.perPerson);
  await Promise.all([
    d.delete(s).where(inArray(s.id, keep)),
    d.update(schema.users).set({ lastSeenAt: now }).where(eq(schema.users.id, userId)),
  ]);
  return { token, publicId: row.publicId, expiresAt: row.expiresAt };
}

export type SignIn = { token: string; userId: string; email: string; expiresAt: Date; onboarded: boolean; isNew: boolean };

/**
 * A sign-in that already happened for this email, code and resend key, in the last 10 minutes:
 * the same answer again, or null. Checked before the code is, so a resend never uses a try.
 */
export async function resentSignIn(email: string, code: string, key: string, now = new Date()): Promise<SignIn | null> {
  const token = signInToken(email, code, key);
  const d = await db();
  const [row] = await d
    .select({ expiresAt: s.expiresAt, createdAt: s.createdAt, userId: schema.users.id, joined: schema.users.createdAt, onboardedAt: schema.profiles.onboardedAt })
    .from(s)
    .innerJoin(schema.users, eq(schema.users.id, s.userId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, s.userId))
    .where(and(eq(s.id, sha256(token)), eq(s.kind, "bearer"), eq(schema.users.email, email), gt(s.createdAt, new Date(now.getTime() - RESEND_WINDOW_MS)), gt(s.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  return {
    token,
    userId: row.userId,
    email,
    expiresAt: row.expiresAt,
    onboarded: Boolean(row.onboardedAt),
    // The account was made by this very sign-in: verifyCode creates it a moment before the session.
    isNew: row.createdAt.getTime() - row.joined.getTime() < 10_000,
  };
}

/** The live app session for a token, with its person and profile, or null. Never a cookie's row. */
export async function findBearerSession(token: string, now = new Date()): Promise<BearerSession | null> {
  const d = await db();
  const [row] = await d
    .select({
      id: s.id,
      publicId: s.publicId,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      absoluteExpiresAt: s.absoluteExpiresAt,
      client: s.client,
      user: { id: schema.users.id, email: schema.users.email },
      profile: schema.profiles,
    })
    .from(s)
    .innerJoin(schema.users, eq(schema.users.id, s.userId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, s.userId))
    .where(and(eq(s.id, sha256(token)), eq(s.kind, "bearer"), gt(s.expiresAt, now)))
    .limit(1);
  return row ?? null;
}

/** Whether this session's last use is old enough to write again (at most once an hour). */
export const dueForTouch = (session: Pick<BearerSession, "lastUsedAt">, now = new Date()) =>
  !session.lastUsedAt || now.getTime() - session.lastUsedAt.getTime() >= APP_SESSION.touchEveryMs;

/**
 * Slides the expiry: last used now, expiring 90 days from now but never past the 365-day cap.
 * Guarded, so requests arriving together write once. created_at (when the code was entered)
 * never changes. True if this call wrote.
 */
export async function touchAppSession(session: Pick<BearerSession, "id" | "createdAt" | "absoluteExpiresAt" | "client">, client: string | null, now = new Date()): Promise<boolean> {
  const cap = session.absoluteExpiresAt ?? new Date(session.createdAt.getTime() + APP_SESSION.maxMs);
  const expiresAt = new Date(Math.min(now.getTime() + APP_SESSION.idleMs, cap.getTime()));
  const d = await db();
  const wrote = await d
    .update(s)
    .set({ lastUsedAt: now, expiresAt, client: client ?? session.client })
    .where(and(eq(s.id, session.id), eq(s.kind, "bearer"), or(isNull(s.lastUsedAt), lt(s.lastUsedAt, new Date(now.getTime() - APP_SESSION.touchEveryMs)))))
    .returning({ id: s.id });
  return wrote.length > 0;
}

/** Signs this phone out. */
export async function endAppSession(sessionId: string): Promise<void> {
  const d = await db();
  await d.delete(s).where(and(eq(s.id, sessionId), eq(s.kind, "bearer")));
}

/** "Sign out other devices": every other session this person has, the web's cookies included. Returns how many ended. */
export async function endOtherSessions(userId: string, keepId: string): Promise<number> {
  const d = await db();
  const ended = await d.delete(s).where(and(eq(s.userId, userId), ne(s.id, keepId))).returning({ id: s.id });
  return ended.length;
}

export type DeviceView = { publicId: string; kind: "web" | "app"; deviceLabel: string | null; signedInAt: string; lastUsedAt: string | null; current: boolean };

/** Where this person is signed in, most recently used first. Never the hash; cookies have no last-used time. */
export async function listSessions(userId: string, currentId: string, now = new Date()): Promise<DeviceView[]> {
  const d = await db();
  const rows = await d
    .select({ id: s.id, publicId: s.publicId, kind: s.kind, deviceLabel: s.deviceLabel, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt })
    .from(s)
    .where(and(eq(s.userId, userId), gt(s.expiresAt, now)))
    .orderBy(desc(sql`coalesce(${s.lastUsedAt}, ${s.createdAt})`), desc(s.createdAt));
  return rows.map((r) => ({
    publicId: r.publicId,
    kind: r.kind === "bearer" ? "app" : "web",
    deviceLabel: r.deviceLabel,
    signedInAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    current: r.id === currentId,
  }));
}

/** Ends one of this person's sessions by its public handle. False when it isn't theirs or is already gone. */
export async function endSessionByPublicId(userId: string, publicId: string): Promise<boolean> {
  const d = await db();
  const ended = await d.delete(s).where(and(eq(s.userId, userId), eq(s.publicId, publicId))).returning({ id: s.id });
  return ended.length > 0;
}
