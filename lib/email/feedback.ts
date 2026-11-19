import "server-only";
import { createHmac } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { activePass } from "@/lib/platform/plan";
import { absoluteUrl } from "@/lib/site-url";
import { appendFeedback, forgetRespondent, sheetsConfigured, type FeedbackSheetRow } from "@/lib/waitlist/sheets";
import { ANSWER_TEXT, FLOW, OPEN_SURVEY, answerLabel, isOption, isPath, isQuestion, pathOfEmailQuestion, type ChoiceQuestion } from "./feedback-survey";
import { feedbackToken, readFeedbackToken } from "./tokens";
import { FEEDBACK_CONFLICT_SECONDS, type FeedbackData, type FeedbackPath, type FeedbackQuestion, type FeedbackSource } from "./types";

// Feedback answers (architecture spec §3.8, UX spec §5).
//
// - Postgres is the record; the Google Sheet's "Feedback" tab is a copy for the founders.
// - Opening a link records nothing (mail scanners open every link). The /feedback page
//   shows the tapped answer as chosen, and saves it only when the person confirms or moves on.
// - Two different confirmations of the email's question within 10 seconds look like a
//   scanner pressing buttons: neither counts until a later, single answer.
// - Each saved change clears sheet_synced_at. The API copies the person's rows to the Sheet
//   after answering; the daily job retries whatever didn't arrive (syncFeedbackSheet).
// - The Sheet gets a respondent code, never the email address, unless the person ticked
//   "You can email me about this" (then only on that note's row).
// - Deleting an account deletes the rows here (foreign keys) and asks the Sheet to delete
//   that respondent's rows (forgetFeedbackInSheet), retried until it succeeds.

const fa = schema.feedbackAnswers;

// ── Respondent codes ────────────────────────────────────────────────────────

// Keyed from EMAIL_LINK_SECRET (kept stable, like stop links) with its own label, so a code
// can be worked out again when the account is deleted. Local dev uses a fixed key, as
// lib/email/tokens.ts does; production without the secret makes no codes and copies nothing.
function respondentKey(): Buffer | null {
  const secret = process.env.EMAIL_LINK_SECRET || (process.env.NODE_ENV === "production" && process.env.VERCEL ? null : "d-human-local-email-link-secret");
  return secret ? createHmac("sha256", secret).update("d-human/feedback-respondent/v1").digest() : null;
}

/**
 * The person's code in the Sheet: "r_" and 12 hex characters. Not reversible to the person
 * without the secret. 12 rather than 10 because "forget" deletes by this code, and a
 * collision would delete someone else's rows.
 */
export function respondentCode(userId: string): string | null {
  const key = respondentKey();
  return key ? `r_${createHmac("sha256", key).update(userId).digest("hex").slice(0, 12)}` : null;
}

// ── Links for the email (jobs lane) ─────────────────────────────────────────

const base = (origin?: string) => (origin ?? absoluteUrl("/")).replace(/\/+$/, "");

/** The feedback page for one person and survey; the token lasts FEEDBACK_TOKEN_DAYS. */
export function feedbackPageUrl(userId: string, survey: string, origin?: string, now = Date.now()): string {
  return `${base(origin)}/feedback?t=${feedbackToken(userId, survey, now)}`;
}

/** The email's answer buttons: each opens the page with that answer chosen (and nothing saved). */
export function feedbackEmailOptions(userId: string, survey: string, question: FeedbackData["question"], origin?: string, now = Date.now()): FeedbackData["options"] {
  const page = feedbackPageUrl(userId, survey, origin, now);
  return Object.entries(ANSWER_TEXT[question]).map(([answer, label]) => ({ answer, label, url: `${page}&q=${question}&a=${answer}` }));
}

// ── The page ────────────────────────────────────────────────────────────────

export type SavedChoices = Partial<Record<ChoiceQuestion, string>>;

export type FeedbackPageState =
  | { status: "invalid" }
  | { status: "gone" }
  | {
      status: "ok";
      survey: string;
      path: FeedbackPath;
      firstName: string | null;
      saved: SavedChoices;
      /** A note is saved. Its words aren't sent back: a forwarded link shouldn't show what was typed. */
      hasNote: boolean;
      start: FeedbackQuestion | "done";
      /** The answer tapped in the email, shown as chosen until they confirm it. Never saved by opening the page. */
      pending: string | null;
    };

export type PageQuery = { q?: string; a?: string; at?: string };

