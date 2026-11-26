import "server-only";
import { and, count, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { VerifyResult } from "./codes";
import { keyedDigest, newId, sameHash } from "./crypto";

// The App Review account (the mobile repo's docs/API.md §2.7; QA's T14; plan §2 row 21).
// Apple's reviewers can't read our inbox, so one account takes a long code instead:
//
// - Off unless REVIEW_SIGNIN_ON=1. Mayank turns it on for a submission and off after approval.
// - Only for REVIEW_ACCOUNT_EMAIL, an account set up beforehand with demo data only. The code
//   never creates an account; it signs in to that one or does nothing.
// - The code is a long random number, 20 to 64 digits, so the app's number pad can type it.
//   Only its HMAC-SHA256 under AUTH_SECRET is configured (REVIEW_CODE_HASH, 43 base64url
//   characters; keyedDigest("review-code", code)), compared in constant time, so the hash alone
//   can't be tried against guesses offline. `AUTH_SECRET=… node scripts/review-code.mjs` makes a
//   code and its hash; a new code for every submission.
// - Only /api/auth/token takes it, and with the same limits as an emailed code: tries are
//   counted in a "review window" row in login_codes (5 tries, 10 minutes), and windows count
//   toward the email's 5 codes an hour and 10 a day. The row is written already used, so the
//   web's verifyCode, which only reads unused codes, never sees it.
//
// A long code sent for any other address is just a wrong code: the token route hands it to
// verifyCode, which uses one of that email's tries. Twenty digits or more means a review
// code can never be mistaken for a six-digit emailed one, and 10^20 codes against five tries
// a window can't be guessed.

/** login_codes.code_hash of a review window; a real code's hash is 64 hex. No email is sent for one, so the email budget skips it. */
export const REVIEW_WINDOW = "review-window";
const TEN_MINUTES = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MAX_TRIES = 5;
const MAX_CODES_PER_HOUR = 5;
const MAX_CODES_PER_DAY = 10;

/** The review account's code, as the app's number pad types it: digits only, 20 or more. */
export const LONG_CODE = /^\d{20,64}$/;

/** What REVIEW_CODE_HASH holds for a code: its HMAC under AUTH_SECRET (scripts/review-code.mjs makes the same). */
export const reviewCodeHash = (code: string) => keyedDigest("review-code", code);

export type ReviewAccount = { email: string; codeHash: string };

/** The review sign-in, when it's switched on and fully configured; otherwise null. */
export function reviewAccount(env: Record<string, string | undefined> = process.env): ReviewAccount | null {
  if (env.REVIEW_SIGNIN_ON !== "1") return null;
  const email = env.REVIEW_ACCOUNT_EMAIL?.trim().toLowerCase();
  const codeHash = env.REVIEW_CODE_HASH?.trim();
  if (!email?.includes("@") || !codeHash || !/^[A-Za-z0-9_-]{43}$/.test(codeHash)) return null;
  return { email, codeHash };
}

const codes = schema.loginCodes;

/** The open window for this address, or a new one if the email's code limits allow it. */
async function openWindow(email: string, now: number): Promise<string | null> {
  const d = await db();
  return d.transaction(async (tx) => {
    // The same lock issueCode takes, so windows and emailed codes are counted together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`login:${email}`}))`);
    const [open] = await tx
      .select({ id: codes.id })
      .from(codes)
      .where(and(eq(codes.email, email), eq(codes.codeHash, REVIEW_WINDOW), gt(codes.expiresAt, new Date(now)), lt(codes.attempts, MAX_TRIES)))
      .orderBy(desc(codes.createdAt))
      .limit(1);
    if (open) return open.id;
    const [recent] = await tx
      .select({ day: count(), hour: count(sql`case when ${gt(codes.createdAt, new Date(now - HOUR))} then 1 end`) })
      .from(codes)
      .where(and(eq(codes.email, email), gt(codes.createdAt, new Date(now - 24 * HOUR))));
    if (recent.hour >= MAX_CODES_PER_HOUR || recent.day >= MAX_CODES_PER_DAY) return null;
    const id = newId();
    await tx.insert(codes).values({ id, email, codeHash: REVIEW_WINDOW, expiresAt: new Date(now + TEN_MINUTES), consumedAt: new Date(now) });
    return id;
  });
}

/** Checks a long code for the review account. Same answers as verifyCode; never creates an account. */
export async function verifyReviewCode(email: string, code: string, review: ReviewAccount): Promise<VerifyResult> {
  if (email !== review.email) return { ok: false, reason: "invalid" };
  const now = Date.now();
  const windowId = await openWindow(email, now);
  if (!windowId) return { ok: false, reason: "locked" };
  const d = await db();
  // One guarded update claims a try, so guesses sent at once can't exceed five.
  const [claimed] = await d
    .update(codes)
    .set({ attempts: sql`${codes.attempts} + 1` })
    .where(and(eq(codes.id, windowId), lt(codes.attempts, MAX_TRIES), gt(codes.expiresAt, new Date(now))))
    .returning({ attempts: codes.attempts });
  if (!claimed) return { ok: false, reason: "locked" };
  if (!sameHash(reviewCodeHash(code), review.codeHash)) return { ok: false, reason: claimed.attempts >= MAX_TRIES ? "locked" : "invalid" };
  const [user] = await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) return { ok: false, reason: "invalid" };
  return { ok: true, userId: user.id, isNew: false };
}
