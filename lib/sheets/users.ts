import "server-only";
import { and, asc, count, eq, exists, gt, gte, inArray, like, lte, max, or, sql } from "drizzle-orm";
import { keyMode } from "@/lib/billing/razorpay";
import { db, schema, type Db } from "@/lib/db";
import { at } from "@/lib/db/params";
import { SheetsOutdatedError, forgetUsers, listUserIds, sheetsConfigured, upsertUsers, type UserSheetRow } from "@/lib/waitlist/sheets";
import { USER_KEY, istDay, userKey, userSheetRow, type UserFacts } from "./user-row";

// The Users tab of the founders' Google Sheet: one row per account (columns and what never
// goes in: ./user-row.ts). Postgres is the record; the Sheet is a copy.
//
// When rows go:
// - Sign-up (/api/auth/verify, a new account), onboarding finishing, and a Settings change
//   to a field the Sheet shows (/api/profile): that one row, in after(), never holding up
//   the response (pushUserRow). A failure is only logged: the daily job sends it anyway.
// - The daily job (lib/email/jobs.ts, after housekeeping and the feedback Sheet; it runs
//   whatever happened before it): every account changed since the last sync, plus a full
//   rewrite of everyone once an Indian day, at the first run of the day (about 10:30 IST).
//   The full rewrite ends by removing rows of accounts that no longer exist (deleted by
//   hand in Supabase, say). The first run after deploy is a full one: the backfill.
// - Deleting an account: the delete's own transaction records a promise to remove the row
//   ("sheet-forget-user:u_…" in job_runs), and after() asks the Sheet; the daily job asks
//   again until the Sheet confirms. So the row goes even when the Sheet is down.
//
// Only production writes the tab (or a local run with SHEET_USERS_LOCAL=1, against a test
// Sheet): .env.local holds the real Sheet's URL and secret, and a local database's accounts
// must never mix with, or remove, the real ones.
//
// job_runs "sheet-users": lastStartedAt (the last daily sync), lastOkAt (the last one that
// finished everything it meant to), lastResult = UsersSheetSaved (counts and progress only).
// Logs carry counts and statuses, never names, addresses or account ids.

const { users, profiles, emailPrefs, foodLogs, reports, payments, jobRuns } = schema;

export const USERS_SHEET_JOB = "sheet-users";
/** job_runs rows for a row the Sheet hasn't confirmed removing: "sheet-forget-user:u_…". */
export const USER_FORGET_PREFIX = "sheet-forget-user:";
/** Rows per request: the script takes at most 200. */
export const USERS_BATCH = 200;
const FORGET_BATCH = 500;
/** Changes are looked for from a little before the last sync, so a small clock difference between Vercel and Supabase can't hide one. */
const OVERLAP_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the Users tab may be written: production, or locally with SHEET_USERS_LOCAL=1. */
export function usersSheetAllowed(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  return !process.env.VERCEL && process.env.SHEET_USERS_LOCAL === "1";
}

/** A short reason for logs and job_runs. A database error's message holds its query's parameters, so only its code is kept. */
function why(error: unknown): string {
  if (error instanceof SheetsOutdatedError) return "the deployed script doesn't know the Users tab yet";
  if (!(error instanceof Error)) return "unknown error";
  if (/^Failed query/.test(error.message)) {
    const code = (error as { cause?: { code?: unknown } }).cause?.code;
    return `database error${typeof code === "string" ? ` ${code}` : ""}`;
  }
  if (/headers_changed/.test(error.message)) return "the Users tab's headers were changed by hand: rename the tab and run setupUsers";
  // A page that isn't JSON (a Google error page): its status, not its text.
  if (/non-JSON body/.test(error.message)) return error.message.replace(/ with a non-JSON body[\s\S]*$/, " with a page that isn't JSON");
  return error.message.slice(0, 200);
}

// ── Rows ────────────────────────────────────────────────────────────────────

/**
 * What the rows of these accounts are built from: four queries in parallel, grouped by
 * account, never one per person. Each uses its table's (user_id, …) index: the primary
 * keys, food_logs_user_date_idx, reports_user_idx, payments_user_idx. The select lists
 * are the privacy boundary: nothing else is read.
 */
