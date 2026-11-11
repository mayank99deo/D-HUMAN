import { and, eq } from "drizzle-orm";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { json, unauthorized } from "@/lib/platform/http";
import { STACK_MESSAGES, isStaleBuild, settleStaleStack } from "@/lib/platform/stack";

export async function GET(_request: Request, ctx: RouteContext<"/api/stack/[id]">) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const d = await db();
  const [s] = await d
    .select({ status: schema.stacks.status, error: schema.stacks.error, createdAt: schema.stacks.createdAt })
    .from(schema.stacks)
    .where(and(eq(schema.stacks.id, id), eq(schema.stacks.userId, user.id)))
    .limit(1);
  if (!s) return json({ error: "not_found" }, 404);
  // A stack that died while building ends as failed, so the screen stops waiting.
  if (s.status === "building" && isStaleBuild(s.createdAt) && (await settleStaleStack(id, user.id))) {
    return json({ status: "failed", error: STACK_MESSAGES.stale });
  }
  return json({ status: s.status, error: s.error });
}
