// Lifecycle email's shared shapes and rules: the kinds, the settings, the send ledger's
// values, the timing, the caps, the daily budget, link tokens and the template contract.
// Types and constants only, so every lane (core, templates, jobs, feedback, settings)
// and the tests can import it. Tables: email_* and feedback_answers in lib/db/schema.ts.
// Design: docs/team/specs/2026-11-18-blog-and-email-architecture.md §3; copy and rules:
// docs/team/specs/2026-11-18-lifecycle-emails.md.
//
// Mayank's decisions of 2026-11-18 that live here: weekly and feedback emails are on by
// default; the weekly email goes on Sunday evening for Monday to Sunday so far; Vercel
// Hobby (daily crons only) and Resend's free plan until revenue starts; English only;
// no blood markers, values, flags or verdicts in any email.

// ── Kinds and settings ──────────────────────────────────────────────────────

/** Sign-in codes and payment receipts are account email: never recorded, capped or stoppable here. */
export const EMAIL_KINDS = ["welcome", "welcome_unfinished", "weekly", "feedback"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** The switches people have: the boolean columns of email_prefs. */
export const EMAIL_CATEGORIES = ["weekly", "questions"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** Which switch stops a kind; null for one-off welcomes, which carry no stop link or List-Unsubscribe. */
export const KIND_CATEGORY: Record<EmailKind, EmailCategory | null> = {
  welcome: null,
  welcome_unfinished: null,
  weekly: "weekly",
  feedback: "questions",
};

/** Without an email_prefs row a person gets these (Mayank: on by default, with the consent line and one-tap stop). */
export const DEFAULT_EMAIL_PREFS: Record<EmailCategory, boolean> = { weekly: true, questions: true };

export const PREFS_UPDATED_VIA = ["settings", "stop_link", "one_click", "complaint"] as const;
export type PrefsUpdatedVia = (typeof PREFS_UPDATED_VIA)[number];

/** email_sends.status. "unknown": no answer from Resend and too old to retry safely; never resent. */
export const SEND_STATUSES = ["sending", "sent", "failed", "unknown", "bounced", "complained", "suppressed"] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

export const SUPPRESSION_REASONS = ["bounce", "complaint", "resend"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/** English only (Mayank, 2026-11-18). */
export const EMAIL_LANGUAGE = "en";

// ── Dedupe and idempotency keys ─────────────────────────────────────────────
// email_sends is unique on (user_id, kind, dedupe_key):
//   welcome, welcome_unfinished → "once"
//   weekly   → the Monday that starts the week covered ("2026-11-16")
//   feedback → the survey id ("fb-1")

export const ONCE = "once";

/** Resend's Idempotency-Key for one send (kept by Resend for 24 h). */
export const sendIdempotencyKey = (kind: EmailKind, userId: string, dedupeKey: string) => `${kind}:${userId}:${dedupeKey}`;
/** For a batch call: rebuilding the batch must give the same payload, or Resend answers 409. */
export const batchIdempotencyKey = (batchId: string) => `batch:${batchId}`;

// ── Timing ──────────────────────────────────────────────────────────────────
// Vercel Hobby runs a cron once a day, anywhere in its hour. vercel.json (jobs lane) has:
//   "0 5 * * *"  → 05:00–05:59 UTC, 10:30–11:29 IST: welcomes caught up, unfinished
//                  nudges, feedback, Monday's weekly overflow, Sheet retries, housekeeping
//   "0 14 * * *" → 14:00–14:59 UTC, 19:30–20:29 IST: the weekly email on Sundays
// The job is time-agnostic: each run sends what is due now in each person's own time zone
// and inside SEND_WINDOW, so more runs later (Pro hourly) need no change here.

/** Local times as "HH:MM", in the person's profiles.timezone (Asia/Kolkata when unset). */
export const SEND_WINDOW = { from: "08:00", until: "21:30" } as const;

/**
 * The weekly email covers Monday to Sunday so far (periodRange("week", today, 0) on Sunday)
 * and is due from Sunday 19:00 local. Monday's runs take whatever didn't fit on Sunday
 * (overflow or a missed run), until Monday 21:30 local; after that the week is skipped.
 */
export const WEEKLY_TIMING = {
  dueWeekday: 0, // Sunday (Date#getDay)
  dueFrom: "19:00",
  lastWeekday: 1, // Monday
  lastUntil: "21:30",
} as const;

/** Day 10 after onboarding, from late morning (the morning run fires 10:30–11:29 IST). Never on Sunday, the weekly email's day. */
export const FEEDBACK_TIMING = { afterOnboardingDays: 10, dueFrom: "10:30", skipWeekday: 0, windowDays: 4 } as const;

/** 24 h after the account was made, if onboarding isn't finished; never for accounts older than 7 days. */
export const WELCOME_UNFINISHED_TIMING = { afterHours: 24, maxAgeDays: 7 } as const;

/** The onboarding-time welcome is retried by the job for this long. */
export const WELCOME_CATCH_UP_HOURS = 48;

// ── Caps (UX spec §6) ───────────────────────────────────────────────────────

export const CAPS = {
  perLocalDay: 1, // lifecycle emails per person per calendar day (theirs)
  per7Days: 2,
  quietDaysAfterWelcome: 3, // no weekly or feedback email this soon after the welcome
  feedbackMinGapDays: 90,
  feedbackPerYear: 3,
  feedbackStopAfterUnanswered: 2,
  pauseWeeklyAfterUntapped: 6,
} as const;

/** When two kinds are due for one person on one day, the first wins; the others wait. */
export const KIND_PRIORITY: readonly EmailKind[] = ["welcome", "welcome_unfinished", "weekly", "feedback"];

// ── Daily budget (Resend free: 100 a day, shared with sign-in codes) ────────
// Lifecycle sends allowed so far today (UTC day) =
//   min(EMAIL_DAILY_CAP or DEFAULT, RESEND_DAILY_LIMIT − max(sign-in codes today, SIGN_IN_RESERVE))
//   − lifecycle sends today.
// What doesn't fit rolls to the next run (Monday for Sunday's weekly). The founders get one
// alert a week when the weekly list reaches ALERT_AT of the cap, so they can upgrade first.

export const EMAIL_BUDGET = {
  dailyCapDefault: 70, // when EMAIL_DAILY_CAP is unset
  signInReserve: 30,
  resendDailyLimit: 100, // Resend free; raise with the plan (and EMAIL_DAILY_CAP)
  alertAt: 0.8,
} as const;

/** One-a-week markers in job_runs, e.g. alertJobKey("2026-11-16") = "alert:weekly-cap:2026-11-16". */
export const alertJobKey = (weekStart: string) => `alert:weekly-cap:${weekStart}`;

/** The daily job's lease row in job_runs. */
export const DAILY_JOB = "daily";

// ── Links ───────────────────────────────────────────────────────────────────
// v1.<base64url JSON payload>.<base64url HMAC-SHA-256>, keyed from EMAIL_LINK_SECRET with
// the purpose as a label. Person ids, never email addresses, go in links.

/** Stop links: never expire (old emails must keep working); can change only that person's email settings. */
export type StopTokenPayload = { p: "stop"; u: string; k: EmailCategory };
/** Feedback links: one person, one survey, 30 days (x is the expiry, seconds since 1970). */
export type FeedbackTokenPayload = { p: "fb"; u: string; s: string; x: number };
export type EmailTokenPayload = StopTokenPayload | FeedbackTokenPayload;
export const FEEDBACK_TOKEN_DAYS = 30;

// ── Templates ───────────────────────────────────────────────────────────────
// lib/email/templates/* (templates lane): pure functions, (data, frame) => RenderedEmail.
// No marker names, values, flags or verdicts, no calories and no weight in any field
// below (UX rules 4, 7, 8); the data types carry none, so a template can't show them.

export type RenderedEmail = { subject: string; preheader: string; html: string; text: string };

export type EmailFrame = {
  sendId: string; // email_sends.id, added as e= to every link to our site
  siteUrl: string; // https origin, e.g. https://www.d-human.fit
  email: string; // the footer's "why you got this" only
  firstName: string | null;
  stopUrl: string | null; // null for welcomes
  settingsUrl: string; // /settings#emails
  canReply: boolean; // Reply-To reaches a real inbox
};

export type EmailTemplate<D> = (data: D, frame: EmailFrame) => RenderedEmail;

export type WelcomeData = {
  bib: string; // the age, or "01"
  label: string; // persona label, e.g. "Regular runner"
  archetype: string; // which pictogram still
  proteinTargetG: number | null; // null when weight is unknown: leave the number out
};

export type WelcomeUnfinishedData = Record<string, never>;

export type WeekDay = { date: string; logged: boolean; proteinReached: boolean };

export type WeeklyData = {
  weekStart: string; // Monday
  weekEnd: string; // Sunday, the send day: its square shows what was logged by send time
  version: "full" | "light" | "report";
  days: WeekDay[]; // 7, Monday first
  daysLogged: number;
  mealsLogged: number;
  proteinReachedDays: number;
  proteinTargetG: number | null;
  avgProteinG: number | null; // on logged days; shown only as a neutral line
  topFood: { title: string; times: number; lang?: string } | null; // only when logged 2+ times
  loggedMostlyBy: "photo" | "voice" | "text" | "mixed" | null;
  upFromDays: number | null; // last week's days logged, only when this week is higher
  reportsRead: number; // a count; never what a report said
  wrapUrl: string; // /wraps?week=<weekStart>
};

// ── Feedback ────────────────────────────────────────────────────────────────

export const FEEDBACK_PATHS = ["used", "barely"] as const;
export type FeedbackPath = (typeof FEEDBACK_PATHS)[number];

export const FEEDBACK_SOURCES = ["email_tap", "page", "settings"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

/** Answers per question (UX spec §5). "build" options are Mayank's to confirm (UX decision 7). */
export const FEEDBACK_QUESTIONS = {
  feel: ["very", "somewhat", "not", "not_used"],
  use: ["meals", "report", "stack", "wraps", "nothing"],
  build: ["tests", "phone_signin", "languages", "retest_reminder", "wearables", "other"],
  nps: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  gotinway: ["too_slow", "numbers_off", "logs_ran_out", "no_report", "not_yet", "other"],
  text: null, // free text, up to FEEDBACK_TEXT_MAX
} as const;
export type FeedbackQuestion = keyof typeof FEEDBACK_QUESTIONS;
export const FEEDBACK_TEXT_MAX = 1_000;
/** Two different answers to one question this close together look like a link scanner: keep neither. */
export const FEEDBACK_CONFLICT_SECONDS = 10;
/** Answers can be changed this long after the email. */
export const FEEDBACK_OPEN_DAYS = 30;

export type FeedbackData = {
  path: FeedbackPath;
  survey: string; // "fb-1"
  question: "feel" | "gotinway"; // the one asked in the email
  options: { answer: string; label: string; url: string }[]; // each a link to /feedback?t=…&q=…&a=…
};