async function factsFor(d: Db, ids: string[], now: Date): Promise<UserFacts[]> {
  if (!ids.length) return [];
  const paid = and(inArray(payments.userId, ids), eq(payments.status, "paid"), eq(payments.mode, keyMode()));
  const [people, meals, uploads, passes] = await Promise.all([
    d
      .select({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
        lastSeenAt: users.lastSeenAt,
        name: profiles.name,
        birthYear: profiles.birthYear,
        sex: profiles.sex,
        city: profiles.city,
        language: profiles.language,
        primaryActivity: profiles.primaryActivity,
        level: profiles.level,
        goals: profiles.goals,
        diet: profiles.diet,
        onboardedAt: profiles.onboardedAt,
        profileUpdatedAt: profiles.updatedAt,
        weekly: emailPrefs.weekly,
        weeklyPausedAt: emailPrefs.weeklyPausedAt,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .leftJoin(emailPrefs, eq(emailPrefs.userId, users.id))
      .where(inArray(users.id, ids)),
    d
      .select({ userId: foodLogs.userId, n: count(), last: max(foodLogs.createdAt) })
      .from(foodLogs)
      .where(inArray(foodLogs.userId, ids))
      .groupBy(foodLogs.userId),
    d
      .select({ userId: reports.userId, n: count(), last: max(reports.createdAt) })
      .from(reports)
      .where(inArray(reports.userId, ids))
      .groupBy(reports.userId),
    d
      .select({
        userId: payments.userId,
        n: count(),
        until: max(payments.endsAt),
        active: sql<boolean>`bool_or(${payments.startsAt} <= ${at(now)} and ${payments.endsAt} > ${at(now)})`,
      })
      .from(payments)
      .where(paid)
      .groupBy(payments.userId),
  ]);
  const mealsBy = new Map(meals.map((m) => [m.userId, m]));
  const uploadsBy = new Map(uploads.map((r) => [r.userId, r]));
  const passesBy = new Map(passes.map((p) => [p.userId, p]));
  return people.map((p) => {
    const m = mealsBy.get(p.id);
    const r = uploadsBy.get(p.id);
    const pass = passesBy.get(p.id);
    return {
      ...p,
      meals: m?.n ?? 0,
      lastMealAt: m?.last ?? null,
      reports: r?.n ?? 0,
      lastReportAt: r?.last ?? null,
      payments: pass?.n ?? 0,
      passActive: pass?.active === true,
      passUntil: pass?.until ?? null,
    };
  });
}

/** Rows for these accounts, in the order given; accounts that no longer exist are left out. */
async function rowsFor(d: Db, ids: string[], now: Date): Promise<{ id: string; row: UserSheetRow }[]> {
  const facts = new Map((await factsFor(d, ids, now)).map((f) => [f.id, f]));
  return ids.flatMap((id) => {
    const f = facts.get(id);
    return f ? [{ id, row: userSheetRow(f, now) }] : [];
  });
}

// ── Removing rows ───────────────────────────────────────────────────────────

const forgetJob = (key: string) => USER_FORGET_PREFIX + key;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks the Sheet to delete these rows, then drops their promises. Throws when the Sheet doesn't confirm. */
async function forgetKeys(d: Db, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += FORGET_BATCH) {
    const batch = keys.slice(i, i + FORGET_BATCH);
    await forgetUsers(batch);
    await d.delete(jobRuns).where(inArray(jobRuns.job, batch.map(forgetJob)));
  }
}

/** Promises to remove these rows, kept until the Sheet confirms (the daily job asks again). */
async function promiseForget(q: Db, keys: string[], now: Date): Promise<void> {
  if (!keys.length) return;
  await q
    .insert(jobRuns)
    .values(keys.map((key) => ({ job: forgetJob(key), lastStartedAt: now })))
    .onConflictDoNothing();
}

/**
 * Accounts deleted while their rows were on the way: the Sheet got the rows after the
 * delete's own request, so ask again. One primary-key lookup per batch.
 */
async function forgetVanished(d: Db, ids: string[], now: Date): Promise<number> {
  if (!ids.length) return 0;
  const still = new Set((await d.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map((u) => u.id));
  const gone = ids.filter((id) => !still.has(id)).map(userKey);
  if (!gone.length) return 0;
  await promiseForget(d, gone, now);
  await forgetKeys(d, gone);
  return gone.length;
}

/**
 * Inside the account-delete transaction: the promise to remove the person's row, so the
 * Sheet is asked until it confirms. Returns the row's User ID for forgetUserRow, or null
 * where the Users tab isn't written (local runs).
 */
export async function queueUserForget(tx: Db, userId: string, now = new Date()): Promise<string | null> {
  if (!usersSheetAllowed() || !sheetsConfigured()) return null;
  const key = userKey(userId);
  await promiseForget(tx, [key], now);
  return key;
}

/** After the delete's response: asks the Sheet to remove the row, a few times. Never throws; the daily job keeps asking. */
export async function forgetUserRow(key: string, { tries = 3, waitMs = 1_500 }: { tries?: number; waitMs?: number } = {}): Promise<"forgotten" | "queued"> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      await forgetKeys(await db(), [key]);
      return "forgotten";
    } catch (error) {
      if (attempt === tries || error instanceof SheetsOutdatedError) {
        console.error(`[sheet] users: removing a deleted account's row failed (${why(error)}); the daily job tries again`);
        return "queued";
      }
      await wait(waitMs * attempt);
    }
  }
  return "queued";
}

