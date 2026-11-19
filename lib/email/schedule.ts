// When each lifecycle email is due, whether the caps allow it, and what the weekly email
// says: pure rules over clocks, dates and a person's past sends, so they're tested without
// a database. The daily job (./jobs.ts) fetches; these decide. Constants: ./types.ts.
// Design: docs/team/specs/2026-11-18-blog-and-email-architecture.md §3.2–3.5; caps and
// copy rules: docs/team/specs/2026-11-18-lifecycle-emails.md §4 and §6.

import { addDays, periodRange } from "../domain/periods.ts";
import type { WrapDay, WrapStats } from "../platform/wraps.ts";
import type { WeeklyExtras } from "./templates/index.ts";
import {
  CAPS,
  FEEDBACK_TIMING,
  SEND_WINDOW,
  WEEKLY_TIMING,
  WELCOME_CATCH_UP_HOURS,
  WELCOME_UNFINISHED_TIMING,
  type EmailKind,
  type FeedbackPath,
  type SendStatus,
  type WeeklyData,
} from "./types.ts";

export const DEFAULT_TZ = "Asia/Kolkata";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// ── Clocks ──────────────────────────────────────────────────────────────────

/** A moment as the person sees it: their date, "HH:MM" on a 24-hour clock, and the weekday (0 is Sunday). */
export type LocalClock = { zone: string; date: string; time: string; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(zone, f);
  }
  return f;
}

