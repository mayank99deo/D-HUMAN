import { eq } from "drizzle-orm";
import { after } from "next/server";
import { apiUser, endSession } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { forgetFeedbackInSheet, respondentCode } from "@/lib/email/feedback";
import { json, unauthorized } from "@/lib/platform/http";

// Deletes the account and everything tied to it (reports, files, markers, food,
// wraps, stacks, sessions, email settings and sends, feedback answers) through the
// foreign keys' ON DELETE CASCADE, plus the sign-in codes, which are kept by email
// with no link to the account. One transaction, so a failure leaves the account
// whole and signed in to retry.
//
// Then, after the response, the Google Sheet is asked to delete this person's
// Feedback and Replies rows by their respondent code. If the Sheet doesn't answer,
// the daily job keeps asking (lib/email/feedback.ts).
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE") return json({ error: "confirm" }, 400);
  // Worked out before the account goes: it comes from the person's id.
  const respondent = respondentCode(user.id);
  const d = await db();
  await d.transaction(async (tx) => {
    await tx.delete(schema.loginCodes).where(eq(schema.loginCodes.email, user.email));
    await tx.delete(schema.users).where(eq(schema.users.id, user.id));
  });
  await endSession();
  if (respondent) after(() => forgetFeedbackInSheet(respondent));
  return json({ status: "deleted" });
}
