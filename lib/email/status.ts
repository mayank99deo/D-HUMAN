import "server-only";
import { and, count, desc, eq, gte, inArray, like, notLike, or } from "drizzle-orm";
import { isOwnerEmail } from "@/lib/auth/owners";
import { db, schema } from "@/lib/db";
import { dailyCap } from "./budget";
import { sendingAllowed, whereRunning } from "./client";
import { MAX_ATTEMPTS, budgetToday, type BudgetToday } from "./send";
import {
  alertWords,
  cleanError,
  istTime,
  maskEmail,
  resultLine,
  runView,
  sendCell,
  signupRow,
  signupTotals,
  KIND_WORDS,
  type Cell,
  type RunView,
  type SendFacts,
  type SignupRow,
  type StatusContext,
} from "./status-view";
import { emailHash } from "./suppress";
import { isOn, switchState, type SwitchState } from "./switches";
import { DAILY_JOB, ONCE, type EmailKind } from "./types";

// Everything the founders' status page (/write/status) shows, read in one go. Read only:
// it never writes, sends or claims anything. Counts, statuses and masked addresses only;
// nothing about anyone's health and no email's words.

const { users, profiles, emailSends, emailSuppressions, jobRuns } = schema;

const DAY_MS = 24 * 60 * 60 * 1000;
export const SIGNUP_DAYS = 14;
const SIGNUP_MAX = 200;
const SENDS_SHOWN = 50;
const ALERTS_SHOWN = 12;
/** The Sheet lanes' job_runs keys ("sheet…", "users…"); "sheet-forget:" rows are per person, so they're counted, not listed. */
const SHEET_FORGET = "sheet-forget:";

export type SwitchLine = { label: string; name: string; on: boolean; state: SwitchState | "set" | "missing"; note?: string };

export type JobLine = { job: string; startedAt: string; okAt: string; running: boolean; result: string };

export type EmailStatus = {
  asOf: string;
  switches: SwitchLine[];
  budget: BudgetToday & { cap: number };
  signups: SignupRow[];
  totals: ReturnType<typeof signupTotals>;
  daily: { startedAt: string; okAt: string; running: boolean; run: RunView | null } | null;
  alerts: { what: string; at: string }[];
  sheetJobs: JobLine[];
  forgetsWaiting: number;
  sends: { email: string; kind: string; key: string; cell: Cell; at: string; resendId: boolean; attempts: number; error: string | null }[];
};

const present = (name: string, label: string, note?: string): SwitchLine => {
  const on = Boolean(process.env[name]?.trim());
  return { label, name, on, state: on ? "set" : "missing", ...(note ? { note } : {}) };
};

const live = (name: string, label: string): SwitchLine => {
  const state = switchState(process.env[name]);
  return { label, name, on: state === "on", state, ...(state === "unrecognised" ? { note: "Set, but not to 1, true, yes or on, so it reads as off" } : {}) };
};

/** On or off for each setting the email needs. Names only, never values. */
export function switchLines(): SwitchLine[] {
  const allowed = sendingAllowed();
  return [
    live("EMAIL_LIFECYCLE_LIVE", "Welcome, finish setting up and feedback emails"),
    live("EMAIL_WEEKLY_LIVE", "Weekly email"),
    { label: "Sending allowed here", name: "VERCEL_ENV", on: allowed, state: allowed ? "on" : "off", ...(allowed ? {} : { note: `Email goes only from production (${whereRunning()})` }) },
    present("RESEND_API_KEY", "Resend key"),
    present("EMAIL_LINK_SECRET", "Link secret", "Stop and feedback links; without it those emails wait"),
    present("RESEND_WEBHOOK_SECRET", "Resend webhook secret", "Delivered, bounced and spam statuses"),
    present("CRON_SECRET", "Daily job secret"),
    {
      ...present("GOOGLE_SHEETS_WEBHOOK_URL", "Google Sheet web app"),
      on: Boolean(process.env.GOOGLE_SHEETS_WEBHOOK_URL?.trim() && process.env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim()),
      state: process.env.GOOGLE_SHEETS_WEBHOOK_URL?.trim() && process.env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim() ? "set" : "missing",
      name: "GOOGLE_SHEETS_WEBHOOK_URL and _SECRET",
    },
  ];
}

const facts = (r: typeof emailSends.$inferSelect): SendFacts => ({
  status: r.status,
  sentAt: r.sentAt,
  createdAt: r.createdAt,
  hasProviderId: Boolean(r.providerId),
  error: r.error,
  attempts: r.attempts,
});

const dryKey = (kind: EmailKind, userId: string) => `dry:${kind}:${userId}:${ONCE}`;

