import "server-only";
import type { Profile } from "@/lib/db/schema";
import type { ReportView } from "@/lib/platform/dashboard";
import { localDate } from "@/lib/platform/profile";
import { printedFor, type ReportRow } from "@/lib/platform/reports";
import type { ReportReadView } from "@/lib/platform/views/report";
import { markerJson } from "./home";

// The apps' reports (lib/api/schemas.ts ReportsResponse, ReadResponse). The list carries no health
// words of its own, so its page stays as it is and this shapes the same loader's output; the
// read is shaped from the web page's own view (lib/platform/views/report.ts).

const dateText = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** GET /api/reports: every upload, newest first, with the words the web's list shows. */
export function reportsJson(profile: Pick<Profile, "name" | "timezone">, rows: ReportRow[]) {
  return {
    reports: rows.map((r) => {
      const uploadedOn = localDate(profile.timezone, r.createdAt);
      return {
        id: r.id,
        status: r.status,
        title: r.labName || "Blood report",
        when: r.collectedOn ? `Collected ${dateText(r.collectedOn)}` : `Uploaded ${dateText(uploadedOn)}`,
        collectedOn: r.collectedOn,
        uploadedOn,
        markers: r.markers,
        printedFor: printedFor(r.nameOnReport, profile.name),
      };
    }),
  };
}

/** GET /api/reports/[id]/read: the read as the web's report page shows it, every word as stored. */
export function readJson(v: ReportReadView, view: ReportView, tz: string | null | undefined) {
  const { read } = v;
  return {
    id: view.id,
    lab: view.labName,
    collectedOn: view.collectedOn,
    uploadedOn: localDate(tz, view.createdAt),
    demo: view.model === "mock",
    aiNote: v.aiNote,
    printedFor: v.otherName,
    verdict: { level: read.verdict.level, line: read.verdict.line, detail: read.verdict.detail, lang: v.verdictLang ?? null },
    headline: read.headline,
    summary: read.summary,
    counts: { markers: v.markers.length, out: v.out },
    wins: read.wins,
    focus: read.focus.map((f) => ({ title: f.title, why: f.why, action: f.action })),
    groups: v.groups.map((g) => ({ panel: g.panel, markers: g.markers.map(({ marker, note }) => markerJson(marker, note ?? null)) })),
    doctorQuestions: read.doctor_questions,
    retest: {
      dueOn: v.retest.dueOn,
      days: v.retest.days,
      label: v.retest.label,
      weeks: read.retest.weeks,
      from: view.collectedOn ? ("collected" as const) : ("uploaded" as const),
      why: read.retest.why,
      markers: v.retestMarkers,
    },
    testTips: read.test_tips,
  };
}
