import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashCode, newCode, newId, sameHash } from "./crypto";

const TEN_MINUTES = 10 * 60 * 1000;
const MAX_CODES_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

export type IssueResult = { ok: true; code: string } | { ok: false; reason: "too_many" };

export async function issueCode(email: string): Promise<IssueResult> {
  const d = await db();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await d
    .select({ id: schema.loginCodes.id })
    .from(schema.loginCodes)
    .where(and(eq(schema.loginCodes.email, email), gt(schema.loginCodes.createdAt, hourAgo)));
  if (recent.length >= MAX_CODES_PER_HOUR) return { ok: false, reason: "too_many" };

  const code = newCode();
  await d.insert(schema.loginCodes).values({
    id: newId(),
    email,
    codeHash: hashCode(email, code),
    expiresAt: new Date(Date.now() + TEN_MINUTES),
  });
  return { ok: true, code };
}

export type VerifyResult =
  | { ok: true; userId: string; isNew: boolean }
  | { ok: false; reason: "invalid" | "expired" | "locked" };

// Checks the newest live code for the email. Five wrong tries burn the code.
export async function verifyCode(email: string, code: string): Promise<VerifyResult> {
  const d = await db();
  const [row] = await d
    .select()
    .from(schema.loginCodes)
    .where(and(eq(schema.loginCodes.email, email), isNull(schema.loginCodes.consumedAt)))
    .orderBy(desc(schema.loginCodes.createdAt))
    .limit(1);
  if (!row) return { ok: false, reason: "expired" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  if (!sameHash(row.codeHash, hashCode(email, code))) {
    await d
      .update(schema.loginCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(schema.loginCodes.id, row.id));
    return { ok: false, reason: row.attempts + 1 >= MAX_ATTEMPTS ? "locked" : "invalid" };
  }

  await d
    .update(schema.loginCodes)
    .set({ consumedAt: new Date() })
    .where(eq(schema.loginCodes.id, row.id));

  const [existing] = await d
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing) return { ok: true, userId: existing.id, isNew: false };

  const id = newId();
  await d.insert(schema.users).values({ id, email });
  await d.insert(schema.profiles).values({ userId: id });
  return { ok: true, userId: id, isNew: true };
}
