import "server-only";
import type { ContourMarker } from "@/components/platform/Contour";
import { fmt, rangeText, statusWords } from "@/components/platform/marker-text";
import { retestFrom } from "@/components/platform/retest";
import type { HomeStackState } from "@/lib/api/schemas";
import { askGate } from "@/lib/ask/types";
import type { Marker, Profile } from "@/lib/db/schema";
import { markerDef, PANELS, type Panel } from "@/lib/domain/markers";
import type { Persona } from "@/lib/domain/persona";
import type { dashboard } from "../dashboard";
import { localDate } from "../profile";
import { printedFor } from "../reports";
import { inputsChanged, isStaleBuild } from "../stack";

// Home, worked out once for both the web page (app/(platform)/(app)/home/page.tsx) and the
// apps (GET /api/home), so the two can't drift (the mobile repo's docs/API.md §3.2). These are
// the page's own derivations, moved here unchanged: the page renders homeView's result, and
// the route sends homeJson of the same result. Every word a health rule touches (the verdict,
// the doctor flags, the stack line) comes from here, never from either client.

type Dashboard = Awaited<ReturnType<typeof dashboard>>;
type Member = { user: { id: string; email: string }; profile: Profile; persona: Persona };

const dateText = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function greeting(tz: string | null) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz || "Asia/Kolkata" }).format(new Date()));
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// With nothing to take because a doctor comes first, home must not count "0 supplements".
// A stack built from meals alone (no report) says what it's from.
function stackLine(plan: { items: unknown[]; see_doctor: unknown[] } | null, fromMeals: boolean) {
  const n = plan?.items.length ?? 0;
  if (!n && plan?.see_doctor.length) return "See a doctor before adding anything. Your stack says why.";
  if (!n && fromMeals) return "Nothing to add from your food. A blood report checks what food can't show.";
  if (!n) return "Nothing to add. Your markers and your food don't point to any supplement.";
  if (fromMeals) return `${n} supplement${n === 1 ? "" : "s"}, each tied to a gap in what you eat. A blood report adds what food can't show.`;
  return `${n} supplement${n === 1 ? "" : "s"}, each tied to a marker or a gap in what you eat. Nothing else.`;
}

