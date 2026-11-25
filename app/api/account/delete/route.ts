import { eq } from "drizzle-orm";
import { after } from "next/server";
import { privateJson } from "@/lib/api/respond";
import { authenticate, originOk } from "@/lib/auth/authenticate";
import { apiUser, endSession } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { forgetFeedbackInSheet, respondentCode } from "@/lib/email/feedback";
import { json, unauthorized } from "@/lib/platform/http";
import { forgetUserRow, queueUserForget } from "@/lib/sheets/users";

// Deletes the account and everything tied to it (reports, files, markers, food,
// wraps, stacks, sessions, email settings and sends, feedback answers) through the
// foreign keys' ON DELETE CASCADE, plus the sign-in codes, which are kept by email
// with no link to the account. One transaction, so a failure leaves the account
// whole and signed in to retry.
//
// Then, after the response, the Google Sheet is asked to delete this person's
// Feedback and Replies rows by their respondent code, and their Users row by User ID.
// If the Sheet doesn't answer, the daily job keeps asking (lib/email/feedback.ts,
// lib/sheets/users.ts). The Users row's removal is promised inside the same
// transaction as the delete, so it holds even if this function stops right after.
//
// The apps delete over their token (Apple's rule 5.1.1(v)): a request carrying Authorization
// is theirs, taken only as a valid app token (lib/auth/authenticate.ts). It has no origin to
// check and no cookie to clear, and its answers are private, no-store. Every session goes
// with the user row, the apps' tokens included. The web's path is unchanged.
export async function POST(request: Request) {
  const app = request.headers.has("authorization");
  const reply = app ? privateJson : json;
  // Acts on the session alone: only from our own pages (lib/auth/origin.ts).
  if (!originOk(request)) return json({ error: "bad_origin" }, 403);
  const user = app ? await appUser(request) : await apiUser();
  if (!user) return app ? reply({ error: "signed_out" }, 401) : unauthorized();
  const body = (await request.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE") return reply({ error: "confirm" }, 400);
  // Worked out before the account goes: it comes from the person's id.
  const respondent = respondentCode(user.id);
  const d = await db();
  const userRow = await d.transaction(async (tx) => {
    await tx.delete(schema.loginCodes).where(eq(schema.loginCodes.email, user.email));
    await tx.delete(schema.users).where(eq(schema.users.id, user.id));
    return queueUserForget(tx, user.id);
  });
  if (!app) await endSession();
  if (respondent) after(() => forgetFeedbackInSheet(respondent));
  if (userRow) after(() => forgetUserRow(userRow));
  return reply({ status: "deleted" });
}

async function appUser(request: Request) {
  const actor = await authenticate(request);
  return actor?.via === "bearer" ? actor.user : null;
}
