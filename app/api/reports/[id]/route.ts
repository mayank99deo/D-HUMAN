import { and, eq } from "drizzle-orm";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { json, unauthorized } from "@/lib/platform/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const d = await db();
  const [r] = await d
    .select({ status: schema.reports.status, stage: schema.reports.stage, error: schema.reports.error })
    .from(schema.reports)
    .where(and(eq(schema.reports.id, id), eq(schema.reports.userId, user.id)))
    .limit(1);
  if (!r) return json({ error: "not_found" }, 404);
  return json(r);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const d = await db();
  await d.delete(schema.reports).where(and(eq(schema.reports.id, id), eq(schema.reports.userId, user.id)));
  return json({ status: "deleted" });
}