// Each stack line carries a stable code (HomeStackState) beside its words, so the apps pick their layout by it.
export function homeView({ user, profile, persona }: Member, data: Dashboard) {
  // "Ask about this" beside the markers that matter, for people Ask is open to.
  const ask = askGate({ email: user.email, onboardedAt: profile.onboardedAt, birthYear: profile.birthYear }) === "ok";
  const read = data.view?.read;
  const notes = new Map(read?.markers.map((m) => [m.id, m.note]) ?? []);
  const markers = data.view?.markers ?? [];

  // Metrics that matter: this persona's priority markers, in order, that this report has.
  const byKey = new Map(markers.filter((m) => m.key).map((m) => [m.key as string, m]));
  const priority = persona.priorities.map((k) => byKey.get(k)).filter((m): m is NonNullable<typeof m> => !!m);
  // Out-of-range markers that aren't priorities still deserve a spot.
  const extra = markers.filter((m) => (m.status === "low" || m.status === "high" || m.flag) && !priority.includes(m));
  const matter = [...priority.slice(0, 3), ...extra, ...priority.slice(3)].slice(0, 6);

  const panelOrder = Object.keys(PANELS) as Panel[];
  const contour: ContourMarker[] = [...markers]
    .filter((m) => m.value != null)
    .sort((a, b) => panelOrder.indexOf(markerDef(a.key)?.panel ?? "muscle") - panelOrder.indexOf(markerDef(b.key)?.panel ?? "muscle"))
    .map((m) => ({
      id: m.id,
      short: markerDef(m.key)?.short ?? m.name,
      name: markerDef(m.key)?.name ?? m.name,
      value: m.value,
      valueText: m.valueText,
      unit: m.unit,
      low: m.refLow,
      high: m.refHigh,
      status: m.status,
      range: rangeText(m),
    }));

  const t = data.target;
  // The retest counts down from the day the blood was taken (or the upload day).
  const retest =
    read && data.view ? retestFrom(data.view.collectedOn ?? localDate(profile.timezone, data.view.createdAt), read.retest.weeks, localDate(profile.timezone)) : null;
  const next = t ? `${t.name}` : retest ? retest.label : "Next: your first blood report";
  const nextDetail = t
    ? [t.startsOn ? dateText(t.startsOn) : "Dates to be announced", data.daysToTarget != null ? `${data.daysToTarget} days out` : null, t.city].filter(Boolean).join(", ")
    : read
      ? read.retest.why
      : "Upload a report and your bib gets its verdict.";
  const tone = read?.verdict.level ?? null;
  const isMock = data.view?.model === "mock";
  // The stack section: built from a report, from meals (before any report), or not yet.
  const stackReady = data.stack?.status === "ready";
  const fromMeals = !!data.stack && !data.stack.reportId;
  // One on its way (and not one that died partway): follow it, don't offer another.
  const stackBuilding = data.stack?.status === "building" && !isStaleBuild(data.stack.createdAt);
  const stackCopy: { state: HomeStackState; line: string; button: string } = stackBuilding
    ? { state: "building", line: "Building your stack…", button: "See progress" }
    : stackReady && read && fromMeals
      ? { state: "rebuild_report", line: "Your report is read. Rebuild your stack so it covers your markers too.", button: "Rebuild with my report" }
      : stackReady && read && data.stack!.reportId !== data.view!.id
        ? { state: "rebuild_newer", line: "A newer report is in. Rebuild your stack from it.", button: "Rebuild my stack" }
        : stackReady && inputsChanged(data.stack!.plan, profile)
          ? { state: "rebuild_profile", line: "Your diet, medicines or health details changed. Rebuild your stack so it fits them.", button: "Rebuild my stack" }
          : stackReady
            ? { state: "ready", line: stackLine(data.stack!.plan as { items: unknown[]; see_doctor: unknown[] } | null, fromMeals), button: "Open my stack" }
            : read
              ? { state: "build_report", line: "Built from this report and what you eat. Only what a marker or a real gap points to.", button: "Build my stack" }
              : data.foodReady
                ? { state: "build_meals", line: "Your meals are enough to start: we build it from what you eat, measured against your body and training. No report needed.", button: "Build my stack" }
                : { state: "start", line: "Log meals on 3 days, or describe a normal day, and we'll build it. No report needed.", button: "Start my stack" };
  // A friend's report tried on the app: say so, and offer the delete right here.
  const otherName = data.view ? printedFor(data.view.nameOnReport, profile.name) : null;
  const source = data.view
    ? data.view.collectedOn
      ? `collected ${dateText(data.view.collectedOn)}`
      : `uploaded ${dateText(localDate(profile.timezone, data.view.createdAt))}`
    : null;

  return {
    day: localDate(profile.timezone),
    greeting: greeting(profile.timezone),
    persona,
    ask,
    bib: { number: persona.bib, name: persona.firstName, label: persona.label, archetype: persona.archetype, next, nextDetail, retest: t && retest ? retest.label : null, tone },
    inProgress: data.inProgress ? { id: data.inProgress.id } : null,
    report:
      read && data.view
        ? {
            id: data.view.id,
            read,
            verdictLang: profile.language === "hi" ? ("hi" as const) : undefined,
            isMock,
            source: source as string,
            otherName,
            matter: matter.map((m, i) => ({ marker: m, note: i < 3 ? notes.get(m.id) : undefined, before: m.key ? data.prev.get(m.key) : undefined })),
            contour,
            retest,
          }
        : null,
    // The newest upload, when it failed. Shown only before any read, under the upload prompt.
    lastFailed: data.lastFailed,
    target: t ? { id: t.id, name: t.name, startsOn: t.startsOn, city: t.city, daysOut: data.daysToTarget } : null,
    fuel: data.today,
    yesterday: data.yesterday,
    events: {
      upcoming: data.upcoming.map((e) => ({ id: e.id, name: e.name, startsOn: e.startsOn, city: e.city, url: e.url, details: e.details })),
      pickedId: data.pickedId,
      targetId: t?.id ?? null,
    },
    stack: { ...stackCopy, id: data.stack?.id ?? null },
  };
}

export type HomeView = ReturnType<typeof homeView>;

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
