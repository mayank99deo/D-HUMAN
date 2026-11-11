import "server-only";
import { and, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashCode, newCode, newId, sameHash } from "./crypto";

const TEN_MINUTES = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MAX_CODES_PER_HOUR = 5;
// Against inbox flooding and draining the email quota from many IPs.
const MAX_CODES_PER_DAY = 10;
const MAX_ATTEMPTS = 5;

const codes = schema.loginCodes;

export type IssueResult = { ok: true; code: string } | { ok: false; reason: "too_many" };

export async function issueCode(email: string): Promise<IssueResult> {
  const d = await db();
  const now = Date.now();
  const code = newCode();
  const issued = await d.transaction(async (tx) => {
    // One request per email at a time, so parallel requests can't all pass the count.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`login:${email}`}))`);
    const [recent] = await tx
      .select({ day: count(), hour: count(sql`case when ${gt(codes.createdAt, new Date(now - HOUR))} then 1 end`) })
      .from(codes)
      .where(and(eq(codes.email, email), gt(codes.createdAt, new Date(now - 24 * HOUR))));
    if (recent.hour >= MAX_CODES_PER_HOUR || recent.day >= MAX_CODES_PER_DAY) return false;
    await tx.insert(codes).values({
      id: newId(),
      email,
      codeHash: hashCode(email, code),
      expiresAt: new Date(now + TEN_MINUTES),
    });
    return true;
  });
  return issued ? { ok: true, code } : { ok: false, reason: "too_many" };
}

export type VerifyResult =
  | { ok: true; userId: string; isNew: boolean }
  | { ok: false; reason: "invalid" | "expired" | "locked" };

// Checks the newest live code for the email. Five tries per code, counted in the
// database: each guess first claims a try with one guarded UPDATE, and only a
// guess that got one is compared, so guesses sent at once can't exceed five.
export async function verifyCode(email: string, code: string): Promise<VerifyResult> {
  const d = await db();
  const [row] = await d
    .select({ id: codes.id, expiresAt: codes.expiresAt, attempts: codes.attempts })
    .from(codes)
    .where(and(eq(codes.email, email), isNull(codes.consumedAt)))
    .orderBy(desc(codes.createdAt))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  const [claimed] = await d
    .update(codes)
    .set({ attempts: sql`${codes.attempts} + 1` })
    .where(and(eq(codes.id, row.id), isNull(codes.consumedAt), lt(codes.attempts, MAX_ATTEMPTS), gt(codes.expiresAt, new Date())))
    .returning({ attempts: codes.attempts, codeHash: codes.codeHash });
  // Another request used the last try or the code itself in the meantime.
  if (!claimed) return { ok: false, reason: "locked" };

  if (!sameHash(claimed.codeHash, hashCode(email, code))) {
    return { ok: false, reason: claimed.attempts >= MAX_ATTEMPTS ? "locked" : "invalid" };
  }

  // Using the code and creating the account happen together: if either fails, neither does.
  return d.transaction(async (tx): Promise<VerifyResult> => {
    const [used] = await tx
      .update(codes)
      .set({ consumedAt: new Date() })
      .where(and(eq(codes.id, row.id), isNull(codes.consumedAt)))
      .returning({ id: codes.id });
    if (!used) return { ok: false, reason: "expired" };

    const [existing] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing) return { ok: true, userId: existing.id, isNew: false };

    const id = newId();
    const [created] = await tx
      .insert(schema.users)
      .values({ id, email })
      .onConflictDoNothing({ target: schema.users.email })
      .returning({ id: schema.users.id });
    if (!created) {
      // Signed up in a parallel request a moment ago.
      const [user] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
      return { ok: true, userId: user.id, isNew: false };
    }
    await tx.insert(schema.profiles).values({ userId: id }).onConflictDoNothing();
    return { ok: true, userId: id, isNew: true };
  });
}
