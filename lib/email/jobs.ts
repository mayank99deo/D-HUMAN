import "server-only";
import { and, count, eq, exists, gt, gte, inArray, isNotNull, isNull, like, lt, lte, notExists, or, sql } from "drizzle-orm";
import { aiMode } from "@/lib/ai/client";
import { isOwnerEmail } from "@/lib/auth/owners";
import { keyMode } from "@/lib/billing/razorpay";
import { db, schema, type Db } from "@/lib/db";
import type { Profile } from "@/lib/db/schema";
import { PLAN } from "@/lib/domain/plan";
import { addDays } from "@/lib/domain/periods";
import { langTag } from "@/lib/domain/speech";
import { purgeAsks } from "@/lib/platform/ask";
import { personaFor } from "@/lib/platform/profile";
import { makeWrap, reportDay, wrapDays, wrapStatsFrom, wrapTargets, type WrapLog } from "@/lib/platform/wraps";
import { syncUsersSheet, summary as usersSheetSummary, type UsersSheetResult } from "@/lib/sheets/users";
import { dailyCap, shouldAlert, utcDay } from "./budget";
import { sendingAllowed } from "./client";
import { feedbackEmailOptions, syncFeedbackSheet, type SheetCatchUp } from "./feedback";
import { pauseWeekly } from "./prefs";
import {
  DEFAULT_TZ,
  capBlock,
  feedbackPath,
  feedbackState,
  inSendWindow,
  localClock,
  shouldPauseWeekly,
  unfinishedState,
  weeklyData,
  weeklyDueWeek,
  weeklyState,
  welcomeState,
  type DueState,
  type LocalClock,
  type PastSend,
} from "./schedule";
import {
  MAX_ATTEMPTS,
  SENDING_MAX_AGE_MS,
  budgetToday,
  retrySend,
  sendFounderAlert,
  sendLifecycle,
  sendLifecycleBatch,
  sendsToRetry,
  type BudgetToday,
  type LifecycleEmail,
  type SendOutcome,
} from "./send";
import { isOn } from "./switches";
import { renderEmail, type EmailToRender } from "./templates/index";
import { DAILY_JOB, DEFAULT_EMAIL_PREFS, EMAIL_BUDGET, ONCE, alertJobKey, type EmailKind, type FeedbackData, type FeedbackPath, type SendStatus, type WelcomeData } from "./types";

// The daily email job (architecture spec §3.3), run by two Vercel crons into
// /api/cron/daily: about 10:30 IST and about 19:30 IST. Each run sends whatever is due now
// in each person's own time zone, so more runs later need no change here.
//
//   1. A lease in job_runs, so a cron that fires twice (Vercel's may) runs once.
//   2. Retries: refused sends and unanswered ones (lane C's sweep rules).
//   3. Welcome catch-up, then "didn't finish setting up", the weekly email, feedback:
//      KIND_PRIORITY's order, so a short budget goes to the earlier kinds first.
//   4. Housekeeping: old sign-in codes, long-expired sessions, old dry-run rows, and Ask's
//      questions and counts from before today (IST; lib/platform/ask.ts purgeAsks).
//   5. The feedback Sheet's catch-up (lib/email/feedback.ts): forgets for deleted accounts
//      that the Sheet missed ("sheet-forget:" rows), then answers that didn't arrive.
//   6. The Sheet's Users tab (lib/sheets/users.ts): rows of deleted accounts removed
//      ("sheet-forget-user:" rows), then every account changed since the last sync, and
//      everyone once an Indian day (the first run is the backfill). Its own state and
//      result live in job_runs "sheet-users".
//   7. Counts (never addresses) in job_runs.last_result; the lease is released. A run
//      that failed anywhere tells the founders, once a UTC day (the step's name, no details).
// Steps 4 to 6 keep promises of their own (Ask's questions are kept for the day only, and
// deleted accounts leave the Sheet), so they run even when a step before them throws. From
// 2026-11-19 to 11-24 the retry sweep threw on every live run and nothing after it ran,
// housekeeping included.
//
// Switches (Vercel env, both off by default, so Mayank can watch a dry week first):
//   EMAIL_WEEKLY_LIVE=1     the weekly email sends; unset, the Sunday run is a dry run
//   EMAIL_LIFECYCLE_LIVE=1  welcome, "didn't finish" and feedback send; unset, dry runs
// A dry run picks, caps and renders exactly as a live one, sends nothing, makes no wraps
// (no AI spend), pauses no one, and records each email it would have sent as a job_runs
// row "dry:<kind>:<person>:<key>" (kept 14 days), so the next run doesn't count the same
// person twice and the caps see it. Lane C's rule still applies on top: nothing sends
// outside production (VERCEL_ENV=production, or EMAIL_SEND_LOCAL=1 locally).
// `?dry=1` on the route makes the whole run dry and read-only.

const { users, profiles, emailPrefs, emailSends, emailSuppressions, feedbackAnswers, foodLogs, reports, jobRuns, usage, payments, wraps, loginCodes, sessions } = schema;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A run's lease outlives the function's 300 s, so a killed run frees it before the next cron. */
const LEASE_MS = 6 * 60 * 1000;
/** Stop starting new work this long into a run (Hobby functions stop at 300 s). */
const TIME_BUDGET_MS = 240_000;
/** Pre-make wraps only this long into a run; past it, the email goes and the link makes the wrap on open. */
const PREMAKE_BUDGET_MS = 150_000;
const PREMAKE_PARALLEL = 6;
/** The first feedback survey (UX spec §5). */
export const FIRST_SURVEY = "fb-1";
const DRY_PREFIX = "dry:";
const DRY_KEEP_DAYS = 14;
/** Sign-in codes are only needed for 10 minutes; the rate limits look back a day. */
const LOGIN_CODES_KEEP_DAYS = 2;
const EXPIRED_SESSIONS_KEEP_DAYS = 7;

// ── Switches ────────────────────────────────────────────────────────────────

/** EMAIL_WEEKLY_LIVE: the weekly email sends. Off by default: the Sunday run is a dry run. */
export const weeklyLive = () => isOn(process.env.EMAIL_WEEKLY_LIVE);
/** EMAIL_LIFECYCLE_LIVE: welcome, "didn't finish" and feedback emails send. Off by default. */
export const lifecycleLive = () => isOn(process.env.EMAIL_LIFECYCLE_LIVE);

// ── Results (counts only) ───────────────────────────────────────────────────

