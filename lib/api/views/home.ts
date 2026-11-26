import "server-only";
import type { Marker } from "@/lib/db/schema";
import { fmt, rangeText, statusWords } from "@/lib/domain/marker-text";
import { markerDef } from "@/lib/domain/markers";
import type { HomeView } from "@/lib/platform/views/home";

// The apps' Home (lib/api/schemas.ts HomeResponse), shaped from the web page's own view
// (lib/platform/views/home.ts), so every verdict, doctor flag and stack line is the web's. Only
// the app routes import lib/api/views.

/** A marker as the apps get it: the tile's own words and numbers, never the row (no user or report ids). */
export function markerJson(m: Marker, note: string | null = null, before: number | null = null) {
  const def = markerDef(m.key);
  return {
    id: m.id,
    key: m.key,
    name: def?.name ?? m.name,
    short: def?.short ?? m.name,
    panel: def?.panel ?? m.panel ?? null,
    value: m.value,
    valueText: m.valueText,
    shown: m.value != null ? fmt(m.value) : (m.valueText ?? "–"),
    unit: m.unit,
    refLow: m.refLow,
    refHigh: m.refHigh,
    range: rangeText(m),
    status: m.status,
    statusText: statusWords(m.status),
    flag: m.flag === "doctor" || m.flag === "urgent" ? m.flag : null,
    flagText: m.flag === "urgent" ? "Get advice today" : m.flag ? "Show a doctor" : null,
    note,
    before,
    derived: m.rangeSource === "derived",
  };
}

/**
 * GET /api/home's answer: the same view, as the contract's plain JSON (lib/api/schemas.ts,
 * HomeResponse). Ask isn't in the apps (plan §2 row 5), so its gate isn't sent.
 */
export function homeJson(v: HomeView) {
  const r = v.report;
  return {
    day: v.day,
    greeting: v.greeting,
    noun: v.persona.noun,
    bib: v.bib,
    reading: v.inProgress ? { reportId: v.inProgress.id } : null,
    report: r
      ? {
          id: r.id,
          verdict: { level: r.read.verdict.level, line: r.read.verdict.line, detail: r.read.verdict.detail, lang: r.verdictLang ?? null },
          demo: r.isMock,
          source: r.source,
          printedFor: r.otherName,
          matter: r.matter.map((x) => markerJson(x.marker, x.note ?? null, x.before ?? null)),
          focus: r.read.focus.map((f) => ({ title: f.title, why: f.why, action: f.action })),
          // The web draws the contour from 4 markers with values; with fewer there's none.
          contour: r.contour.length >= 4 ? r.contour : [],
          retest: r.retest ? { dueOn: r.retest.dueOn, days: r.retest.days, label: r.retest.label, why: r.read.retest.why } : null,
        }
      : null,
    lastFailed: r ? null : (v.lastFailed?.error ?? null),
    fuel: {
      totals: { kcal: v.fuel.totals.kcal, proteinG: v.fuel.totals.proteinG, fibreG: v.fuel.totals.fibreG },
      targets: { kcal: v.fuel.targets.kcal, proteinG: v.fuel.targets.proteinG, fibreG: v.fuel.targets.fibreG },
      meals: v.fuel.meals,
      yesterday: { kcal: v.yesterday.totals.kcal, proteinG: v.yesterday.totals.proteinG, meals: v.yesterday.meals },
    },
    events: { ...v.events, target: v.target },
    stack: v.stack,
  };
}
