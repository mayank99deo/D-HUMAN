import { eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { privateJson } from "@/lib/api/respond";
import { clientHeader, fromBrowser } from "@/lib/auth/app-token";
import { resentSignIn, signInToken, startAppSession, type SignIn } from "@/lib/auth/bearer";
import { verifyCode, type VerifyResult } from "@/lib/auth/codes";
import { LONG_CODE, reviewAccount, verifyReviewCode } from "@/lib/auth/review";
import { SIGN_IN_WORDS } from "@/lib/auth/sign-in-words";
import { db, schema } from "@/lib/db";
import { sendFounderAlert } from "@/lib/email/send";
import { pushUserRow } from "@/lib/sheets/users";
import { allowRequest, clientIp } from "@/lib/waitlist/rate-limit";

// The apps' sign-in (the mobile repo's docs/API.md §2.1): the emailed code, unchanged
// (POST /api/auth/code sends it), exchanged here for a bearer token in the JSON body. Never
// a cookie, and never for a browser (A1). The web's POST /api/auth/verify is untouched.
//
// The code is checked by the same verifyCode the web uses, so its 5 tries and single use are
// shared, and a first sign-in creates the account and profile exactly as the web does.
//
// A resend: the app sends a random `key` with each try and the same key when it sends that
// try again (iOS never resends a POST, and an answer can be lost on a dropped connection).
// The same email, code and key within 10 minutes get the same token back, from the one
// session the first try made, and use no try (lib/auth/bearer.ts, signInToken).

const body = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  // Six digits, or the App Review account's 12 or more; spaces and dashes are dropped.
  code: z.string().max(200),
  key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
  // The hardware model (iPhone18,1), never the name someone gave their phone. Optional.
  device: z
    .object({
      label: z.string().trim().max(40).regex(/^[A-Za-z0-9 ,._()-]*$/).optional(),
      os: z.string().trim().max(16).regex(/^[0-9.]*$/).optional(),
    })
    .optional(),
});

const refuse = (error: keyof typeof SIGN_IN_WORDS, status = 400, headers: Record<string, string> = {}) =>
  privateJson({ error, message: SIGN_IN_WORDS[error] }, status, headers);

const answer = (s: SignIn) =>
  privateJson({ token: s.token, tokenType: "Bearer", expiresAt: s.expiresAt.toISOString(), user: { id: s.userId, email: s.email }, onboarded: s.onboarded, isNew: s.isNew });

/** The code's digits when it's a code at all: six, or twelve and more (the review account's). */
function digitsOf(raw: string): string | null {
  if (!/^[\d\s-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 6 || LONG_CODE.test(digits) ? digits : null;
}

/** Checks the code. A long one is only ever right for the review account; anywhere else it's a wrong code and uses a try. */
async function check(email: string, code: string): Promise<{ result: VerifyResult; review: boolean }> {
  const review = code.length > 6 ? reviewAccount() : null;
  if (review && email === review.email) return { result: await verifyReviewCode(email, code, review), review: true };
  return { result: await verifyCode(email, code), review: false };
}

export async function POST(request: Request) {
  // A browser always sends Origin or Sec-Fetch-* on a fetch POST and can't remove them (A1).
  if (fromBrowser(request)) return refuse("not_for_browsers");
  // The same per-IP bucket as the web's verify, so the two together get no more guesses.
  if (!allowRequest(`verify:${clientIp(request.headers)}`, 20, 10 * 60_000)) return refuse("rate_limited", 429, { "retry-after": "600" });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("invalid");
  const { email, key, device } = parsed.data;
  const code = digitsOf(parsed.data.code);
  if (!code) return refuse("invalid");

  // A resend of a try that already signed in: its own answer again.
  const resent = key ? await resentSignIn(email, code, key) : null;
  if (resent) return answer(resent);

  const { result, review } = await check(email, code);
  if (!result.ok) {
    // The first try may have finished while this one waited: a resend that crossed it gets its answer.
    const crossed = key ? await resentSignIn(email, code, key) : null;
    return crossed ? answer(crossed) : refuse(result.reason);
  }

  const session = await startAppSession(
    result.userId,
    { label: device?.label || null, client: clientHeader(request) },
    key ? { token: signInToken(email, code, key) } : {},
  );
  // A new account gets its row in the founders' Sheet after the answer, as on the web.
  if (result.isNew) after(() => pushUserRow(result.userId));
  if (review) {
    // A count, never the address (A14); and every use tells the founders (plan §2 row 21).
    console.info("[auth] review account signed in");
    after(() =>
      sendFounderAlert({
        key: `review-signin:${session.publicId}`,
        subject: "D-Human: the App Review account signed in",
        text: "The App Review account just signed in to the app with the review code. If no review is under way, turn REVIEW_SIGNIN_ON off in Vercel and redeploy.",
      }).catch(() => {}),
    );
  }
  const d = await db();
  const [profile] = await d.select({ onboardedAt: schema.profiles.onboardedAt }).from(schema.profiles).where(eq(schema.profiles.userId, result.userId)).limit(1);
  return answer({ token: session.token, userId: result.userId, email, expiresAt: session.expiresAt, onboarded: Boolean(profile?.onboardedAt), isNew: result.isNew });
}