type Tally = {
  due: number; // due now and inside the caps
  capped: number; // due, held back by a cap
  sent: number;
  wouldSend: number; // dry runs
  overBudget: number; // left for the next run
  failed: number;
  pending: number;
  unknown: number;
  skipped: number; // stopped, bounced or gone since it was picked
  duplicate: number; // another run or the onboarding save had it
  held: number; // not production, missing setup, or out of time
  renderFailed: number;
};
const tally = (): Tally => ({ due: 0, capped: 0, sent: 0, wouldSend: 0, overBudget: 0, failed: 0, pending: 0, unknown: 0, skipped: 0, duplicate: 0, held: 0, renderFailed: 0 });

export type RunResult = {
  status: "ok" | "busy" | "error";
  at: string;
  dry: boolean;
  live: { weekly: boolean; lifecycle: boolean };
  budget: BudgetToday | null;
  retries: { tried: number; sent: number; failed: number; pending: number; unknown: number; waiting: number; expired: number; held: number };
  welcome: Tally;
  welcome_unfinished: Tally;
  weekly: Tally & {
    weeks: string[];
    paused: number;
    versions: { full: number; light: number; report: number };
    wraps: { made: number; fresh: number; failed: number; notMade: number };
    alert: string | null;
  };
  feedback: Tally & { used: number; barely: number };
  /** askTurns and askDays: Ask's questions and per-person counts from before today (IST), deleted. */
  housekeeping: { loginCodes: number; sessions: number; dryRows: number; askTurns: number; askDays: number } | null;
  /** Null on dry runs; "skipped" when the run had no time left; "error" when it threw. */
  sheet: SheetCatchUp | "skipped" | "error" | null;
  /** The Sheet's Users tab, the same way. Its status says whether the Sheet took the rows. */
  usersSheet: UsersSheetResult | "skipped" | "error" | null;
  stoppedEarly: "time" | "not_production" | "no_api_key" | "no_link_secret" | null;
  error?: string;
  /** The step that threw. A throw in an email step stops the run's emails; housekeeping and the Sheet still run. */
  failedAt?: string;
  /** The founders' note about a failed run: "sent", or why it didn't go. */
  failureAlert?: string;
  ms: number;
};

function newResult(now: Date, dry: boolean, live: RunResult["live"]): RunResult {
  return {
    status: "ok",
    at: now.toISOString(),
    dry,
    live,
    budget: null,
    retries: { tried: 0, sent: 0, failed: 0, pending: 0, unknown: 0, waiting: 0, expired: 0, held: 0 },
    welcome: tally(),
    welcome_unfinished: tally(),
    weekly: { ...tally(), weeks: [], paused: 0, versions: { full: 0, light: 0, report: 0 }, wraps: { made: 0, fresh: 0, failed: 0, notMade: 0 }, alert: null },
    feedback: { ...tally(), used: 0, barely: 0 },
    housekeeping: null,
    sheet: null,
    usersSheet: null,
    stoppedEarly: null,
    ms: 0,
  };
}

// ── The dry-run ledger ──────────────────────────────────────────────────────
// What a dry run would have sent, as job_runs rows, so a later run behaves as if those
// emails had gone (no second "would send", and the caps count them). Live kinds ignore it.

type DryEntry = { kind: EmailKind; userId: string; dedupeKey: string; localDate: string };
const dryKey = (e: Pick<DryEntry, "kind" | "userId" | "dedupeKey">) => `${DRY_PREFIX}${e.kind}:${e.userId}:${e.dedupeKey}`;

class DryLedger {
  private entries = new Map<string, DryEntry>();
  private persist: boolean;
  /** Writes rows only where a live send could happen (production): elsewhere it's in memory, for this run. */
  constructor(persist: boolean) {
    this.persist = persist;
  }

  async load(d: Db) {
    const rows = await d.select({ job: jobRuns.job, result: jobRuns.lastResult }).from(jobRuns).where(like(jobRuns.job, `${DRY_PREFIX}%`));
    for (const r of rows) {
      const e = r.result as Partial<DryEntry> | null;
      if (e?.kind && e.userId && e.dedupeKey && e.localDate) this.entries.set(r.job, e as DryEntry);
    }
  }

  has(e: Pick<DryEntry, "kind" | "userId" | "dedupeKey">) {
    return this.entries.has(dryKey(e));
  }

  past(userId: string): PastSend[] {
    return [...this.entries.values()]
      .filter((e) => e.userId === userId)
      .map((e) => ({ kind: e.kind, dedupeKey: e.dedupeKey, localDate: e.localDate, status: "sent" as SendStatus, firstTapAt: null }));
  }

  /** Records a would-be send once, like the ledger's unique claim. False when it was already there. */
  async claim(d: Db, e: DryEntry, now: Date): Promise<boolean> {
    const key = dryKey(e);
    if (this.entries.has(key)) return false;
    if (this.persist) {
      const won = await d
        .insert(jobRuns)
        .values({ job: key, lastStartedAt: now, lastResult: { kind: e.kind, userId: e.userId, dedupeKey: e.dedupeKey, localDate: e.localDate } })
        .onConflictDoNothing()
        .returning({ job: jobRuns.job });
      if (!won.length) return false;
    }
    this.entries.set(key, e);
    return true;
  }
}

/** Old dry-run rows: every rule looks back at most 14 days for them. */
async function pruneDryRows(d: Db, now: Date): Promise<number> {
  const gone = await d
    .delete(jobRuns)
    .where(and(like(jobRuns.job, `${DRY_PREFIX}%`), lt(jobRuns.lastStartedAt, new Date(now.getTime() - DRY_KEEP_DAYS * DAY_MS))))
    .returning({ job: jobRuns.job });
  return gone.length;
}

// ── The lease ───────────────────────────────────────────────────────────────
// A row, not an advisory lock: a lock held for minutes would pin a pooled connection
// behind Supabase's transaction pooler. A run that dies frees it when the lease runs out.

async function takeLease(d: Db, now: Date): Promise<boolean> {
  await d.insert(jobRuns).values({ job: DAILY_JOB }).onConflictDoNothing();
  const won = await d
    .update(jobRuns)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS), lastStartedAt: now })
    .where(and(eq(jobRuns.job, DAILY_JOB), or(isNull(jobRuns.leaseUntil), lt(jobRuns.leaseUntil, now))))
    .returning({ job: jobRuns.job });
  return won.length > 0;
}

async function releaseLease(d: Db, result: RunResult, now: Date) {
  await d
    .update(jobRuns)
    .set({ leaseUntil: null, lastResult: result, ...(result.status === "ok" ? { lastOkAt: now } : {}) })
    .where(eq(jobRuns.job, DAILY_JOB));
}

// ── Shared queries ──────────────────────────────────────────────────────────

const tzExpr = sql<string>`coalesce(${profiles.timezone}, ${DEFAULT_TZ})`;
const one = sql`1`;
// The same hash as lib/email/suppress.ts: encode(sha256(convert_to(lower(email), 'UTF8')), 'hex').
const notSuppressed = (d: Db) =>
  notExists(
    d
      .select({ one })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.emailHash, sql`encode(sha256(convert_to(lower(${users.email}), 'UTF8')), 'hex')`)),
  );