/** The person's clock at `now`, in their zone (IST when unset or unknown). */
export function localClock(tz: string | null | undefined, now: Date): LocalClock {
  let zone = tz || DEFAULT_TZ;
  let f: Intl.DateTimeFormat;
  try {
    f = formatter(zone);
  } catch {
    zone = DEFAULT_TZ;
    f = formatter(zone);
  }
  const parts = f.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const hour = part("hour") === "24" ? "00" : part("hour");
  return { zone, date, time: `${hour}:${part("minute")}`, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
}

/** 08:00 up to 21:30, their time. */
export const inSendWindow = (c: LocalClock) => c.time >= SEND_WINDOW.from && c.time < SEND_WINDOW.until;

// ── When each kind is due ───────────────────────────────────────────────────
// "due": send now. "wait": not now, maybe a later run. "expired": its time has passed for good.

export type DueState = "due" | "wait" | "expired";

/**
 * The week a weekly email would cover if one is due now: from Sunday 19:00 for Monday to
 * Sunday so far; on Monday, the week just ended (overflow or a missed Sunday run).
 */
export function weeklyDueWeek(c: LocalClock): { start: string; end: string } | null {
  if (!inSendWindow(c)) return null;
  if (c.weekday === WEEKLY_TIMING.dueWeekday && c.time >= WEEKLY_TIMING.dueFrom) return periodRange("week", c.date, 0);
  if (c.weekday === WEEKLY_TIMING.lastWeekday && c.time < WEEKLY_TIMING.lastUntil) return periodRange("week", c.date, -1);
  return null;
}

/** For the week starting on `weekStart` (its dedupe key). */
export function weeklyState(c: LocalClock, weekStart: string): DueState {
  if (weeklyDueWeek(c)?.start === weekStart) return "due";
  const lastDay = addDays(weekStart, 7); // the Monday after
  if (c.date > lastDay || (c.date === lastDay && c.time >= WEEKLY_TIMING.lastUntil)) return "expired";
  return "wait";
}

/** Day 10 after onboarding (their days), from 10:30, never on Sunday, for 4 days. */
export function feedbackState(c: LocalClock, onboardedOn: string): DueState {
  const days = daysBetween(onboardedOn, c.date);
  if (days >= FEEDBACK_TIMING.afterOnboardingDays + FEEDBACK_TIMING.windowDays) return "expired";
  if (days < FEEDBACK_TIMING.afterOnboardingDays) return "wait";
  if (!inSendWindow(c) || c.weekday === FEEDBACK_TIMING.skipWeekday || c.time < FEEDBACK_TIMING.dueFrom) return "wait";
  return "due";
}

/** The job's catch-up for an onboarding welcome that didn't go: for 48 hours, inside the window. */
export function welcomeState(c: LocalClock, onboardedAt: Date, now: Date): DueState {
  if (now.getTime() - onboardedAt.getTime() > WELCOME_CATCH_UP_HOURS * HOUR_MS) return "expired";
  return inSendWindow(c) ? "due" : "wait";
}

/** "Didn't finish setting up": from 24 hours after the account was made, up to 7 days, if onboarding is still open. */
export function unfinishedState(c: LocalClock, accountAt: Date, onboarded: boolean, now: Date): DueState {
  const age = now.getTime() - accountAt.getTime();
  if (onboarded || age > WELCOME_UNFINISHED_TIMING.maxAgeDays * DAY_MS) return "expired";
  if (age < WELCOME_UNFINISHED_TIMING.afterHours * HOUR_MS) return "wait";
  return inSendWindow(c) ? "due" : "wait";
}

// ── Caps ────────────────────────────────────────────────────────────────────

/** A lifecycle email someone already has (or, in a dry run, would have had). */
export type PastSend = {
  kind: EmailKind;
  dedupeKey: string;
  localDate: string;
  status: SendStatus;
  firstTapAt: Date | null;
  /** Feedback only: they answered that survey. */
  answered?: boolean;
};

/** Everything but a clear refusal may have reached the inbox, so it counts. */
export const mayHaveGone = (s: PastSend) => s.status !== "failed";

export type CapReason = "today" | "week" | "after_welcome" | "feedback_gap" | "feedback_year" | "feedback_unanswered";

/**
 * Why the caps hold this kind back today, or null. The welcome answers the person's own
 * action and is never held back; everything else: one a day, two in any 7 days, nothing
 * else for 3 days after a welcome, and the feedback cadence.
 */
export function capBlock(kind: EmailKind, past: readonly PastSend[], today: string): CapReason | null {
  if (kind === "welcome") return null;
  const gone = past.filter(mayHaveGone);
  const ago = (s: PastSend) => daysBetween(s.localDate, today);
  if (gone.filter((s) => ago(s) === 0).length >= CAPS.perLocalDay) return "today";
  if (gone.filter((s) => ago(s) >= 0 && ago(s) < 7).length >= CAPS.per7Days) return "week";
  if ((kind === "weekly" || kind === "feedback") && gone.some((s) => (s.kind === "welcome" || s.kind === "welcome_unfinished") && ago(s) >= 0 && ago(s) <= CAPS.quietDaysAfterWelcome))
    return "after_welcome";
  if (kind === "feedback") {
    const asks = gone.filter((s) => s.kind === "feedback").sort((a, b) => b.localDate.localeCompare(a.localDate));
    if (asks.some((s) => ago(s) < CAPS.feedbackMinGapDays)) return "feedback_gap";
    if (asks.filter((s) => ago(s) < 365).length >= CAPS.feedbackPerYear) return "feedback_year";
    const last = asks.slice(0, CAPS.feedbackStopAfterUnanswered);
    if (last.length >= CAPS.feedbackStopAfterUnanswered && last.every((s) => !s.answered)) return "feedback_unanswered";
  }
  return null;
}

/** The last 6 weekly emails all went untapped: pause the weekly email (UX spec §6 cap 7). */
export function shouldPauseWeekly(past: readonly PastSend[]): boolean {
  const last = past
    .filter((s) => s.kind === "weekly" && mayHaveGone(s))
    .sort((a, b) => b.dedupeKey.localeCompare(a.dedupeKey))
    .slice(0, CAPS.pauseWeeklyAfterUntapped);
  return last.length >= CAPS.pauseWeeklyAfterUntapped && last.every((s) => !s.firstTapAt);
}

// ── What the emails say ─────────────────────────────────────────────────────

/** "Used it": meals on 3 or more days, or a report read, in the first 10 days. Else "barely". */
export function feedbackPath(logDays: readonly string[], onboardedOn: string, reportRead: boolean): FeedbackPath {
  const last = addDays(onboardedOn, FEEDBACK_TIMING.afterOnboardingDays - 1);
  const days = new Set(logDays.filter((d) => d >= onboardedOn && d <= last));
  return days.size >= 3 || reportRead ? "used" : "barely";
}

/** "photo" when more than half the meals were logged by photo (and so on); "mixed" otherwise. */
export function loggedMostlyBy(by: WrapStats["loggedBy"]): WeeklyData["loggedMostlyBy"] {
  const total = by.photo + by.voice + by.text;
  if (!total) return null;
  for (const k of ["photo", "voice", "text"] as const) if (by[k] * 2 > total) return k;
  return "mixed";
}

export type WeeklyInput = {
  week: { start: string; end: string };
  /** wrapStatsFrom for this week: the same numbers the wrap is written from. */
  stats: Pick<WrapStats, "daysLogged" | "mealsLogged" | "proteinTargetHitDays" | "avgPerLoggedDay" | "topFoods" | "loggedBy" | "reportsInPeriod">;
  /** wrapDays for this week: 7 days, Monday first. */
  days: readonly Pick<WrapDay, "date" | "logged" | "proteinReached">[];
  lastWeekDaysLogged: number;
  /** Null when their weight isn't known: the target would rest on a default weight. */
  proteinTargetG: number | null;
  topFoodLang?: string;
  canLogMore: boolean;
  firstOfKind: boolean;
};

/**
 * The weekly email's data, or null when there's nothing to say (no meals and no report:
 * silence is an answer). Full from 3 days logged, light for 1 or 2, the report version
 * for a report and no meals. Counts only; never calories, weight or markers.
 */
export function weeklyData(input: WeeklyInput): (WeeklyData & WeeklyExtras) | null {
  const { stats, week } = input;
  const daysLogged = stats.daysLogged;
  const version: WeeklyData["version"] | null = daysLogged >= 3 ? "full" : daysLogged >= 1 ? "light" : stats.reportsInPeriod >= 1 ? "report" : null;
  if (!version) return null;
  const top = stats.topFoods[0];
  const last = input.lastWeekDaysLogged;
  return {
    weekStart: week.start,
    weekEnd: week.end,
    version,
    days: input.days.map((d) => ({ date: d.date, logged: d.logged, proteinReached: d.proteinReached })),
    daysLogged,
    mealsLogged: stats.mealsLogged,
    proteinReachedDays: stats.proteinTargetHitDays,
    proteinTargetG: input.proteinTargetG,
    avgProteinG: daysLogged > 0 ? stats.avgPerLoggedDay.proteinG : null,
    topFood: top && top.times >= 2 ? { title: top.title, times: top.times, ...(input.topFoodLang ? { lang: input.topFoodLang } : {}) } : null,
    loggedMostlyBy: loggedMostlyBy(stats.loggedBy),
    upFromDays: last >= 1 && daysLogged > last ? last : null,
    reportsRead: stats.reportsInPeriod,
    wrapUrl: `/wraps?week=${week.start}`,
    canLogMore: input.canLogMore,
    firstOfKind: input.firstOfKind,
  };
}
