import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/platform/PageLoading";
import { ReportsManager } from "@/components/platform/ReportsManager";
import { settleStaleReads } from "@/lib/platform/analyze";
import { requireMember } from "@/lib/platform/member";
import { localDate } from "@/lib/platform/profile";
import { listReports, printedFor } from "@/lib/platform/reports";

export const metadata: Metadata = { title: "Your reports" };

const dateText = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

async function Reports() {
  const { user, profile } = await requireMember();
  // A read that died partway is marked failed first, so it isn't listed as still running.
  await settleStaleReads(user.id);
  const reports = await listReports(user.id);
  return (
    <ReportsManager
      reports={reports.map((r) => ({
        id: r.id,
        status: r.status,
        title: r.labName || "Blood report",
        when: r.collectedOn ? `Collected ${dateText(r.collectedOn)}` : `Uploaded ${dateText(localDate(profile.timezone, r.createdAt))}`,
        markers: r.markers,
        printedFor: printedFor(r.nameOnReport, profile.name),
      }))}
    />
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<PageLoading title="Your reports" main="max-w-2xl lg:pt-12" />}>
      <Reports />
    </Suspense>
  );
}