const noSend = (d: Db, kinds: EmailKind[], dedupeKey: string) =>
  notExists(
    d
      .select({ one })
      .from(emailSends)
      .where(and(eq(emailSends.userId, users.id), inArray(emailSends.kind, kinds), eq(emailSends.dedupeKey, dedupeKey))),
  );

/**
 * Each person's lifecycle emails over the last 400 days (the caps look back a year), with
 * whether each feedback ask was answered. Uses the (user_id, …) prefix of
 * email_sends_dedupe_idx and feedback_answers_question_idx: a few dozen rows a person a year.
 */
async function pastSends(d: Db, userIds: string[], now: Date): Promise<Map<string, PastSend[]>> {
  const out = new Map<string, PastSend[]>();
  if (!userIds.length) return out;
  const since = addDays(now.toISOString().slice(0, 10), -400);
  const [rows, answered] = await Promise.all([
    d
      .select({ userId: emailSends.userId, kind: emailSends.kind, dedupeKey: emailSends.dedupeKey, localDate: emailSends.localDate, status: emailSends.status, firstTapAt: emailSends.firstTapAt })
      .from(emailSends)
      .where(and(inArray(emailSends.userId, userIds), gte(emailSends.localDate, since))),
    d
      .selectDistinct({ userId: feedbackAnswers.userId, survey: feedbackAnswers.survey })
      .from(feedbackAnswers)
      .where(and(inArray(feedbackAnswers.userId, userIds), isNotNull(feedbackAnswers.answer))),
  ]);
  const answers = new Set(answered.map((a) => `${a.userId}\u0000${a.survey}`));
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push({
      kind: r.kind as EmailKind,
      dedupeKey: r.dedupeKey,
      localDate: r.localDate,
      status: r.status as SendStatus,
      firstTapAt: r.firstTapAt,
      ...(r.kind === "feedback" ? { answered: answers.has(`${r.userId}\u0000${r.dedupeKey}`) } : {}),
    });
    out.set(r.userId, list);
  }
  return out;
}

// ── Building each email ─────────────────────────────────────────────────────

const render = (email: EmailToRender): LifecycleEmail["render"] => (frame) => renderEmail(email, frame);

export function welcomeData(profile: Profile): WelcomeData {
  const persona = personaFor(profile);
  // Without a weight the target rests on a default one, so the number is left out.
  const protein = profile.weightKg ? Math.round(wrapTargets(profile).proteinG) : null;
  return { bib: persona.bib, label: persona.label, archetype: persona.archetype, proteinTargetG: protein };
}

function welcomeEmail(profile: Profile, localDate: string): LifecycleEmail {
  return { userId: profile.userId, kind: "welcome", dedupeKey: ONCE, localDate, render: render({ kind: "welcome", data: welcomeData(profile) }) };
}

function unfinishedEmail(userId: string, localDate: string): LifecycleEmail {
  return { userId, kind: "welcome_unfinished", dedupeKey: ONCE, localDate, render: render({ kind: "welcome_unfinished", data: {} }) };
}

/**
 * The feedback email's data. The answer links come from the feedback lane: each opens
 * /feedback with that answer shown as chosen, and nothing is saved until the person confirms.
 * `origin` must be the one the send uses (lib/email/send.ts), so the tap id still gets added.
 */
export function feedbackData(userId: string, survey: string, path: FeedbackPath, localDate: string, origin?: string): FeedbackData {
  const question = path === "used" ? "feel" : "gotinway";
  // The token's 30 days run from their local midnight, so a retry renders the same email.
  const issuedAt = Date.parse(`${localDate}T00:00:00Z`);
  return { path, survey, question, options: feedbackEmailOptions(userId, survey, question, origin, issuedAt) };
}

function feedbackEmail(userId: string, survey: string, path: FeedbackPath, localDate: string, origin?: string): LifecycleEmail {
  return { userId, kind: "feedback", dedupeKey: survey, localDate, variant: path, render: render({ kind: "feedback", data: feedbackData(userId, survey, path, localDate, origin) }) };
}

type WeeklyPerson = { profile: Profile; past: PastSend[] };
type WeeklyBuilt = { email: LifecycleEmail; version: "full" | "light" | "report"; lastLogAt: Date | null };

/**
 * The weekly email for many people at once: their logs for this week and the one before,
 * their reports, meal uses and passes, in four grouped queries (food_logs_user_date_idx,
 * reports_user_idx, usage_user_idx, payments_user_idx), then the same pure functions as
 * the wrap, so the email and the wrap can't disagree. People with nothing to say are left out.
 */
