import { and, eq } from "drizzle-orm";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { json, unauthorized } from "@/lib/platform/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/stack/[id]">) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const d = await db();
  const [s] = await d
    .select({ status: schema.stacks.status, error: schema.stacks.error })
    .from(schema.stacks)
    .where(and(eq(schema.stacks.id, id), eq(schema.stacks.userId, user.id)))
    .limit(1);
  return s ? json(s) : json({ error: "not_found" }, 404);
}
