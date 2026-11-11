import { apiUser } from "@/lib/auth/session";
import { claimReport } from "@/lib/platform/analyze";
import { json, unauthorized } from "@/lib/platform/http";
import { claimRefused, streamAnalysis } from "@/lib/platform/report-stream";
import { allowRequest } from "@/lib/waitlist/rate-limit";

export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext<"/api/reports/[id]/retry">) {
  const user = await apiUser();
  if (!user) return unauthorized();
  // A first speed bump per server; the real limits are counted in the database by the claim.
  if (!allowRequest(`report:${user.id}`, 6, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const { id } = await ctx.params;
  // Atomic: a read already running (and fresh) refuses; two quick taps start one read.
  const claim = await claimReport(id, user.id);
  if (!claim.ok) return claimRefused(claim);
  return streamAnalysis(id, user.id, claim.startedAt);
}