async function weeklyEmails(d: Db, people: WeeklyPerson[], week: { start: string; end: string }, localDates: Map<string, string>, now: Date): Promise<Map<string, WeeklyBuilt>> {
  const out = new Map<string, WeeklyBuilt>();
  if (!people.length) return out;
  const ids = people.map((p) => p.profile.userId);
  const lastWeek = { start: addDays(week.start, -7), end: addDays(week.start, -1) };
  const [logs, readyReports, meals, passes] = await Promise.all([
    d
      .select({
        userId: foodLogs.userId,
        localDate: foodLogs.localDate,
        meal: foodLogs.meal,
        source: foodLogs.source,
        title: foodLogs.title,
        kcal: foodLogs.kcal,
        proteinG: foodLogs.proteinG,
        carbsG: foodLogs.carbsG,
        fatG: foodLogs.fatG,
        fibreG: foodLogs.fibreG,
        micros: foodLogs.micros,
        createdAt: foodLogs.createdAt,
      })
      .from(foodLogs)
      .where(and(inArray(foodLogs.userId, ids), gte(foodLogs.localDate, lastWeek.start), lte(foodLogs.localDate, week.end)))
      .orderBy(foodLogs.createdAt),
    d
      .select({ userId: reports.userId, collectedOn: reports.collectedOn, createdAt: reports.createdAt })
      .from(reports)
      .where(and(inArray(reports.userId, ids), eq(reports.status, "ready"))),
    d
      .select({ userId: usage.userId, n: count() })
      .from(usage)
      .where(and(inArray(usage.userId, ids), eq(usage.kind, "meal")))
      .groupBy(usage.userId),
    d
      .selectDistinct({ userId: payments.userId })
      .from(payments)
      .where(and(inArray(payments.userId, ids), eq(payments.status, "paid"), eq(payments.mode, keyMode()), lte(payments.startsAt, now), gt(payments.endsAt, now))),
  ]);
  const group = <T extends { userId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.userId, [...(m.get(r.userId) ?? []), r]);
    return m;
  };
  const logsBy = group(logs);
  const reportsBy = group(readyReports);
  const mealsUsed = new Map(meals.map((m) => [m.userId, m.n]));
  const withPass = new Set(passes.map((p) => p.userId));

  for (const { profile, past } of people) {
    const userId = profile.userId;
    const all: WrapLog[] = logsBy.get(userId) ?? [];
    const thisWeek = all.filter((l) => l.localDate >= week.start && l.localDate <= week.end);
    const targets = wrapTargets(profile);
    const reportsInWeek = (reportsBy.get(userId) ?? []).filter((r) => {
      const day = reportDay(r, profile.timezone);
      return day >= week.start && day <= week.end;
    }).length;
    const stats = wrapStatsFrom({ start: week.start, end: week.end, logs: thisWeek, targets, timezone: profile.timezone, reportsInPeriod: reportsInWeek });
    const lastWeekDays = new Set(all.filter((l) => l.localDate >= lastWeek.start && l.localDate <= lastWeek.end).map((l) => l.localDate)).size;
    const top = stats.topFoods[0];
    const topLog = top ? thisWeek.find((l) => l.title === top.title) : undefined;
    const data = weeklyData({
      week,
      stats,
      days: wrapDays(thisWeek, targets.proteinG, week.start, week.end),
      lastWeekDaysLogged: lastWeekDays,
      proteinTargetG: profile.weightKg ? Math.round(targets.proteinG) : null,
      topFoodLang: topLog ? langTag((topLog.micros as { lang?: string } | null)?.lang, topLog.title) : undefined,
      // Out of free meal logs and no pass: the email doesn't ask for more (UX decision 6).
      canLogMore: withPass.has(userId) || (mealsUsed.get(userId) ?? 0) < PLAN.freeMeals,
      firstOfKind: !past.some((s) => s.kind === "weekly" && s.status !== "failed" && s.dedupeKey !== week.start),
    });
    if (!data) continue;
    out.set(userId, {
      email: { userId, kind: "weekly", dedupeKey: week.start, localDate: localDates.get(userId)!, variant: data.version, render: render({ kind: "weekly", data }) },
      version: data.version,
      lastLogAt: thisWeek.at(-1)?.createdAt ?? null,
    });
  }
  return out;
}

// ── A run ───────────────────────────────────────────────────────────────────

export type RunOptions = {
  now?: Date;
  /** The whole run dry and read-only (`?dry=1`). */
  dry?: boolean;
  /** Gap between sends; lane C's default (4 a second) when unset. */
  paceMs?: number;
  origin?: string;
};

type Ctx = {
  d: Db;
  now: Date;
  started: number;
  readOnly: boolean;
  live: RunResult["live"];
  dry: DryLedger;
  /** What a dry run has left of today's budget, as if its emails had gone. */
  dryLeft: number;
  result: RunResult;
  opts: RunOptions;
};

const kindLive = (ctx: Ctx, kind: EmailKind) => (kind === "weekly" ? ctx.live.weekly : ctx.live.lifecycle);
const outOfTime = (ctx: Ctx) => Date.now() - ctx.started > TIME_BUDGET_MS;
const pastFor = (ctx: Ctx, kind: EmailKind, real: PastSend[] | undefined, userId: string) => [...(real ?? []), ...(kindLive(ctx, kind) ? [] : ctx.dry.past(userId))];

function countOutcome(t: Tally, o: SendOutcome) {
  if (o.status === "sent") t.sent++;
  else if (o.status === "budget") t.overBudget++;
  else if (o.status === "duplicate") t.duplicate++;
  else if (o.status === "skipped") t.skipped++;
  else if (o.status === "failed") t.failed++;
  else if (o.status === "pending") t.pending++;
  else if (o.status === "unknown") t.unknown++;
  else t.held++;
}

/** A frame for checking that a dry run's email renders: placeholders, no real links. */
const dryFrame = (ctx: Ctx, e: LifecycleEmail) => ({
  sendId: "dry",
  siteUrl: ctx.opts.origin ?? "https://www.d-human.fit",
  email: "",
  firstName: null,
  stopUrl: e.kind === "weekly" || e.kind === "feedback" ? "https://www.d-human.fit/email/stop?t=dry" : null,
  settingsUrl: "/settings#emails",
  canReply: false,
});

/** Sends the list (live) or records it (dry), in order, within the day's budget. */
async function deliver(ctx: Ctx, kind: EmailKind, emails: LifecycleEmail[], t: Tally): Promise<SendOutcome["status"][]> {
  if (!emails.length) return [];
  if (kindLive(ctx, kind)) {
    if (ctx.result.stoppedEarly || outOfTime(ctx)) {
      ctx.result.stoppedEarly ??= "time";
      t.held += emails.length;
      return emails.map(() => "not_configured");
    }
    const outcomes = await sendLifecycleBatch(emails, { now: ctx.now, origin: ctx.opts.origin, paceMs: ctx.opts.paceMs });
    for (const o of outcomes) {
      countOutcome(t, o);
      if (o.status === "not_configured") ctx.result.stoppedEarly ??= o.reason;
    }
    return outcomes.map((o) => o.status);
  }
  const statuses: SendOutcome["status"][] = [];
  for (const e of emails) {
    try {
      e.render(dryFrame(ctx, e));
    } catch (error) {
      console.error(`[email] dry run: ${kind} for ${e.userId} doesn't render:`, error instanceof Error ? error.message : error);
      t.renderFailed++;
      statuses.push("failed");
      continue;
    }
    if (ctx.dryLeft <= 0) {
      t.overBudget++;
      statuses.push("budget");
    } else if (await ctx.dry.claim(ctx.d, { kind, userId: e.userId, dedupeKey: e.dedupeKey, localDate: e.localDate }, ctx.now)) {
      t.wouldSend++;
      ctx.dryLeft--;
      statuses.push("sent");
    } else {
      t.duplicate++;
      statuses.push("duplicate");
    }
  }
  return statuses;
}

/**
 * One run of the daily job. Safe to call any number of times: a run that finds another
 * one holding the lease answers "busy" and does nothing, and every send is claimed once.
 */
