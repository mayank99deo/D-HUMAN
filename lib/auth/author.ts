import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { slugify } from "@/lib/blog/checks";
import { FRESH_SESSION_DAYS } from "@/lib/blog/types";
import { db, schema } from "@/lib/db";
import { SESSION_COOKIE } from "./cookie";
import { newId, sha256 } from "./crypto";
import { sameOrigin } from "./origin";
import { isOwnerEmail } from "./owners";

// Who may write the blog at /write. Mayank's rule (2026-11-18): the existing email-code
// sign-in, and only the addresses in BLOG_OWNER_EMAILS (comma-separated). Each owner
// gets a blog_authors row the first time they open /write, which holds their public
// byline (name, role, bio, photo); setting `active` false there shuts one out without
// a redeploy. Every page and API route under /write calls this on the server.
//
// Publishing, taking down and deleting also need a sign-in from the last
// FRESH_SESSION_DAYS days, so an old stolen cookie can't change the public site.

export type Author = { id: string; email: string; name: string; slug: string; freshSession: boolean };
export type WriterAccess = { kind: "signed_out" } | { kind: "not_author" } | { kind: "author"; author: Author };

export { isOwnerEmail, ownerEmails } from "./owners";

const DAY = 24 * 60 * 60 * 1000;
export const isFresh = (sessionCreatedAt: Date | null, now = new Date()) =>
  !!sessionCreatedAt && now.getTime() - sessionCreatedAt.getTime() < FRESH_SESSION_DAYS * DAY;

/** A first byline from the app profile's name, or the address before the @. */
async function firstByline(userId: string, email: string): Promise<{ name: string; slug: string }> {
  const d = await db();
  const [profile] = await d.select({ name: schema.profiles.name }).from(schema.profiles).where(eq(schema.profiles.userId, userId)).limit(1);
  const local = email.split("@")[0].replace(/[^A-Za-z]+/g, " ").trim();
  const name = profile?.name?.trim() || (local ? local[0].toUpperCase() + local.slice(1) : "D-Human writer");
  return { name: name.slice(0, 60), slug: slugify(name) || slugify(local) || "writer" };
}

/** The author row for an owner, made on first visit. Two first visits at once settle on one row. */
async function ensureAuthorRow(userId: string, email: string) {
  const d = await db();
  const find = () => d.select().from(schema.blogAuthors).where(eq(schema.blogAuthors.email, email)).limit(1);
  const [existing] = await find();
  if (existing) return existing;
  const { name, slug } = await firstByline(userId, email);
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? slug : `${slug}-${n}`;
    try {
      await d.insert(schema.blogAuthors).values({ id: newId(), email, slug: candidate, name }).onConflictDoNothing({ target: schema.blogAuthors.email });
      break;
    } catch {
      // The slug is someone else's; try the next one.
    }
  }
  const [row] = await find();
  if (!row) throw new Error("Couldn't create the author row");
  return row;
}

/** The access rule itself, given who is signed in. Exported for tests. */
export async function accessFor(user: { id: string; email: string } | null, sessionCreatedAt: Date | null, now = new Date()): Promise<WriterAccess> {
  if (!user) return { kind: "signed_out" };
  const email = user.email.trim().toLowerCase();
  if (!isOwnerEmail(email)) return { kind: "not_author" };
  const row = await ensureAuthorRow(user.id, email);
  if (!row.active) return { kind: "not_author" };
  return { kind: "author", author: { id: row.id, email, name: row.name, slug: row.slug, freshSession: isFresh(sessionCreatedAt, now) } };
}

/** The signed-in user with when this session began. */
async function sessionWithAge(): Promise<{ user: { id: string; email: string }; createdAt: Date } | null> {
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const d = await db();
  const [row] = await d
    .select({ id: schema.users.id, email: schema.users.email, createdAt: schema.sessions.createdAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return row ? { user: { id: row.id, email: row.email }, createdAt: row.createdAt } : null;
}

/**
 * Once per request: who is asking, as a writer. A slow check is logged with where the
 * time went (a /write screen once sat on "Loading…" live and couldn't be reproduced).
 */
export const writerAccess = cache(async (): Promise<WriterAccess> => {
  await connection(); // before reading the clock (Cache Components)
  const started = Date.now();
  const session = await sessionWithAge();
  const signedIn = Date.now();
  const access = await accessFor(session?.user ?? null, session?.createdAt ?? null);
  const took = Date.now() - started;
  if (took > 1500) console.warn(`[write] slow access check ${took} ms (session ${signedIn - started} ms, author ${Date.now() - signedIn} ms, ${access.kind})`);
  return access;
});

// ── API routes ──────────────────────────────────────────────────────────────

const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * The gate for every /api/write route. Signed out: 401, like every other API route.
 * Signed in but not a writer: 404, so the routes don't reveal themselves. Writes
 * from another site: 403.
 */
export async function writeGuard(request: Request, { mutation = true }: { mutation?: boolean } = {}): Promise<{ ok: true; author: Author } | { ok: false; response: Response }> {
  if (mutation && !sameOrigin(request)) return { ok: false, response: reply({ error: "bad_origin" }, 403) };
  const access = await writerAccess();
  if (access.kind === "signed_out") return { ok: false, response: reply({ error: "signed_out" }, 401) };
  if (access.kind === "not_author") return { ok: false, response: reply({ error: "not_found" }, 404) };
  return { ok: true, author: access.author };
}

/** The other writers someone can ask for a read: active, still on the owner list, not themselves. */
export async function otherAuthors(me: Author): Promise<{ id: string; name: string }[]> {
  const d = await db();
  const rows = await d
    .select({ id: schema.blogAuthors.id, name: schema.blogAuthors.name, email: schema.blogAuthors.email })
    .from(schema.blogAuthors)
    .where(eq(schema.blogAuthors.active, true));
  return rows.filter((r) => r.id !== me.id && isOwnerEmail(r.email)).map(({ id, name }) => ({ id, name }));
}