// ── One row, after a request ────────────────────────────────────────────────

export type PushOutcome = "sent" | "gone" | "outdated" | "failed" | "not_configured" | "not_production";

/**
 * Copies one account's row to the Sheet: in after() on sign-up, onboarding and profile
 * changes. Never throws; a row that doesn't arrive goes with the daily job's next run.
 */
export async function pushUserRow(userId: string, now = new Date()): Promise<PushOutcome> {
  if (!usersSheetAllowed()) return "not_production";
  if (!sheetsConfigured()) return "not_configured";
  try {
    const d = await db();
    const rows = await rowsFor(d, [userId], now);
    if (!rows.length) return "gone";
    await upsertUsers(rows.map((r) => r.row));
    await forgetVanished(d, [userId], now);
    return "sent";
  } catch (error) {
    console.error(`[sheet] users: a row didn't reach the Sheet (${why(error)}); the daily job sends it`);
    return error instanceof SheetsOutdatedError ? "outdated" : "failed";
  }
}

// ── The daily sync ──────────────────────────────────────────────────────────

export type UsersSheetResult = {
  /**
   * ok: everything it meant to do; partial: ran out of time, carries on next run;
   * outdated: the deployed Apps Script predates the Users tab (Mayank deploys the new
   * Code.gs); failed: the Sheet didn't answer, or refused (error says why);
   * not_configured: no GOOGLE_SHEETS_WEBHOOK_URL or _SECRET; not_production: a local or
   * preview run, which never writes the real Sheet.
   */
  status: "ok" | "partial" | "outdated" | "failed" | "not_configured" | "not_production";
  /** full: every account (once an Indian day, and the backfill); changed: those changed since the last sync. */
  mode: "full" | "changed" | null;
  /** Rows added or updated this run. */
  sent: number;
  /** Rows this run meant to send and didn't (out of time, or the Sheet failed). */
  left: number;
  /** Deleted accounts whose rows the Sheet confirmed removing this run (queued ones and leftovers). */
  forgotten: number;
  /** Deleted accounts still waiting for the Sheet to remove their row. */
  forgetsPending: number;
  /** The Indian day the last full rewrite finished; null until the first one. */
  fullOn: string | null;
  error?: string;
};

type SyncState = {
  /** Changes after this moment haven't been copied yet. */
  since: string | null;
  fullOn: string | null;
  /** A full rewrite under way: when it started, and the sign-up time it has reached. */
  pass: { startedAt: string; from: string | null } | null;
};

/** job_runs.last_result for "sheet-users": the last result, when it was, and the sync's progress. */
export type UsersSheetSaved = UsersSheetResult & { at: string; since: string | null; pass: SyncState["pass"] };

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

async function loadState(d: Db): Promise<SyncState> {
  const [row] = await d.select({ saved: jobRuns.lastResult }).from(jobRuns).where(eq(jobRuns.job, USERS_SHEET_JOB)).limit(1);
  const s = (row?.saved ?? {}) as Partial<UsersSheetSaved>;
  const pass = s.pass && isIso(s.pass.startedAt) ? { startedAt: s.pass.startedAt, from: isIso(s.pass.from) ? s.pass.from : null } : null;
  return { since: isIso(s.since) ? s.since : null, fullOn: typeof s.fullOn === "string" ? s.fullOn : null, pass };
}

