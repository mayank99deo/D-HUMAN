import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { db, schema } from "@/lib/db";
import { SESSION_COOKIE as COOKIE } from "./cookie";
import { newSessionToken, sha256 } from "./crypto";

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export async function startSession(userId: string) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS);
  const d = await db();
  await d.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt });
  await d.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, userId));
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    const d = await db();
    await d.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  }
  store.delete(COOKIE);
}

export type SessionUser = { id: string; email: string };

// Reads the session cookie once per request. Returns null when signed out.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Session checks compare against the clock, so they always run at request time.
  await connection();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const d = await db();
  const rows = await d
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    // kind: a cookie only ever finds a cookie's row, never an app token's (lib/auth/bearer.ts).
    .where(and(eq(schema.sessions.id, sha256(token)), eq(schema.sessions.kind, "cookie"), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return user;
}

// For Route Handlers: they answer 401 rather than redirecting. A request carrying an
// Authorization header is never resolved from the cookie (A4): the apps send one, and only
// routes that call authenticate() (lib/auth/authenticate.ts) take their tokens. The web never
// sends one, so for it nothing changes.
export async function apiUser(): Promise<SessionUser | null> {
  if ((await headers()).has("authorization")) return null;
  return getSessionUser();
}