const jobLine = (row: typeof jobRuns.$inferSelect, now: Date): JobLine => ({
  job: row.job,
  startedAt: istTime(row.lastStartedAt),
  okAt: istTime(row.lastOkAt),
  running: !!row.leaseUntil && row.leaseUntil > now,
  result: resultLine(row.lastResult),
});

export async function loadEmailStatus(now = new Date()): Promise<EmailStatus> {
  const d = await db();
  const since = new Date(now.getTime() - SIGNUP_DAYS * DAY_MS);

  const [people, budget, recent, [daily], alerts, sheetRows, [forgets]] = await Promise.all([
    d
      .select({ id: users.id, email: users.email, accountAt: users.createdAt, onboardedAt: profiles.onboardedAt })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(gte(users.createdAt, since))
      .orderBy(desc(users.createdAt))
      .limit(SIGNUP_MAX),
    budgetToday(now),
    d
      .select({ send: emailSends, email: users.email })
      .from(emailSends)
      .innerJoin(users, eq(users.id, emailSends.userId))
      .orderBy(desc(emailSends.createdAt))
      .limit(SENDS_SHOWN),
    d.select().from(jobRuns).where(eq(jobRuns.job, DAILY_JOB)).limit(1),
    d.select({ job: jobRuns.job, at: jobRuns.lastStartedAt }).from(jobRuns).where(like(jobRuns.job, "alert:%")).orderBy(desc(jobRuns.lastStartedAt)).limit(ALERTS_SHOWN),
    d
      .select()
      .from(jobRuns)
      .where(and(or(like(jobRuns.job, "sheet%"), like(jobRuns.job, "users%")), notLike(jobRuns.job, `${SHEET_FORGET}%`)))
      .orderBy(desc(jobRuns.lastStartedAt)),
    d.select({ n: count() }).from(jobRuns).where(like(jobRuns.job, `${SHEET_FORGET}%`)),
  ]);

  const ids = people.map((p) => p.id);
  const [welcomeSends, dryRows, suppressed] = ids.length
    ? await Promise.all([
        d
          .select()
          .from(emailSends)
          .where(and(inArray(emailSends.userId, ids), inArray(emailSends.kind, ["welcome", "welcome_unfinished"]), eq(emailSends.dedupeKey, ONCE))),
        d
          .select({ job: jobRuns.job })
          .from(jobRuns)
          .where(inArray(jobRuns.job, ids.flatMap((id) => [dryKey("welcome", id), dryKey("welcome_unfinished", id)]))),
        d
          .select({ hash: emailSuppressions.emailHash })
          .from(emailSuppressions)
          .where(inArray(emailSuppressions.emailHash, people.map((p) => emailHash(p.email)))),
      ])
    : [[], [], []];

  const ctx: StatusContext = { now, lifecycleLive: isOn(process.env.EMAIL_LIFECYCLE_LIVE), budgetLeft: budget.left, maxAttempts: MAX_ATTEMPTS };
  const sendOf = new Map(welcomeSends.map((s) => [`${s.kind}:${s.userId}`, facts(s)]));
  const dry = new Set(dryRows.map((r) => r.job));
  const blocked = new Set(suppressed.map((s) => s.hash));
  const signups = people.map((p) =>
    signupRow(
      {
        email: p.email,
        accountAt: p.accountAt,
        onboardedAt: p.onboardedAt,
        writer: isOwnerEmail(p.email),
        suppressed: blocked.has(emailHash(p.email)),
        welcome: sendOf.get(`welcome:${p.id}`) ?? null,
        unfinished: sendOf.get(`welcome_unfinished:${p.id}`) ?? null,
        dryWelcome: dry.has(dryKey("welcome", p.id)),
        dryUnfinished: dry.has(dryKey("welcome_unfinished", p.id)),
      },
      ctx,
    ),
  );

  return {
    asOf: istTime(now),
    switches: switchLines(),
    budget: { ...budget, cap: dailyCap() },
    signups,
    totals: signupTotals(signups),
    daily: daily
      ? { startedAt: istTime(daily.lastStartedAt), okAt: istTime(daily.lastOkAt), running: !!daily.leaseUntil && daily.leaseUntil > now, run: runView(daily.lastResult) }
      : null,
    alerts: alerts.map((a) => ({ what: alertWords(a.job), at: istTime(a.at) })),
    sheetJobs: sheetRows.map((r) => jobLine(r, now)),
    forgetsWaiting: forgets?.n ?? 0,
    sends: recent.map(({ send, email }) => ({
      email: maskEmail(email),
      kind: KIND_WORDS[send.kind as EmailKind] ?? send.kind,
      key: send.dedupeKey,
      cell: sendCell(facts(send), ctx),
      at: istTime(send.sentAt ?? send.createdAt),
      resendId: Boolean(send.providerId),
      attempts: send.attempts,
      error: cleanError(send.error),
    })),
  };
}