async function saveState(d: Db, state: SyncState, result: UsersSheetResult, now: Date, final: boolean): Promise<void> {
  const saved: UsersSheetSaved = { ...result, fullOn: state.fullOn, at: now.toISOString(), since: state.since, pass: state.pass };
  const ok = final && result.status === "ok" ? { lastOkAt: now } : {};
  await d
    .insert(jobRuns)
    .values({ job: USERS_SHEET_JOB, lastStartedAt: now, lastResult: saved, ...ok })
    .onConflictDoUpdate({ target: jobRuns.job, set: { lastStartedAt: now, lastResult: saved, ...ok } });
}

/** Deletions the Sheet missed, oldest first, in one request. Throws when the Sheet doesn't confirm. */
async function finishForgets(d: Db, result: UsersSheetResult): Promise<void> {
  const queued = await d
    .select({ job: jobRuns.job })
    .from(jobRuns)
    .where(like(jobRuns.job, `${USER_FORGET_PREFIX}%`))
    .orderBy(asc(jobRuns.lastStartedAt))
    .limit(FORGET_BATCH);
  const keys = queued.map((q) => q.job.slice(USER_FORGET_PREFIX.length));
  const bad = queued.filter((_, i) => !USER_KEY.test(keys[i])).map((q) => q.job);
  if (bad.length) await d.delete(jobRuns).where(inArray(jobRuns.job, bad));
  const good = keys.filter((k) => USER_KEY.test(k));
  if (!good.length) return;
  await forgetKeys(d, good);
  result.forgotten += good.length;
}

async function pendingForgets(d: Db): Promise<number> {
  const [row] = await d.select({ n: count() }).from(jobRuns).where(like(jobRuns.job, `${USER_FORGET_PREFIX}%`));
  return row?.n ?? 0;
}

type Person = { id: string; createdAt: Date };

/**
 * Sends these accounts' rows, 200 a request, until done or past `deadline` (epoch ms).
 * True when every row went. `afterBatch` records progress, so a run that is cut off
 * carries on from there.
 */
async function sendAll(d: Db, people: Person[], result: UsersSheetResult, now: Date, deadline: number, afterBatch?: (last: Person) => Promise<void>): Promise<boolean> {
  for (let i = 0; i < people.length; i += USERS_BATCH) {
    if (Date.now() > deadline) {
      result.status = "partial";
      result.left += people.length - i;
      return false;
    }
    const page = people.slice(i, i + USERS_BATCH);
    let rows: Awaited<ReturnType<typeof rowsFor>>;
    try {
      rows = await rowsFor(d, page.map((p) => p.id), now);
      if (rows.length) await upsertUsers(rows.map((r) => r.row));
    } catch (error) {
      result.left += people.length - i;
      throw error;
    }
    if (rows.length) {
      result.sent += rows.length;
      result.forgotten += await forgetVanished(d, rows.map((r) => r.id), now);
    }
    if (afterBatch) await afterBatch(page[page.length - 1]);
  }
  return true;
}

/**
 * Accounts whose row may have changed since `since`: new, signed in, profile or email
 * settings saved, a meal logged, a report uploaded, a pass paid or ended. One query: a
 * scan of users with index probes (food_logs_user_date_idx, reports_user_idx,
 * payments_user_idx). Deleted meals and reports change counts without a timestamp; the
 * daily full rewrite catches those.
 */
async function changedSince(d: Db, since: Date, now: Date): Promise<Person[]> {
  const one = sql`1`;
  // A meal's local_date is its person's day: no zone is more than a day behind UTC.
  const fromDay = new Date(since.getTime() - 2 * DAY_MS).toISOString().slice(0, 10);
  return d
    .select({ id: users.id, createdAt: users.createdAt })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .leftJoin(emailPrefs, eq(emailPrefs.userId, users.id))
    .where(
      or(
        gt(users.createdAt, since),
        gt(users.lastSeenAt, since),
        gt(profiles.updatedAt, since),
        gt(emailPrefs.updatedAt, since),
        gt(emailPrefs.weeklyPausedAt, since),
        exists(d.select({ one }).from(foodLogs).where(and(eq(foodLogs.userId, users.id), gte(foodLogs.localDate, fromDay), gt(foodLogs.createdAt, since)))),
        exists(d.select({ one }).from(reports).where(and(eq(reports.userId, users.id), gt(reports.createdAt, since)))),
        exists(
          d
            .select({ one })
            .from(payments)
            .where(and(eq(payments.userId, users.id), or(gt(payments.paidAt, since), and(gt(payments.endsAt, since), lte(payments.endsAt, now))))),
        ),
      ),
    )
    .orderBy(asc(users.createdAt), asc(users.id));
}

