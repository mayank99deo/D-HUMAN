import { eq } from "drizzle-orm";
import { apiUser, endSession } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { json, unauthorized } from "@/lib/platform/http";

// Deletes the account and everything tied to it (reports, files, markers, food,
// wraps, stacks, sessions) through the foreign keys' ON DELETE CASCADE.
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE") return json({ error: "confirm" }, 400);
  await endSession();
  const d = await db();
  await d.delete(schema.users).where(eq(schema.users.id, user.id));
  return json({ status: "deleted" });
}