export async function runDaily(opts: RunOptions = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const readOnly = !!opts.dry;
  const live = { weekly: !readOnly && weeklyLive(), lifecycle: !readOnly && lifecycleLive() };
  const result = newResult(now, readOnly, live);
  const d = await db();

  if (!readOnly && !(await takeLease(d, now))) {
    console.info("[email] daily run: another run holds the lease");
    return { ...result, status: "busy", ms: Date.now() - started };
  }
  const ctx: Ctx = { d, now, started, readOnly, live, dry: new DryLedger(!readOnly && sendingAllowed()), dryLeft: 0, result, opts };
  let step = "budget";
  const failed = (error: unknown) => {
    result.status = "error";
    result.error ??= (error instanceof Error ? error.message : String(error)).slice(0, 300);
    result.failedAt ??= step;
    console.error(`[email] daily run failed at ${step}:`, error);
  };
  try {
    try {
      const [budget] = await Promise.all([budgetToday(now), ctx.dry.load(d)]);
      result.budget = budget;
      ctx.dryLeft = budget.left;
      if (!readOnly) {
        step = "retries";
        await retries(ctx);
      }
      step = "welcome";
      await welcomes(ctx);
      step = "welcome_unfinished";
      await unfinished(ctx);
      step = "weekly";
      await weekly(ctx);
      step = "feedback";
      await feedback(ctx);
    } catch (error) {
      failed(error);
    }
    if (!readOnly) {
      try {
        step = "housekeeping";
        result.housekeeping = await housekeeping(d, now);
      } catch (error) {
        failed(error);
      }
      result.sheet = await feedbackSheet(ctx);
      result.usersSheet = await usersSheet(ctx);
      if (result.status === "error") result.failureAlert = await failureAlert(ctx);
    }
  } finally {
    result.ms = Date.now() - started;
    if (!readOnly) await releaseLease(d, result, now).catch((error) => console.error("[email] releasing the lease failed:", error));
  }
  console.info(`[email] daily run ${readOnly ? "(dry, read-only)" : ""}: ${summary(result)}`);
  return result;
}

/** One log line: counts only, never addresses. */
function summary(r: RunResult): string {
  const kinds = (["welcome", "welcome_unfinished", "weekly", "feedback"] as const).map((k) => {
    const t = r[k];
    const live = k === "weekly" ? r.live.weekly : r.live.lifecycle;
    return `${k} ${live ? "live" : "dry"} due ${t.due} ${live ? `sent ${t.sent}` : `would ${t.wouldSend}`} capped ${t.capped} over-budget ${t.overBudget}${t.failed ? ` failed ${t.failed}` : ""}`;
  });
  const users = r.usersSheet === null ? "" : typeof r.usersSheet === "string" ? `users sheet ${r.usersSheet}` : `users sheet ${usersSheetSummary(r.usersSheet)}`;
  return [`${r.status}`, r.failedAt ? `failed at ${r.failedAt}` : "", `budget left ${r.budget?.left ?? "?"}`, `retries ${r.retries.tried}`, ...kinds, sheetSummary(r.sheet), users, r.stoppedEarly ? `stopped: ${r.stoppedEarly}` : "", `${r.ms} ms`].filter(Boolean).join("; ");
}

/**
 * Tells the founders a run failed: once a UTC day (Resend's idempotency key), the step's
 * name only. The error itself stays in Vercel's logs and job_runs: a query error can carry
 * its parameters, and an email must never carry anyone's data. Goes whether or not the
 * live switches are on, since a broken job matters most during the dry week. Never throws.
 */
async function failureAlert(ctx: Ctx): Promise<string> {
  const { d, now, result } = ctx;
  const day = utcDay(now);
  // Once a day, like the weekly-cap alert: a marker row, freed again if the note doesn't go.
  const key = `alert:daily-failed:${day}`;
  const lines = [
    `The daily email job failed on ${day} (UTC), in its "${result.failedAt}" step.`,
    result.failedAt === "housekeeping"
      ? "Old sign-in codes and Ask's questions from before today may not have been deleted this run."
      : "Emails after that step wait for the next run. Housekeeping (old sign-in codes, Ask's questions from before today) still ran.",
    `The error is in Vercel's logs: search for "[email] daily run failed". The next run is at about 10:30 or 19:30 IST.`,
    "",
    "Sent at most once a day by the daily email job. No addresses or health data.",
  ];
  try {
    const [won] = await d.insert(jobRuns).values({ job: key, lastStartedAt: now }).onConflictDoNothing().returning({ job: jobRuns.job });
    if (!won) return "already_sent";
    const outcome = await sendFounderAlert({ key: `daily-failed:${day}`, subject: "D-Human: the daily email job failed", text: lines.join("\n") }, now);
    if (outcome.status !== "sent") await d.delete(jobRuns).where(eq(jobRuns.job, key));
    return outcome.status === "sent" ? "sent" : outcome.status === "failed" ? "failed" : outcome.reason;
  } catch (error) {
    console.error("[email] the failed-run note didn't go:", error instanceof Error ? error.message : error);
    return "failed";
  }
}

// ── 2. Retries ──────────────────────────────────────────────────────────────

async function retries(ctx: Ctx) {
  const { d, now, result } = ctx;
  const ids = await sendsToRetry(now);
  if (!ids.length) return;
  const rows = await d
    .select({ send: emailSends, profile: profiles, accountAt: users.createdAt })
    .from(emailSends)
    .innerJoin(users, eq(users.id, emailSends.userId))
    .leftJoin(profiles, eq(profiles.userId, emailSends.userId))
    .where(inArray(emailSends.id, ids));
  const past = await pastSends(d, [...new Set(rows.map((r) => r.send.userId))], now);
  const r = result.retries;
  const giveUp = (id: string, why: string) => d.update(emailSends).set({ attempts: MAX_ATTEMPTS, error: why }).where(and(eq(emailSends.id, id), eq(emailSends.status, "failed")));

  for (const { send, profile, accountAt } of rows) {
    if (outOfTime(ctx) || result.stoppedEarly) {
      r.held++;
      continue;
    }
    const kind = send.kind as EmailKind;
    const clock = localClock(profile?.timezone, now);
    const age = now.getTime() - (send.sentAt ?? send.createdAt).getTime();
    // An unanswered send this old can't be retried safely: lane C marks it "unknown", sending nothing.
    const settleOnly = send.status === "sending" && age > SENDING_MAX_AGE_MS;
    if (!settleOnly) {
      const state = dueFor(kind, send.dedupeKey, clock, profile, accountAt, now);
      if (send.status === "failed" && state === "expired") {
        await giveUp(send.id, "expired");
        r.expired++;
        continue;
      }
      // An unanswered send (same key, so Resend sends it at most once) only needs their waking hours.
      const ready = send.status === "sending" ? inSendWindow(clock) : state === "due";
      const others = (past.get(send.userId) ?? []).filter((s) => !(s.kind === kind && s.dedupeKey === send.dedupeKey));
      if (!ready || !kindLive(ctx, kind) || (send.status === "failed" && capBlock(kind, others, clock.date))) {
        r.waiting++;
        continue;
      }
    }
    // Settling never renders: lane C marks the row before it would.
    const email = settleOnly ? { render: notRendered } : await rebuild(ctx, send, profile, past.get(send.userId) ?? []);
    if (!email) {
      await giveUp(send.id, "nothing_to_say");
      r.expired++;
      continue;
    }
    r.tried++;
    const outcome = await retrySend(send.id, email.render, { now, origin: ctx.opts.origin });
    if (outcome.status === "sent") r.sent++;
    else if (outcome.status === "failed") r.failed++;
    else if (outcome.status === "pending") r.pending++;
    else if (outcome.status === "unknown") r.unknown++;
    else if (outcome.status === "not_configured") result.stoppedEarly ??= outcome.reason;
    if (outcome.status === "budget") break;
  }
}

