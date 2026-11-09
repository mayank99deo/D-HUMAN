import { and, eq } from "drizzle-orm";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { json, unauthorized } from "@/lib/platform/http";
import { allowRequest } from "@/lib/waitlist/rate-limit";
import { streamAnalysis } from "@/lib/platform/report-stream";

export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext<"/api/reports/[id]/retry">) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!allowRequest(`report:${user.id}`, 6, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const { id } = await ctx.params;
  const d = await db();
  const [r] = await d
    .select({ status: schema.reports.status })
    .from(schema.reports)
    .where(and(eq(schema.reports.id, id), eq(schema.reports.userId, user.id)))
    .limit(1);
  if (!r) return json({ error: "not_found" }, 404);
  if (r.status === "reading" || r.status === "interpreting") return json({ error: "busy" }, 409);
  return streamAnalysis(id, user.id);
}
