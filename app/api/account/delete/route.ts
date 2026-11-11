import { eq } from "drizzle-orm";
import { apiUser, endSession } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { json, unauthorized } from "@/lib/platform/http";

// Deletes the account and everything tied to it (reports, files, markers, food,
// wraps, stacks, sessions) through the foreign keys' ON DELETE CASCADE, plus the
// sign-in codes, which are kept by email with no link to the account. One
// transaction, so a failure leaves the account whole and signed in to retry.
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE") return json({ error: "confirm" }, 400);
  const d = await db();
  await d.transaction(async (tx) => {
    await tx.delete(schema.loginCodes).where(eq(schema.loginCodes.email, user.email));
    await tx.delete(schema.users).where(eq(schema.users.id, user.id));
  });
  await endSession();
  return json({ status: "deleted" });
}