/**
 * Removes rows whose account no longer exists (deleted by hand in the database, say).
 * The Sheet's list is read first and the accounts second, so an account made in between
 * is never mistaken for a leftover.
 */
async function removeLeftovers(d: Db, result: UsersSheetResult): Promise<void> {
  const listed = (await listUserIds()).filter((k) => USER_KEY.test(k));
  const present = new Set((await d.select({ id: users.id }).from(users)).map((u) => userKey(u.id)));
  const leftovers = listed.filter((k) => !present.has(k));
  if (!leftovers.length) return;
  await forgetKeys(d, leftovers);
  result.forgotten += leftovers.length;
}

/**
 * For the daily job: finishes deletions the Sheet missed, then copies rows, a full rewrite
 * once an Indian day or the changed ones otherwise, and stops at `deadline` (epoch ms).
 * Never throws for the Sheet's sake: a Sheet that is down or outdated is a status, and
 * the next run carries on. Counts only, in the result and the log line.
 */
export async function syncUsersSheet({ now = new Date(), deadline = Infinity }: { now?: Date; deadline?: number } = {}): Promise<UsersSheetResult> {
  const blank = { mode: null, sent: 0, left: 0, forgotten: 0, forgetsPending: 0, fullOn: null };
  if (!usersSheetAllowed()) return { status: "not_production", ...blank };
  if (!sheetsConfigured()) {
    console.info("[sheet] users: GOOGLE_SHEETS_WEBHOOK_URL or GOOGLE_SHEETS_WEBHOOK_SECRET isn't set; the Users tab isn't updated");
    return { status: "not_configured", ...blank };
  }
  const d = await db();
  const state = await loadState(d);
  const result: UsersSheetResult = { status: "ok", ...blank, fullOn: state.fullOn };
  const save = (final: boolean) => saveState(d, state, result, now, final);

  try {
    await finishForgets(d, result);
    const full = !!state.pass || !state.since || state.fullOn !== istDay(now);
    result.mode = full ? "full" : "changed";
    if (full) {
      const pass = (state.pass ??= { startedAt: now.toISOString(), from: null });
      const everyone = await d.select({ id: users.id, createdAt: users.createdAt }).from(users).orderBy(asc(users.createdAt), asc(users.id));
      // From the sign-up time reached so far; rows at that very moment go again, which is harmless.
      const from = pass.from ? Date.parse(pass.from) : null;
      const todo = from === null ? everyone : everyone.filter((p) => p.createdAt.getTime() >= from);
      const done = await sendAll(d, todo, result, now, deadline, async (last) => {
        pass.from = last.createdAt.toISOString();
        await save(false);
      });
      if (done) {
        state.pass = null;
        state.fullOn = istDay(now);
        state.since = new Date(Date.parse(pass.startedAt) - OVERLAP_MS).toISOString();
        result.fullOn = state.fullOn;
        if (Date.now() <= deadline) await removeLeftovers(d, result);
      }
    } else {
      const done = await sendAll(d, await changedSince(d, new Date(state.since!), now), result, now, deadline);
      if (done) state.since = new Date(now.getTime() - OVERLAP_MS).toISOString();
    }
  } catch (error) {
    result.status = error instanceof SheetsOutdatedError ? "outdated" : "failed";
    result.error = why(error);
  }

  result.forgetsPending = await pendingForgets(d);
  await save(true);
  console.info(`[sheet] users: ${summary(result)}`);
  return result;
}

/** One log line: counts and statuses only. */
export function summary(r: UsersSheetResult): string {
  const hint =
    r.status === "outdated"
      ? " (paste the new Code.gs, run setupUsers, deploy a new version; retried next run)"
      : r.status === "failed"
        ? ` (${r.error ?? "unknown error"}; retried next run)`
        : r.status === "partial"
          ? " (out of time; carries on next run)"
          : "";
  return `${r.status}${hint}${r.mode ? `, ${r.mode}` : ""}, sent ${r.sent}, left ${r.left}, removed ${r.forgotten}, removals waiting ${r.forgetsPending}`;
}