function dueFor(kind: EmailKind, dedupeKey: string, clock: LocalClock, profile: Profile | null, accountAt: Date, now: Date): DueState {
  switch (kind) {
    case "welcome":
      return profile?.onboardedAt ? welcomeState(clock, profile.onboardedAt, now) : "expired";
    case "welcome_unfinished":
      return unfinishedState(clock, accountAt, !!profile?.onboardedAt, now);
    case "weekly":
      return weeklyState(clock, dedupeKey);
    case "feedback":
      return profile?.onboardedAt ? feedbackState(clock, localClock(profile.timezone, profile.onboardedAt).date) : "expired";
  }
}

const notRendered: LifecycleEmail["render"] = () => {
  throw new Error("a send being settled is never rendered");
};

/** The same email again for a ledger row (same data, so the same payload when nothing changed). */
async function rebuild(ctx: Ctx, send: typeof emailSends.$inferSelect, profile: Profile | null, past: PastSend[]): Promise<LifecycleEmail | null> {
  if (send.kind === "welcome_unfinished") return unfinishedEmail(send.userId, send.localDate);
  if (!profile) return null;
  switch (send.kind as EmailKind) {
    case "welcome":
      return welcomeEmail(profile, send.localDate);
    case "feedback":
      return feedbackEmail(send.userId, send.dedupeKey, send.variant === "barely" ? "barely" : "used", send.localDate, ctx.opts.origin);
    case "weekly": {
      const week = { start: send.dedupeKey, end: addDays(send.dedupeKey, 6) };
      const built = await weeklyEmails(ctx.d, [{ profile, past }], week, new Map([[send.userId, send.localDate]]), ctx.now);
      return built.get(send.userId)?.email ?? null;
    }
    default:
      return null;
  }
}

// ── 3a. Welcome catch-up ────────────────────────────────────────────────────
// The welcome goes from the onboarding save (sendWelcome, in after()); this catches any
// that didn't, for 48 hours. Older accounts never get one: no backfill.

async function welcomes(ctx: Ctx) {
  const { d, now, result } = ctx;
  const t = result.welcome;
  const rows = await d
    .select({ profile: profiles })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(gte(profiles.onboardedAt, new Date(now.getTime() - 48 * 60 * 60 * 1000)), lte(profiles.onboardedAt, now), noSend(d, ["welcome"], ONCE), notSuppressed(d)))
    .orderBy(profiles.onboardedAt);
  const emails: LifecycleEmail[] = [];
  for (const { profile } of rows) {
    const clock = localClock(profile.timezone, now);
    if (welcomeState(clock, profile.onboardedAt!, now) !== "due") continue;
    if (!kindLive(ctx, "welcome") && ctx.dry.has({ kind: "welcome", userId: profile.userId, dedupeKey: ONCE })) continue;
    t.due++;
    emails.push(welcomeEmail(profile, clock.date));
  }
  await deliver(ctx, "welcome", emails, t);
}

/**
 * The welcome, sent from the onboarding save when onboarding finishes the first time (in
 * after(), so it never holds up the save). Off until EMAIL_LIFECYCLE_LIVE is on: then it
 * only notes the dry run. Never throws.
 */
export async function sendWelcome(profile: Profile, now = new Date()): Promise<SendOutcome["status"] | "dry" | "error"> {
  try {
    const email = welcomeEmail(profile, localClock(profile.timezone, now).date);
    if (!lifecycleLive()) {
      if (sendingAllowed()) await new DryLedger(true).claim(await db(), { kind: "welcome", userId: profile.userId, dedupeKey: ONCE, localDate: email.localDate }, now);
      console.info(`[email] welcome ${profile.userId}: dry run, not sent (EMAIL_LIFECYCLE_LIVE is off)`);
      return "dry";
    }
    const outcome = await sendLifecycle(email, { now });
    console.info(`[email] welcome ${profile.userId}: ${outcome.status}`);
    return outcome.status;
  } catch (error) {
    console.error(`[email] welcome ${profile.userId} failed:`, error instanceof Error ? error.message : error);
    return "error";
  }
}

// ── 3b. "Didn't finish setting up" ──────────────────────────────────────────

async function unfinished(ctx: Ctx) {
  const { d, now, result } = ctx;
  const t = result.welcome_unfinished;
  // users.created_at has no index: a scan of users, fine until about 100x (then index it).
  const rows = await d
    .select({ userId: users.id, email: users.email, accountAt: users.createdAt, timezone: profiles.timezone })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        gte(users.createdAt, new Date(now.getTime() - 7 * DAY_MS)),
        lte(users.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        isNull(profiles.onboardedAt),
        noSend(d, ["welcome", "welcome_unfinished"], ONCE),
        notSuppressed(d),
      ),
    )
    .orderBy(users.createdAt);
  const due = rows
    // The blog's writers sign in for /write, which needs no onboarding: never nudge them.
    .filter((r) => !isOwnerEmail(r.email))
    .map((r) => ({ ...r, clock: localClock(r.timezone, now) }))
    .filter((r) => unfinishedState(r.clock, r.accountAt, false, now) === "due")
    .filter((r) => kindLive(ctx, "welcome_unfinished") || !ctx.dry.has({ kind: "welcome_unfinished", userId: r.userId, dedupeKey: ONCE }));
  const past = await pastSends(d, due.map((r) => r.userId), now);
  const emails: LifecycleEmail[] = [];
  for (const r of due) {
    if (capBlock("welcome_unfinished", pastFor(ctx, "welcome_unfinished", past.get(r.userId), r.userId), r.clock.date)) {
      t.capped++;
      continue;
    }
    t.due++;
    emails.push(unfinishedEmail(r.userId, r.clock.date));
  }
  await deliver(ctx, "welcome_unfinished", emails, t);
}

// ── 3c. The weekly email ────────────────────────────────────────────────────