const firstNameOf = (name: string | null | undefined) => {
  const first = name?.trim().split(/\s+/)[0]?.slice(0, 40);
  return first || null;
};

/** What the /feedback page shows for a link. Reads only. */
export async function feedbackPageState(token: unknown, query: PageQuery, now = Date.now()): Promise<FeedbackPageState> {
  const payload = readFeedbackToken(token, now);
  if (!payload) return { status: "invalid" };
  const d = await db();
  const [[person], rows, [send]] = await Promise.all([
    d
      .select({ id: schema.users.id, name: schema.profiles.name })
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(eq(schema.users.id, payload.u))
      .limit(1),
    d
      .select({ question: fa.question, answer: fa.answer, path: fa.path })
      .from(fa)
      .where(and(eq(fa.userId, payload.u), eq(fa.survey, payload.s))),
    d
      .select({ variant: schema.emailSends.variant })
      .from(schema.emailSends)
      .where(and(eq(schema.emailSends.userId, payload.u), eq(schema.emailSends.kind, "feedback"), eq(schema.emailSends.dedupeKey, payload.s)))
      .limit(1),
  ]);
  if (!person) return { status: "gone" };

  const stored = rows.map((r) => r.path).find(isPath) ?? null;
  const variant = send?.variant;
  const path = stored ?? pathOfEmailQuestion(query.q) ?? (isPath(variant) ? variant : null) ?? "used";
  const flow = FLOW[path];

  const saved: SavedChoices = {};
  let hasNote = false;
  for (const r of rows) {
    if (r.answer === null || !isQuestion(r.question)) continue;
    if (r.question === "text") hasNote = true;
    else saved[r.question] = r.answer;
  }
  const answered = (q: FeedbackQuestion) => (q === "text" ? hasNote : saved[q] !== undefined);

  let start: FeedbackQuestion | "done";
  let pending: string | null = null;
  if (query.q === flow[0] && isOption(flow[0], query.a)) {
    start = flow[0];
    pending = query.a;
  } else if (query.at === "done") {
    start = "done";
  } else if (isQuestion(query.at) && flow.includes(query.at)) {
    start = query.at;
  } else {
    start = flow.find((q) => !answered(q)) ?? "done";
  }

  return { status: "ok", survey: payload.s, path, firstName: firstNameOf(person.name), saved, hasNote, start, pending };
}

// ── Saving ──────────────────────────────────────────────────────────────────

export type SaveInput = {
  userId: string;
  survey: string;
  /** The path the page showed; a path already stored for this survey wins. Null from Settings. */
  path: FeedbackPath | null;
  question: FeedbackQuestion;
  /** Already checked with checkAnswer(). */
  answer: string;
  source: FeedbackSource;
  /** Only for the typed note: "You can email me about this". */
  contactOk?: boolean;
  now?: Date;
};

export type SaveResult =
  | { status: "saved" | "unchanged"; path: FeedbackPath | null }
  /** Two different taps too close together: neither counts until a later, single answer. */
  | { status: "conflict"; path: FeedbackPath | null }
  | { status: "wrong_question" }
  | { status: "gone" };

// A foreign-key violation: the person was deleted. Drizzle wraps driver errors, so look one level down too.
function isMissingPerson(error: unknown): boolean {
  const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined);
  return code(error) === "23503" || code((error as { cause?: unknown })?.cause) === "23503";
}

