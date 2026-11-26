import "server-only";
import type { Marker, Profile } from "@/lib/db/schema";
import { markerDef, PANELS, type Panel } from "@/lib/domain/markers";
import { retestFrom } from "@/lib/domain/retest";
import type { ReportView } from "../dashboard";
import { localDate } from "../profile";
import { printedFor } from "../reports";

// A report's read, worked out once for both the web's /reports/[id] page and the apps'
// GET /api/reports/[id]/read, so the two can't drift (the mobile repo's docs/API.md §3.2). The
// page's own derivations, moved here unchanged, as a pure function of the profile, the stored
// read and `now`: the markers grouped by panel in the catalogue's order with each one's note,
// how many are outside their range, the retest date, the AI line, and a friend's name.

export type ReadGroup = { panel: string; markers: { marker: Marker; note: string | undefined }[] };

export function reportReadView(profile: Pick<Profile, "name" | "timezone" | "language">, view: ReportView, now = new Date()) {
  const { read, markers } = view;
  const notes = new Map(read.markers.map((m) => [m.id, m.note]));
  const groups = new Map<string, Marker[]>();
  for (const m of markers) {
    const panel = markerDef(m.key)?.panel;
    const label = panel ? PANELS[panel as Panel] : m.panel || "Other";
    groups.set(label, [...(groups.get(label) ?? []), m]);
  }
  const order = Object.values(PANELS) as string[];
  const sorted: ReadGroup[] = [...groups.entries()]
    .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
    // The read's own note for a marker, else the catalogue's line about what it is.
    .map(([panel, list]) => ({ panel, markers: list.map((m) => ({ marker: m, note: notes.get(m.id) ?? markerDef(m.key)?.what })) }));
  return {
    read,
    markers,
    groups: sorted,
    // A friend's report tried on the app: the page says so above the verdict.
    otherName: printedFor(view.nameOnReport, profile.name),
    out: markers.filter((m) => m.status === "low" || m.status === "high").length,
    // The retest counts from the day the blood was taken (or the upload day).
    retest: retestFrom(view.collectedOn ?? localDate(profile.timezone, view.createdAt), read.retest.weeks, localDate(profile.timezone, now)),
    retestMarkers: read.retest.markers.map((k) => markerDef(k)?.name ?? k),
    aiNote: view.model === "mock" ? "Demo read, written from a template" : "AI-analysed report. Not a diagnosis.",
    verdictLang: profile.language === "hi" ? ("hi" as const) : undefined,
  };
}

export type ReportReadView = ReturnType<typeof reportReadView>;