async function weekly(ctx: Ctx) {
  const { d, now, result } = ctx;
  const t = result.weekly;
  const live = ctx.live.weekly;

  // Each time zone has its own week; most people share one (IST).
  const zones = await d.selectDistinct({ tz: tzExpr }).from(profiles).where(isNotNull(profiles.onboardedAt));
  const groups = new Map<string, { week: { start: string; end: string }; zones: string[] }>();
  for (const { tz } of zones) {
    const week = weeklyDueWeek(localClock(tz, now));
    if (!week) continue;
    const g = groups.get(week.start) ?? { week, zones: [] };
    g.zones.push(tz);
    groups.set(week.start, g);
  }

  for (const { week, zones: zoneList } of groups.values()) {
    t.weeks.push(week.start);
    const range = { from: new Date(Date.parse(`${week.start}T00:00:00Z`) - DAY_MS), to: new Date(Date.parse(`${week.end}T00:00:00Z`) + 2 * DAY_MS) };
    // Active this week: a meal logged, or a report that counts in the week's wrap (taken or,
    // without a date, uploaded in it; the exact day is checked in code, in their zone).
    const rows = await d
      .select({ profile: profiles })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .leftJoin(emailPrefs, eq(emailPrefs.userId, profiles.userId))
      .where(
        and(
          isNotNull(profiles.onboardedAt),
          inArray(tzExpr, zoneList),
          sql`coalesce(${emailPrefs.weekly}, ${sql.raw(DEFAULT_EMAIL_PREFS.weekly ? "true" : "false")})`,
          isNull(emailPrefs.weeklyPausedAt),
          notSuppressed(d),
          noSend(d, ["weekly"], week.start),
          or(
            exists(
              d
                .select({ one })
                .from(foodLogs)
                .where(and(eq(foodLogs.userId, profiles.userId), gte(foodLogs.localDate, week.start), lte(foodLogs.localDate, week.end))),
            ),
            exists(
              d
                .select({ one })
                .from(reports)
                .where(
                  and(
                    eq(reports.userId, profiles.userId),
                    eq(reports.status, "ready"),
                    or(
                      and(gte(reports.collectedOn, week.start), lte(reports.collectedOn, week.end)),
                      and(isNull(reports.collectedOn), gte(reports.createdAt, range.from), lt(reports.createdAt, range.to)),
                    ),
                  ),
                ),
            ),
          ),
        ),
      )
      .orderBy(profiles.userId);

    const candidates = rows.map((r) => r.profile).filter((p) => live || !ctx.dry.has({ kind: "weekly", userId: p.userId, dedupeKey: week.start }));
    const past = await pastSends(d, candidates.map((p) => p.userId), now);
    const eligible: WeeklyPerson[] = [];
    const localDates = new Map<string, string>();
    for (const profile of candidates) {
      const mine = pastFor(ctx, "weekly", past.get(profile.userId), profile.userId);
      if (shouldPauseWeekly(mine)) {
        // Six in a row untapped: stop until they turn it back on (Settings says so).
        if (live) await pauseWeekly(profile.userId, now);
        t.paused++;
        continue;
      }
      const today = localClock(profile.timezone, now).date;
      if (capBlock("weekly", mine, today)) {
        t.capped++;
        continue;
      }
      eligible.push({ profile, past: mine });
      localDates.set(profile.userId, today);
    }

    const built = await weeklyEmails(d, eligible, week, localDates, now);
    const due = eligible.filter((p) => built.has(p.profile.userId));
    t.due += due.length;
    if (shouldAlert(due.length)) t.alert = await capAlert(ctx, week.start, due.length);

    // Only those today's budget can take get a wrap made; the rest go on the next run.
    const left = live ? (await budgetToday(now)).left : ctx.dryLeft;
    const fits = due.slice(0, Math.max(0, left));
    if (live && sendingAllowed()) await premake(ctx, fits.map((p) => ({ profile: p.profile, lastLogAt: built.get(p.profile.userId)!.lastLogAt })), week);
    else t.wraps.notMade += fits.length;

    const emails = due.map((p) => built.get(p.profile.userId)!);
    const statuses = await deliver(ctx, "weekly", emails.map((b) => b.email), t);
    statuses.forEach((s, i) => {
      if (s === "sent") t.versions[emails[i].version]++;
    });
  }
}

/** Makes each recipient's wrap ahead, 6 at a time, within 150 s of the run; skips fresh ones. */
async function premake(ctx: Ctx, people: { profile: Profile; lastLogAt: Date | null }[], week: { start: string; end: string }) {
  const w = ctx.result.weekly.wraps;
  if (!people.length) return;
  if (aiMode() === "off") {
    w.notMade += people.length;
    return;
  }
  const existing = await ctx.d
    .select({ userId: wraps.userId, createdAt: wraps.createdAt })
    .from(wraps)
    .where(and(inArray(wraps.userId, people.map((p) => p.profile.userId)), eq(wraps.period, "week"), eq(wraps.startsOn, week.start)));
  const madeAt = new Map(existing.map((x) => [x.userId, x.createdAt]));
  // A wrap made after the week's last meal already says everything: don't pay for it twice.
  const queue = people.filter((p) => {
    const at = madeAt.get(p.profile.userId);
    const fresh = !!at && (!p.lastLogAt || at >= p.lastLogAt);
    if (fresh) w.fresh++;
    return !fresh;
  });
  const until = ctx.started + PREMAKE_BUDGET_MS;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      if (Date.now() > until) {
        w.notMade++;
        continue;
      }
      try {
        await makeWrap(p.profile.userId, p.profile, "week", week.start, week.end);
        w.made++;
      } catch (error) {
        w.failed++;
        console.error(`[email] pre-making a wrap for ${p.profile.userId} failed:`, error instanceof Error ? error.message : error);
      }
    }
  };
  await Promise.all(Array.from({ length: PREMAKE_PARALLEL }, worker));
}

/**
 * Once a week, when the weekly list reaches 80% of the day's cap: tells the founders, so
 * they can move to Resend Pro before people miss their wrap. Live weekly emails only.
 */
async function capAlert(ctx: Ctx, weekStart: string, due: number): Promise<string> {
  if (!ctx.live.weekly) return "would_send";
  const key = alertJobKey(weekStart);
  const [won] = await ctx.d.insert(jobRuns).values({ job: key, lastStartedAt: ctx.now }).onConflictDoNothing().returning({ job: jobRuns.job });
  if (!won) return "already_sent";
  const cap = dailyCap();
  const left = (await budgetToday(ctx.now)).left;
  const lines = [
    `This week's wrap email is due to ${due} people.`,
    `Today's email budget has room for ${Math.min(due, left)} of them: lifecycle email is capped at ${cap} a day, and ${EMAIL_BUDGET.signInReserve} of Resend's free ${EMAIL_BUDGET.resendDailyLimit} a day stay free for sign-in codes.`,
  ];
  if (due > left) lines.push(`The other ${due - left} go on Monday's run. A week with more than about ${cap * 2} people skips the rest.`);
  lines.push("Resend Pro ($20 a month) removes the daily limit. After upgrading, raise EMAIL_DAILY_CAP in Vercel.", "", "Sent once a week by the daily email job. Counts only.");
  const outcome = await sendFounderAlert({ key: `weekly-cap:${weekStart}`, subject: "D-Human: the weekly email list is nearing the daily limit", text: lines.join("\n") }, ctx.now);
  if (outcome.status !== "sent") {
    // Not sent: free the marker so a later run can try again.
    await ctx.d.delete(jobRuns).where(eq(jobRuns.job, key));
    return outcome.status === "failed" ? "failed" : outcome.reason;
  }
  return "sent";
}

