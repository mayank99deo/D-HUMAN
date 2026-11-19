import "server-only";
import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema, type Db } from "@/lib/db";
import type { Report } from "@/lib/db/schema";
import { blankAskAnswers } from "./ask";

export type ReportRow = {
  id: string;
  status: string;
  labName: string | null;
  collectedOn: string | null;
  createdAt: Date;
  nameOnReport: string | null;
  markers: number;
};

/** Every report a person has uploaded, newest first, with how many markers each read found. */
export async function listReports(userId: string): Promise<ReportRow[]> {
  const d = await db();
  const [reports, counts] = await Promise.all([
    d
      .select({
        id: schema.reports.id,
        status: schema.reports.status,
        labName: schema.reports.labName,
        collectedOn: schema.reports.collectedOn,
        createdAt: schema.reports.createdAt,
        nameOnReport: schema.reports.nameOnReport,
      })
      .from(schema.reports)
      .where(eq(schema.reports.userId, userId))
      .orderBy(desc(schema.reports.createdAt)),
    d
      .select({ reportId: schema.markers.reportId, n: count() })
      .from(schema.markers)
      .where(eq(schema.markers.userId, userId))
      .groupBy(schema.markers.reportId),
  ]);
  const byReport = new Map(counts.map((c) => [c.reportId, Number(c.n)]));
  return reports.map((r) => ({ ...r, markers: byReport.get(r.id) ?? 0 }));
}

/**
 * Newest first by when the blood was taken, then by upload time. A report that doesn't say
 * when it was collected counts from the day it was uploaded (in IST), so it isn't buried
 * under last year's dated one.
 */
export function newestReportOrder(): SQL[] {
  return [sql`coalesce(${schema.reports.collectedOn}, (${schema.reports.createdAt} at time zone 'Asia/Kolkata')::date) desc`, desc(schema.reports.createdAt)];
}

/**
 * The newest report that's been read: by when the blood was taken, then by upload time.
 * Null if none is ready. Reports still being read, or whose read failed, are skipped. Ask
 * uses it now; Home, Wraps and Stack still go by upload order (an open item).
 */
export async function newestReadyReport(userId: string, q?: Db): Promise<Report | null> {
  const d = q ?? (await db());
  const [r] = await d
    .select()
    .from(schema.reports)
    .where(and(eq(schema.reports.userId, userId), eq(schema.reports.status, "ready")))
    .orderBy(...newestReportOrder())
    .limit(1);
  return r ?? null;
}

/**
 * The name printed on a report when it doesn't look like the person's own (a friend's
 * report tried out on the app), else null. Loose on purpose, because it sits beside a
 * delete: any part of their name counts as a match, so "Mayank N.", "M. NARAYAN" and
 * "MR MAYANKKUMAR" are all theirs. Only a name sharing nothing with theirs is flagged.
 */
export function printedFor(nameOnReport: string | null, profileName: string | null): string | null {
  const printed = nameOnReport?.trim();
  // Letters with their vowel signs (\p{M}), so a Devanagari name stays whole.
  const parts = (profileName ?? "").toLowerCase().split(/[^\p{L}\p{M}]+/u).filter((w) => w.length >= 2);
  if (!printed || !parts.length) return null;
  // "मयंक" on the profile and "MAYANK" on the report can't be compared, so say nothing.
  const latin = /\p{Script=Latin}/u;
  if (latin.test(printed) !== latin.test(profileName ?? "")) return null;
  const lower = printed.toLowerCase();
  return parts.some((w) => lower.includes(w)) ? null : printed;
}

/**
 * Deletes some or all of a person's reports, and with each its files, markers, read
 * and stack (foreign keys cascade). A stack built from meals alone has no report and stays. Every wrap that counted any report goes too: a wrap
 * compares a report in its period with the one uploaded before it, which can be from
 * any date, so only that is sure to leave no wrap quoting a deleted report. The Wraps
 * screen offers to make them again, from meals that are all still there. Reads already
 * used stay counted (lib/domain/plan.ts), so deleting never hands back a read. Ask's
 * answers that used any report are blanked too, keeping the questions (blankAskAnswers).
 * Returns how many reports went.
 */
export async function deleteReports(userId: string, which: "all" | string[]): Promise<number> {
  if (which !== "all" && which.length === 0) return 0;
  const d = await db();
  return d.transaction(async (tx) => {
    const mine = which === "all" ? eq(schema.reports.userId, userId) : and(eq(schema.reports.userId, userId), inArray(schema.reports.id, which));
    const gone = await tx.delete(schema.reports).where(mine).returning({ id: schema.reports.id });
    // A stack without a report was built from meals, so it stays (migration 0008 removed
    // the old ones left without their report).
    if (!gone.length) return 0;
    await tx.delete(schema.wraps).where(and(eq(schema.wraps.userId, userId), sql`coalesce((${schema.wraps.stats}->>'reportsInPeriod')::int, 0) > 0`));
    await blankAskAnswers(tx, userId);
    return gone.length;
  });
}
