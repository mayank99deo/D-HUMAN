// The founders' email status page (/write/status), as words: what each recent sign-up's
// welcome or "finish setting up" email did and why, what the daily job last did, and the
// day's budget. Pure: the loader (./status.ts) fetches facts; this turns them into lines.
//
// Data use: masked addresses (ab•••@gmail.com), dates, statuses and counts. Nothing about
// anyone's health, and no email's words. Error text is cut before any query parameters.

import { SEND_WINDOW, WELCOME_CATCH_UP_HOURS, WELCOME_UNFINISHED_TIMING, type EmailKind } from "./types.ts";

const HOUR_MS = 60 * 60 * 1000;
/** A "sending" row this old had no answer from Resend (lib/email/send.ts SENDING_GRACE_MS). */
const NO_ANSWER_MS = 10 * 60 * 1000;
const ZONE = "Asia/Kolkata";

// ── Small helpers ───────────────────────────────────────────────────────────

/** "ab•••@gmail.com": the first two letters (one for a very short name) and the domain. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  const local = email.slice(0, at);
  return `${local.slice(0, local.length <= 2 ? 1 : 2)}•••${email.slice(at)}`;
}

const EMAIL_IN_TEXT = /[^\s@<>"',;:()]+@[^\s@<>"',;:()]+\.[^\s@<>"',;:()]+/g;

/** Error text safe to show: the first line, nothing from "params:" on, addresses masked, at most 160 characters. */
export function cleanError(text: string | null | undefined): string | null {
  if (!text) return null;
  const firstLine = text.split(/params:/i)[0].split("\n")[0].trim();
  const masked = firstLine.replace(EMAIL_IN_TEXT, (m) => maskEmail(m));
  return masked.length > 160 ? `${masked.slice(0, 159)}…` : masked || null;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

/** "25 Nov, 14:32" in IST. */
export function istTime(d: Date | null | undefined): string {
  if (!d) return "never";
  const parts = timeFormat.formatToParts(d);
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("day")} ${p("month")}, ${p("hour")}:${p("minute")}`;
}

/** "16 Nov" for a YYYY-MM-DD day. */
export const shortDay = (day: string) => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? dayFormat.format(new Date(`${day}T00:00:00Z`)) : day);

// ── Each email's state ──────────────────────────────────────────────────────

/** done: it went. wait: it will, or may. dry: held by a switch. problem: it didn't and won't by itself. none: not due. */
export type Tone = "done" | "wait" | "dry" | "problem" | "none";
export type Cell = { tone: Tone; label: string; detail?: string };

/** One email_sends row, as the page needs it. */
export type SendFacts = { status: string; sentAt: Date | null; createdAt: Date; hasProviderId: boolean; error: string | null; attempts: number };

export type StatusContext = { now: Date; lifecycleLive: boolean; budgetLeft: number; maxAttempts: number };

const NEXT_RUN = `The next daily run sends it: about 10:30 or 19:30 IST, between ${SEND_WINDOW.from} and ${SEND_WINDOW.until} their time`;
const budgetNote = (ctx: StatusContext) => (ctx.budgetLeft <= 0 ? "Today's email budget is used up, so it waits for tomorrow's run" : null);
const join = (...lines: (string | null | undefined)[]) => lines.filter(Boolean).join(". ") || undefined;

/** What a ledger row says, in words. */
export function sendCell(send: SendFacts, ctx: StatusContext): Cell {
  const at = istTime(send.sentAt ?? send.createdAt);
  switch (send.status) {
    case "delivered":
      return { tone: "done", label: "Delivered", detail: `Sent ${at}; their mail server took it` };
    case "sent":
      return { tone: "done", label: "Sent", detail: `Resend took it ${at}. "Delivered" shows once Resend reports it` };
    case "sending":
      return ctx.now.getTime() - (send.sentAt ?? send.createdAt).getTime() > NO_ANSWER_MS
        ? { tone: "wait", label: "No answer yet", detail: `Resend didn't answer at ${at}. The next run asks again, so it can't go twice` }
        : { tone: "wait", label: "Sending", detail: `Started ${at}` };
    case "failed": {
      const gaveUp = send.attempts >= ctx.maxAttempts;
      return {
        tone: "problem",
        label: gaveUp ? "Failed, gave up" : "Failed",
        detail: join(cleanError(send.error) ?? "Resend refused it", gaveUp ? `Tried ${send.attempts} times` : `Try ${send.attempts} of ${ctx.maxAttempts}; the next run tries again`),
      };
    }
    case "unknown":
      return { tone: "problem", label: "Unknown", detail: join(`No clear answer from Resend at ${at}; never resent, so it may or may not have gone`, cleanError(send.error)) };
    case "bounced":
      return { tone: "problem", label: "Bounced", detail: join(`Sent ${at}`, cleanError(send.error)) };
    case "complained":
      return { tone: "problem", label: "Marked as spam", detail: `Sent ${at}. Their stoppable emails are now off` };
    case "suppressed":
      return { tone: "problem", label: "Blocked by Resend", detail: "The address is on Resend's suppression list" };
    default:
      return { tone: "none", label: send.status };
  }
}

/** A recent sign-up, as the page needs it. */
export type SignupFacts = {
  accountAt: Date;
  onboardedAt: Date | null;
  /** In BLOG_OWNER_EMAILS: never sent "finish setting up". */
  writer: boolean;
  /** On the bounce or spam list. */
  suppressed: boolean;
  welcome: SendFacts | null;
  unfinished: SendFacts | null;
  /** A dry-run row: it would have gone while EMAIL_LIFECYCLE_LIVE was off. */
  dryWelcome: boolean;
  dryUnfinished: boolean;
};

const BOUNCE_LIST: Cell = { tone: "problem", label: "Not sent", detail: "The address bounced or was marked as spam before" };

export function welcomeCell(p: SignupFacts, ctx: StatusContext): Cell {
  if (p.welcome) return sendCell(p.welcome, ctx);
  if (!p.onboardedAt) return { tone: "none", label: "Waits for onboarding", detail: "It goes the moment they finish setting up" };
  if (p.suppressed) return BOUNCE_LIST;
  const wasDry = p.dryWelcome ? "They finished while the switch was off (a dry run)" : null;
  if (!ctx.lifecycleLive) return { tone: "dry", label: p.dryWelcome ? "Dry run" : "Not sent", detail: "EMAIL_LIFECYCLE_LIVE is off" };
  if (ctx.now.getTime() - p.onboardedAt.getTime() > WELCOME_CATCH_UP_HOURS * HOUR_MS)
    return { tone: "problem", label: "Never sent", detail: join(wasDry, `The ${WELCOME_CATCH_UP_HOURS}-hour catch-up has passed`) };
  return { tone: "wait", label: "Not yet", detail: join(wasDry, NEXT_RUN, budgetNote(ctx)) };
}

export function unfinishedCell(p: SignupFacts, ctx: StatusContext): Cell {
  if (p.unfinished) return sendCell(p.unfinished, ctx);
  if (p.onboardedAt) return { tone: "none", label: "Not needed", detail: "They finished setting up" };
  if (p.writer) return { tone: "none", label: "Never", detail: "Writers aren't nudged" };
  if (p.suppressed) return BOUNCE_LIST;
  const age = ctx.now.getTime() - p.accountAt.getTime();
  if (age > WELCOME_UNFINISHED_TIMING.maxAgeDays * 24 * HOUR_MS)
    return { tone: "none", label: p.dryUnfinished ? "Dry run" : "Not sent", detail: `Only for accounts under ${WELCOME_UNFINISHED_TIMING.maxAgeDays} days old` };
  if (!ctx.lifecycleLive) return { tone: "dry", label: p.dryUnfinished ? "Dry run" : "Not sent", detail: "EMAIL_LIFECYCLE_LIVE is off" };
  if (age < WELCOME_UNFINISHED_TIMING.afterHours * HOUR_MS)
    return { tone: "wait", label: "Not yet", detail: `Due from ${istTime(new Date(p.accountAt.getTime() + WELCOME_UNFINISHED_TIMING.afterHours * HOUR_MS))} IST, ${WELCOME_UNFINISHED_TIMING.afterHours} hours after sign-up, at the run after that` };
  return { tone: "wait", label: "Due", detail: join(NEXT_RUN, budgetNote(ctx)) };
}

/** The email that matters for this person now: the welcome once they've finished setting up, else the nudge. */
export const mainKind = (p: SignupFacts): "welcome" | "welcome_unfinished" => (p.onboardedAt || p.welcome ? "welcome" : "welcome_unfinished");

export type SignupRow = {
  email: string; // masked
  signedUp: string;
  onboarded: string | null;
  welcome: Cell;
  unfinished: Cell;
  main: "welcome" | "welcome_unfinished";
};

export function signupRow(p: SignupFacts & { email: string }, ctx: StatusContext): SignupRow {
  return {
    email: maskEmail(p.email),
    signedUp: istTime(p.accountAt),
    onboarded: p.onboardedAt ? istTime(p.onboardedAt) : null,
    welcome: welcomeCell(p, ctx),
    unfinished: unfinishedCell(p, ctx),
    main: mainKind(p),
  };
}

/** One line over the list: how many signed up, finished, and where their main email stands. */
export function signupTotals(rows: SignupRow[]) {
  const main = rows.map((r) => (r.main === "welcome" ? r.welcome : r.unfinished));
  const count = (tone: Tone) => main.filter((c) => c.tone === tone).length;
  return {
    signups: rows.length,
    onboarded: rows.filter((r) => r.onboarded).length,
    delivered: main.filter((c) => c.label === "Delivered").length,
    sent: main.filter((c) => c.tone === "done").length,
    waiting: count("wait"),
    dry: count("dry"),
    problems: count("problem"),
  };
}

// ── The daily job ───────────────────────────────────────────────────────────

export const KIND_WORDS: Record<EmailKind, string> = {
  welcome: "Welcome",
  welcome_unfinished: "Finish setting up",
  weekly: "Weekly",
  feedback: "Feedback",
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export type KindLine = { kind: string; live: boolean; due: number; went: number; capped: number; overBudget: number; failed: number };

export type RunView = {
  status: string;
  at: string;
  dry: boolean;
  failedAt: string | null;
  error: string | null;
  failureAlert: string | null;
  stoppedEarly: string | null;
  budgetLeft: number | null;
  kinds: KindLine[];
  retries: string;
  housekeeping: string | null;
  sheet: string | null;
  ms: number;
};

/** job_runs.last_result of the daily job (lib/email/jobs.ts RunResult), read defensively: older runs lack some fields. */
export function runView(result: unknown): RunView | null {
  const r = obj(result);
  if (typeof r.status !== "string") return null;
  const live = obj(r.live);
  const kinds = (["welcome", "welcome_unfinished", "weekly", "feedback"] as const).map((k) => {
    const t = obj(r[k]);
    const isLive = k === "weekly" ? live.weekly === true : live.lifecycle === true;
    return { kind: KIND_WORDS[k], live: isLive, due: num(t.due), went: num(isLive ? t.sent : t.wouldSend), capped: num(t.capped), overBudget: num(t.overBudget), failed: num(t.failed) };
  });
  const rt = obj(r.retries);
  const hk = r.housekeeping ? obj(r.housekeeping) : null;
  return {
    status: r.status,
    at: typeof r.at === "string" ? istTime(new Date(r.at)) : "unknown",
    dry: r.dry === true,
    failedAt: typeof r.failedAt === "string" ? r.failedAt : null,
    error: cleanError(typeof r.error === "string" ? r.error : null),
    failureAlert: typeof r.failureAlert === "string" ? r.failureAlert : null,
    stoppedEarly: typeof r.stoppedEarly === "string" ? r.stoppedEarly : null,
    budgetLeft: r.budget ? num(obj(r.budget).left) : null,
    kinds,
    retries: `tried ${num(rt.tried)}, sent ${num(rt.sent)}, failed ${num(rt.failed)}, waiting ${num(rt.waiting)}, given up ${num(rt.expired)}`,
    housekeeping: hk
      ? `deleted ${num(hk.loginCodes)} old codes, ${num(hk.sessions)} sessions, ${num(hk.dryRows)} dry-run rows, ${num(hk.askTurns)} Ask questions`
      : null,
    sheet: sheetWords(r.sheet),
    ms: num(r.ms),
  };
}

function sheetWords(sheet: unknown): string | null {
  if (sheet === null || sheet === undefined) return null;
  if (typeof sheet === "string") return sheet === "skipped" ? "Skipped: the run ran out of time" : sheet === "error" ? "Failed" : sheet;
  const s = obj(sheet);
  const sync = obj(s.sync);
  const copy =
    sync.status === "ok"
      ? `copied ${num(sync.marked)} of ${num(sync.sent)} answers`
      : sync.status === "failed"
        ? `copy failed, ${num(sync.pending)} waiting`
        : sync.status === "not_configured"
          ? "not set up"
          : String(sync.status ?? "unknown");
  return `${copy}; forgets done ${num(s.forgotten)}, waiting ${num(s.forgetsPending)}`;
}

// ── Other job_runs rows ─────────────────────────────────────────────────────

/** A founders' alert marker, e.g. "alert:weekly-cap:2026-11-16", in words. */
export function alertWords(job: string): string {
  const [, what = "", day = ""] = /^alert:([a-z0-9-]+):(.+)$/.exec(job) ?? [];
  const when = shortDay(day);
  switch (what) {
    case "daily-failed":
      return `The daily job failed (${when}, UTC day)`;
    case "weekly-cap":
      return `The weekly list neared the daily limit (week of ${when})`;
    case "ask-80":
      return `Ask used 80% of its daily limit (${when})`;
    case "ask-cap":
      return `Ask reached its daily limit (${when})`;
    default:
      return job;
  }
}

/**
 * Any other job's last result in a line (the Sheet's Users sync and the like): its status
 * and up to 12 plain fields, one level deep. Strings are cut short and addresses masked,
 * so a result written by another lane can't spill more than a line.
 */
export function resultLine(result: unknown): string {
  if (result === null || result === undefined) return "no result yet";
  if (typeof result !== "object") return cleanError(String(result)) ?? "";
  const parts: string[] = [];
  const add = (key: string, v: unknown) => {
    if (parts.length >= 12) return;
    if (typeof v === "number" || typeof v === "boolean") parts.push(`${key} ${v}`);
    else if (typeof v === "string") parts.push(`${key} ${cleanError(v.slice(0, 80)) ?? ""}`.trim());
  };
  const r = obj(result);
  if (typeof r.status === "string") parts.push(r.status);
  for (const [k, v] of Object.entries(r)) {
    if (k === "status") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) add(`${k}.${k2}`, v2);
    else add(k, v);
  }
  return parts.join(", ") || "no counts";
}