// ── 3d. Feedback ────────────────────────────────────────────────────────────

async function feedback(ctx: Ctx) {
  const { d, now, result } = ctx;
  const t = result.feedback;
  const survey = FIRST_SURVEY;
  // Broad in UTC (day 9 to day 15); the exact day 10–13 is checked in their own zone.
  const rows = await d
    .select({ profile: profiles })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .leftJoin(emailPrefs, eq(emailPrefs.userId, profiles.userId))
    .where(
      and(
        gte(profiles.onboardedAt, new Date(now.getTime() - 15 * DAY_MS)),
        lte(profiles.onboardedAt, new Date(now.getTime() - 9 * DAY_MS)),
        sql`coalesce(${emailPrefs.questions}, ${sql.raw(DEFAULT_EMAIL_PREFS.questions ? "true" : "false")})`,
        notSuppressed(d),
        noSend(d, ["feedback"], survey),
      ),
    )
    .orderBy(profiles.onboardedAt);

  const due = rows
    .map(({ profile }) => ({ profile, clock: localClock(profile.timezone, now), onboardedOn: localClock(profile.timezone, profile.onboardedAt!).date }))
    .filter((r) => feedbackState(r.clock, r.onboardedOn) === "due")
    .filter((r) => kindLive(ctx, "feedback") || !ctx.dry.has({ kind: "feedback", userId: r.profile.userId, dedupeKey: survey }));
  if (!due.length) return;

  const ids = due.map((r) => r.profile.userId);
  const firstDay = due.map((r) => r.onboardedOn).sort()[0];
  const earliest = due.map((r) => r.profile.onboardedAt!.getTime()).sort((a, b) => a - b)[0];
  const [past, logDays, reads] = await Promise.all([
    pastSends(d, ids, now),
    d
      .selectDistinct({ userId: foodLogs.userId, localDate: foodLogs.localDate })
      .from(foodLogs)
      .where(and(inArray(foodLogs.userId, ids), gte(foodLogs.localDate, firstDay))),
    d
      .select({ userId: reports.userId, analyzedAt: reports.analyzedAt })
      .from(reports)
      .where(and(inArray(reports.userId, ids), gte(reports.analyzedAt, new Date(earliest)))),
  ]);

  const emails: LifecycleEmail[] = [];
  for (const { profile, clock, onboardedOn } of due) {
    if (capBlock("feedback", pastFor(ctx, "feedback", past.get(profile.userId), profile.userId), clock.date)) {
      t.capped++;
      continue;
    }
    const firstTen = profile.onboardedAt!.getTime() + 10 * DAY_MS;
    const read = reads.some((r) => r.userId === profile.userId && r.analyzedAt && r.analyzedAt.getTime() < firstTen);
    const path = feedbackPath(logDays.filter((l) => l.userId === profile.userId).map((l) => l.localDate), onboardedOn, read);
    t.due++;
    t[path]++;
    emails.push(feedbackEmail(profile.userId, survey, path, clock.date, ctx.opts.origin));
  }
  await deliver(ctx, "feedback", emails, t);
}

function sheetSummary(sheet: RunResult["sheet"]): string {
  if (sheet === null) return "";
  if (typeof sheet === "string") return `sheet ${sheet}`;
  const copy = sheet.sync.status === "ok" ? `copied ${sheet.sync.marked}/${sheet.sync.sent}` : sheet.sync.status === "failed" ? `copy failed (${sheet.sync.pending} waiting)` : "not configured";
  return `sheet forgets ${sheet.forgotten} (${sheet.forgetsPending} waiting), ${copy}`;
}

// ── 4. Housekeeping ─────────────────────────────────────────────────────────

async function housekeeping(d: Db, now: Date) {
  const [codes, expired, dryRows, asks] = await Promise.all([
    d.delete(loginCodes).where(lt(loginCodes.createdAt, new Date(now.getTime() - LOGIN_CODES_KEEP_DAYS * DAY_MS))).returning({ id: loginCodes.id }),
    d.delete(sessions).where(lt(sessions.expiresAt, new Date(now.getTime() - EXPIRED_SESSIONS_KEEP_DAYS * DAY_MS))).returning({ id: sessions.id }),
    pruneDryRows(d, now),
    // Ask keeps questions for the IST day only (contract §11): yesterday's words go by about 10:30 IST.
    purgeAsks(d, now),
  ]);
  return { loginCodes: codes.length, sessions: expired.length, dryRows, askTurns: asks.askTurns, askDays: asks.askDays };
}

// ── 5. The feedback Sheet ───────────────────────────────────────────────────
// The Sheet is a copy for the founders; Postgres is the record. Answers are copied after
// each save; this catches what the Sheet missed. It runs last, as no email waits on it, and
// stops at the run's time budget, so a slow Sheet can't keep the function past its limit.

async function feedbackSheet(ctx: Ctx): Promise<RunResult["sheet"]> {
  if (outOfTime(ctx)) return "skipped";
  try {
    return await syncFeedbackSheet({ now: ctx.now, deadline: ctx.started + TIME_BUDGET_MS });
  } catch (error) {
    // The emails have gone by now; a database hiccup here shouldn't mark the run failed.
    console.error("[email] feedback sheet catch-up failed:", error instanceof Error ? error.message : error);
    return "error";
  }
}

// ── 6. The Users tab ────────────────────────────────────────────────────────
// Last, as no email waits on it. A Sheet that is down or not yet updated is a status in its
// result, not a failed run; only a database error here throws, and even that doesn't mark
// the run failed (the emails have gone). Stops at the run's time budget.

async function usersSheet(ctx: Ctx): Promise<RunResult["usersSheet"]> {
  if (outOfTime(ctx)) return "skipped";
  try {
    return await syncUsersSheet({ now: ctx.now, deadline: ctx.started + TIME_BUDGET_MS });
  } catch (error) {
    // The class only: a query error's message carries its parameters (account ids).
    console.error(`[email] users sheet sync failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return "error";
  }
}
