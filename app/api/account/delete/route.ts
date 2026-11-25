import { eq } from "drizzle-orm";
import { after } from "next/server";
import { sameOrigin } from "@/lib/auth/origin";
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
export async function POST(request: Request) {
  // Acts on the session alone: only from our own pages (lib/auth/origin.ts).
  if (!sameOrigin(request)) return json({ error: "bad_origin" }, 403);
  const user = await apiUser();
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE") return json({ error: "confirm" }, 400);
  // Worked out before the account goes: it comes from the person's id.
  const respondent = respondentCode(user.id);
  const d = await db();
  const userRow = await d.transaction(async (tx) => {
    await tx.delete(schema.loginCodes).where(eq(schema.loginCodes.email, user.email));
    await tx.delete(schema.users).where(eq(schema.users.id, user.id));
    return queueUserForget(tx, user.id);
  });
  await endSession();
  if (respondent) after(() => forgetFeedbackInSheet(respondent));
  if (userRow) after(() => forgetUserRow(userRow));
  return json({ status: "deleted" });
}
