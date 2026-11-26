import { and, count, eq } from "drizzle-orm";
import { appActor, isAppRequest } from "@/lib/api/actor";
import { updateRequired } from "@/lib/api/version";
import { privateJson } from "@/lib/api/respond";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { READ_MESSAGES, isStale, settleStaleRead } from "@/lib/platform/analyze";
import { json, unauthorized } from "@/lib/platform/http";
import { deleteReports } from "@/lib/platform/reports";

// The read's stages, in order, for the app's "Reading your report" line (lib/platform/analyze.ts).
const STEPS = ["uploaded", "reading", "interpreting", "ready"] as const;

// A report's progress, polled while it's read. The web's request is resolved and answered exactly
// as before. An app's is taken as its token and answered privately, adding the step it's on (of
// how many) and how many markers have been found so far: counts only, never a name or a value.
export async function GET(request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const app = isAppRequest(request);
  const outdated = app ? updateRequired(request) : null; // 426 for an app below the oldest version served
  if (outdated) return outdated;
  const user = app ? ((await appActor(request))?.user ?? null) : await apiUser();
  if (!user) return app ? privateJson({ error: "signed_out" }, 401) : unauthorized();
  const reply = app ? privateJson : json;
  const { id } = await ctx.params;
  const d = await db();
  const [r] = await d
    .select({ status: schema.reports.status, stage: schema.reports.stage, error: schema.reports.error, startedAt: schema.reports.startedAt })
    .from(schema.reports)
    .where(and(eq(schema.reports.id, id), eq(schema.reports.userId, user.id)))
    .limit(1);
  if (!r) return reply({ error: "not_found" }, 404);
  // A read that died partway (crash, deploy, killed function) ends as failed, so the screen can offer a retry.
  if ((r.status === "reading" || r.status === "interpreting") && isStale(r.startedAt) && (await settleStaleRead(id, user.id))) {
    return app ? privateJson({ status: "failed", stage: null, error: READ_MESSAGES.stale, step: null, steps: STEPS.length, markersFound: 0 }) : json({ status: "failed", stage: null, error: READ_MESSAGES.stale });
  }
  if (!app) return json({ status: r.status, stage: r.stage, error: r.error });
  const [found] = await d.select({ n: count() }).from(schema.markers).where(and(eq(schema.markers.reportId, id), eq(schema.markers.userId, user.id)));
  const step = STEPS.indexOf(r.status as (typeof STEPS)[number]);
  return privateJson({ status: r.status, stage: r.stage, error: r.error, step: step >= 0 ? step + 1 : null, steps: STEPS.length, markersFound: Number(found?.n ?? 0) });
}

// Deletes one report with its files, markers, read, stack and any wrap that counted it. The web's
// request is answered exactly as before; an app's is taken as its token and answered privately
// (the friend's-report box and the reports list). A report that's gone answers the same.
export async function DELETE(request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const app = isAppRequest(request);
  const outdated = app ? updateRequired(request) : null; // 426 for an app below the oldest version served
  if (outdated) return outdated;
  const user = app ? ((await appActor(request))?.user ?? null) : await apiUser();
  if (!user) return app ? privateJson({ error: "signed_out" }, 401) : unauthorized();
  const { id } = await ctx.params;
  await deleteReports(user.id, [id]);
  return app ? privateJson({ status: "deleted" }) : json({ status: "deleted" });
}