/** Upserts one answer. Repeating the same answer changes nothing (and copies nothing to the Sheet again). */
export async function saveFeedbackAnswer(input: SaveInput): Promise<SaveResult> {
  const now = input.now ?? new Date();
  const d = await db();

  let path: FeedbackPath | null = null;
  if (input.survey !== OPEN_SURVEY) {
    const [row] = await d
      .select({ path: fa.path })
      .from(fa)
      .where(and(eq(fa.userId, input.userId), eq(fa.survey, input.survey), isNotNull(fa.path)))
      .limit(1);
    const stored = row?.path;
    path = (isPath(stored) ? stored : null) ?? input.path ?? pathOfEmailQuestion(input.question);
    if (!path || !FLOW[path].includes(input.question)) return { status: "wrong_question" };
  }

  const contactOk = input.question === "text" && input.contactOk === true;
  const conflictWindow = sql.raw(`interval '${FEEDBACK_CONFLICT_SECONDS} seconds'`);
  // Scanner rule: a confirmation from the email that disagrees with one made seconds ago
  // (or arrives while a disagreement is still fresh) clears the answer for a while.
  const conflict = sql`(excluded.source = 'email_tap' and (
    (${fa.conflictUntil} is not null and ${fa.conflictUntil} > excluded.updated_at)
    or (${fa.source} = 'email_tap' and ${fa.answer} is not null and ${fa.answer} <> excluded.answer
        and ${fa.updatedAt} > excluded.updated_at - ${conflictWindow})))`;

  try {
    const rows = await d
      .insert(fa)
      .values({
        id: newId(),
        userId: input.userId,
        survey: input.survey,
        question: input.question,
        answer: input.answer,
        path,
        source: input.source,
        contactOk,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [fa.userId, fa.survey, fa.question],
        set: {
          answer: sql`case when ${conflict} then null else excluded.answer end`,
          conflictUntil: sql`case when ${conflict} then excluded.updated_at + ${conflictWindow} else null end`,
          source: sql`excluded.source`,
          contactOk: sql`excluded.contact_ok`,
          path: sql`coalesce(${fa.path}, excluded.path)`,
          updatedAt: sql`excluded.updated_at`,
          sheetSyncedAt: null,
        },
        // Same answer, same consent, nothing pending: leave the row (and the Sheet) alone.
        setWhere: sql`${fa.answer} is distinct from excluded.answer or ${fa.contactOk} <> excluded.contact_ok or ${fa.conflictUntil} is not null`,
      })
      .returning({ answer: fa.answer });
    if (rows.length === 0) return { status: "unchanged", path };
    return { status: rows[0].answer === null ? "conflict" : "saved", path };
  } catch (error) {
    if (isMissingPerson(error)) return { status: "gone" };
    throw error;
  }
}

// ── The Sheet ───────────────────────────────────────────────────────────────

const SYNC_BATCH = 100;
const CONFLICT_ANSWER = "Not counted: two different taps arrived together";
const DAY_MS = 24 * 60 * 60 * 1000;

export type SyncResult =
  | { status: "not_configured" }
  | { status: "ok"; sent: number; marked: number }
  | { status: "failed"; pending: number };

type AnswerRow = typeof fa.$inferSelect;
type Context = { email: string; onboardedAt: Date | null; language: string; mealDays: number; plan: "free" | "pass" };

async function contextFor(userIds: string[], now: Date): Promise<Map<string, Context>> {
  const d = await db();
  const [people, meals] = await Promise.all([
    d
      .select({ id: schema.users.id, email: schema.users.email, onboardedAt: schema.profiles.onboardedAt, language: schema.profiles.language })
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(inArray(schema.users.id, userIds)),
    d
      .select({ userId: schema.foodLogs.userId, days: sql<number>`count(distinct ${schema.foodLogs.localDate})::int` })
      .from(schema.foodLogs)
      .where(inArray(schema.foodLogs.userId, userIds))
      .groupBy(schema.foodLogs.userId),
  ]);
  const mealDays = new Map(meals.map((m) => [m.userId, Number(m.days)]));
  const out = new Map<string, Context>();
  for (const p of people) {
    const pass = await activePass(d, p.id, now);
    out.set(p.id, { email: p.email, onboardedAt: p.onboardedAt, language: p.language ?? "en", mealDays: mealDays.get(p.id) ?? 0, plan: pass ? "pass" : "free" });
  }
  return out;
}

function sheetRow(row: AnswerRow, respondent: string, ctx: Context): FeedbackSheetRow {
  const question = isQuestion(row.question) ? row.question : null;
  return {
    answerId: row.id,
    receivedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    survey: row.survey,
    respondent,
    path: row.path ?? "",
    question: row.question,
    answer: row.answer === null ? CONFLICT_ANSWER : question ? answerLabel(question, row.answer) : row.answer,
    plan: ctx.plan,
    daysSinceOnboarding: ctx.onboardedAt ? Math.max(0, Math.floor((row.updatedAt.getTime() - ctx.onboardedAt.getTime()) / DAY_MS)) : null,
    daysWithMeals: ctx.mealDays,
    language: ctx.language,
    source: row.source,
    email: row.contactOk && row.question === "text" ? ctx.email : "",
  };
}

/**
 * Copies answers that aren't in the Sheet yet (one person's, or everyone's for the daily
 * job), then marks each copied unless it changed in the meantime. Never throws: a failure
 * leaves the rows for the next try.
 */
