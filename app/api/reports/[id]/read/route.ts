import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { viewResponse, privateJson } from "@/lib/api/respond";
import { readJson } from "@/lib/api/views/reports";
import { apiMember } from "@/lib/platform/api-member";
import { reportView } from "@/lib/platform/dashboard";
import { reportReadView } from "@/lib/platform/views/report";

// The apps' report read: the verdict, the pointers, every marker grouped by panel with its note
// and flag, the doctor's questions and the retest, from the same loader and builder as the web's
// /reports/[id] page (lib/platform/views/report.ts), so every flag and word is the web's.
// GET /api/reports/[id] stays the status poll while a report is read. Another person's report
// and one with no read yet answer the same 404. Private, no-store, with an ETag.
export async function GET(request: Request, ctx: RouteContext<"/api/reports/[id]/read">) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  const { id } = await ctx.params;
  const d = await db();
  const [view, [row]] = await Promise.all([
    reportView(member.user.id, id),
    d.select({ pages: schema.reports.pages }).from(schema.reports).where(and(eq(schema.reports.id, id), eq(schema.reports.userId, member.user.id))).limit(1),
  ]);
  if (!view) return privateJson({ error: "not_found", message: "That report is gone, or it hasn't been read yet." }, 404);
  const pages = (row?.pages as { sent: number; of: number } | null) ?? null;
  return viewResponse(request, readJson(reportReadView(member.profile, view), view, member.profile.timezone, pages));
}