export async function syncFeedback({ userId, limit = SYNC_BATCH, now = new Date() }: { userId?: string; limit?: number; now?: Date } = {}): Promise<SyncResult> {
  if (!sheetsConfigured() || !respondentKey()) return { status: "not_configured" };
  const d = await db();
  const rows = await d
    .select()
    .from(fa)
    .where(userId ? and(isNull(fa.sheetSyncedAt), eq(fa.userId, userId)) : isNull(fa.sheetSyncedAt))
    .orderBy(asc(fa.updatedAt))
    .limit(limit);
  if (rows.length === 0) return { status: "ok", sent: 0, marked: 0 };

  const userIds = [...new Set(rows.map((r) => r.userId))];
  try {
    const ctx = await contextFor(userIds, now);
    const out = rows.flatMap((r) => {
      const c = ctx.get(r.userId);
      const code = respondentCode(r.userId);
      return c && code ? [sheetRow(r, code, c)] : [];
    });
    await appendFeedback(out);
  } catch (error) {
    console.error(`[feedback] sheet copy failed (${rows.length} waiting): ${error instanceof Error ? error.message : "unknown error"}`);
    return { status: "failed", pending: rows.length };
  }

  let marked = 0;
  for (const r of rows) {
    const done = await d
      .update(fa)
      .set({ sheetSyncedAt: now })
      .where(and(eq(fa.id, r.id), eq(fa.updatedAt, r.updatedAt), isNull(fa.sheetSyncedAt)))
      .returning({ id: fa.id });
    marked += done.length;
  }

  // An account deleted while its rows were on the way: the Sheet got them after "forget"
  // ran, so forget again.
  if (marked < rows.length) {
    const still = new Set((await d.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, userIds))).map((u) => u.id));
    for (const id of userIds) {
      const code = still.has(id) ? null : respondentCode(id);
      if (code) await forgetFeedbackInSheet(code, { tries: 1 });
    }
  }
  return { status: "ok", sent: rows.length, marked };
}

// ── Forgetting (account deletion) ───────────────────────────────────────────

/** job_runs rows that hold a forget the Sheet hasn't confirmed yet: "sheet-forget:r_…". */
const FORGET_PREFIX = "sheet-forget:";
const RESPONDENT = /^r_[0-9a-f]{12}$/;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks the Sheet to delete every row for this respondent. Tries a few times; if the Sheet
 * still doesn't answer, leaves a marker for the daily job (syncFeedbackSheet). Never throws.
 */
export async function forgetFeedbackInSheet(respondent: string, { tries = 3, waitMs = 1_500 }: { tries?: number; waitMs?: number } = {}): Promise<"forgotten" | "queued" | "not_configured"> {
  if (!sheetsConfigured() || !RESPONDENT.test(respondent)) return "not_configured";
  const d = await db();
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      await forgetRespondent(respondent);
      await d.delete(schema.jobRuns).where(eq(schema.jobRuns.job, FORGET_PREFIX + respondent));
      return "forgotten";
    } catch (error) {
      if (attempt === tries) console.error(`[feedback] sheet forget failed: ${error instanceof Error ? error.message : "unknown error"}`);
      else await wait(waitMs * attempt);
    }
  }
  await d
    .insert(schema.jobRuns)
    .values({ job: FORGET_PREFIX + respondent, lastStartedAt: new Date() })
    .onConflictDoUpdate({ target: schema.jobRuns.job, set: { lastStartedAt: new Date() } });
  return "queued";
}

/**
 * For the daily job: finish any forgets the Sheet missed, then copy answers that didn't
 * arrive. Counts only, never addresses.
 */
export async function syncFeedbackSheet({ limit = SYNC_BATCH, now = new Date() }: { limit?: number; now?: Date } = {}): Promise<{ forgotten: number; forgetsPending: number; sync: SyncResult }> {
  if (!sheetsConfigured()) return { forgotten: 0, forgetsPending: 0, sync: { status: "not_configured" } };
  const d = await db();
  const queued = await d
    .select({ job: schema.jobRuns.job })
    .from(schema.jobRuns)
    .where(like(schema.jobRuns.job, `${FORGET_PREFIX}%`))
    .limit(50);
  let forgotten = 0;
  for (const { job } of queued) {
    if ((await forgetFeedbackInSheet(job.slice(FORGET_PREFIX.length), { tries: 1 })) === "forgotten") forgotten++;
  }
  return { forgotten, forgetsPending: queued.length - forgotten, sync: await syncFeedback({ limit, now }) };
}
