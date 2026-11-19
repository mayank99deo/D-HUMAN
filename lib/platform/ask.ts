import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { StackPlan } from "@/lib/ai/schemas";
import {
  ASK_ERROR_STATUS,
  ASK_LIMITS,
  ASK_TURN_KINDS,
  askGate,
  askLinkHref,
  isAskLinkId,
  type AskAboutRequest,
  type AskAboutResolved,
  type AskData,
  type AskEarlier,
  type AskError,
  type AskErrorCode,
  type AskLinkId,
  type AskMarker,
  type AskMeal,
  type AskNotice,
  type AskPerson,
  type AskReadLanguage,
  type AskRegion,
  type AskReply,
  type AskReport,
  type AskStack,
  type AskStarterFacts,
  type AskThread,
  type AskTurn,
  type AskTurnKind,
  type AskUsage,
} from "@/lib/ask/types";
import { newId } from "@/lib/auth/crypto";
import { db, schema, type Db } from "@/lib/db";
import type { Profile } from "@/lib/db/schema";
import { markerDef, type MarkerStatus } from "@/lib/domain/markers";
import { SHORT_OF_NEED, inIuOnly, targetsFor } from "@/lib/domain/nutrition";
import { addDays } from "@/lib/domain/periods";
import type { Persona } from "@/lib/domain/persona";
import type { PlanView } from "@/lib/domain/plan";
import { asFlag, type Flag, type Level } from "@/lib/domain/safety";
import { sendFounderAlert } from "@/lib/email/send";
import { dietPictureFrom, totalsOf, type MealKind } from "./food";
import { planView } from "./plan";
import { localDate, personaFor } from "./profile";
import { newestReportOrder, printedFor } from "./reports";
import { inputsChanged } from "./stack";

// Ask's data layer: the day, the question's cleaning, the daily ledger (claim, complete,
// release, free turns), the loader that builds AskData on the allowlist, the thread as the
// browser sees it, and the deletes. The route is app/api/ask/route.ts; the AI is Lane B's
// lib/ai/ask.ts, which never touches the database. Contract:
// docs/team/specs/2026-11-19-ask-build.md; the ledger's design and its proofs on a real
// Postgres: docs/team/specs/2026-11-19-ask-data.md.
//
// Nothing here logs a question, an answer, a marker, a medicine or a meal title.

const { askTurns, askDays, askTotals, foodLogs, dietBaselines, stacks, reports, markers, analyses, profiles, jobRuns } = schema;

export type AskTurnRow = typeof askTurns.$inferSelect;

const DAY_MS = 24 * 60 * 60_000;
/** IST is UTC+5:30 all year (no daylight saving). */
const IST_OFFSET_MS = 330 * 60_000;
/** A read still running after this long has died (lib/platform/analyze.ts STALE_AFTER_MS). */
const READ_STALE_SECONDS = 15 * 60;

// ── The day ─────────────────────────────────────────────────────────────────
// Always the IST date from the server's clock, for everyone: the profile's time zone is set
// by the browser and can't be allowed to open a second "today" (threats spec E1).

/** The IST date, YYYY-MM-DD. The day turns at 18:30 UTC. */
export function istDay(now = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The midnight IST that ends `day`, as ISO (18:30 UTC on `day`). */
export function resetsAt(day: string): string {
  return new Date(Date.parse(`${day}T18:30:00Z`)).toISOString();
}

/** ASK_DAILY_MAX when it's a whole number from 0 up, else the default. 0 switches Ask off. */
export function askDailyMax(raw: string | undefined = process.env.ASK_DAILY_MAX): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return ASK_LIMITS.dailyMaxDefault;
  return Number(value);
}

export type AskCounters = { used: number; attempts: number };

/** Questions left today: 5 − used, or 0 once the day's 10 model calls are spent. */
export const leftOf = (c: AskCounters) => (c.attempts >= ASK_LIMITS.modelCallsPerDay ? 0 : Math.max(0, ASK_LIMITS.perDay - c.used));

/** The founders' 80% alert is due once a day's model calls reach this. */
export const alertLine = (max: number) => Math.ceil(ASK_LIMITS.alertAt * max);

// ── The question ────────────────────────────────────────────────────────────
// Threats spec D3, with the contract's sizes (2–300 code points, 2,000 bytes). Refused,
// never cut: a cut question can mean something else. Stored in NFC; Lane B folds its own
// NFKC copy for matching.

const JOINERS = /[\u200C\u200D]/g;
const MAX_JOINERS = 20;
/** A grapheme built from more code points than this is a pile of marks, not a letter. */
const MAX_CODE_POINTS_PER_CHARACTER = 8;
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });

export type CleanQuestion = { ok: true; question: string } | { ok: false; error: "empty" | "too_long" };

export function cleanQuestion(raw: string): CleanQuestion {
  let s = raw.replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n").normalize("NFC");
  // Out: control characters (newline and tab kept for now), lone surrogates, tag characters
  // (they can carry instructions nobody sees), zero-width and bidi controls, every other
  // format character except the two joiners Indian scripts need, and the invisible
  // Hangul fillers people use as "blank" letters.
  s = s.replace(/[\p{Cc}\p{Cf}\p{Cs}\u{E0000}-\u{E007F}\u115F\u1160\u3164\uFFA0]/gu, (c) =>
    c === "\n" || c === "\t" || c === "\u200C" || c === "\u200D" ? c : "",
  );
  if ((s.match(JOINERS)?.length ?? 0) > MAX_JOINERS) return { ok: false, error: "too_long" };
  // Whitespace: runs become one space, line breaks one newline, ends trimmed.
  s = s
    .replace(/[\t\p{Zs}]+/gu, " ")
    .replace(/ ?\n[ \n]*/g, "\n")
    .trim();
  const points = [...s].length;
  if (points < ASK_LIMITS.questionMinChars) return { ok: false, error: "empty" };
  if (points > ASK_LIMITS.questionMaxChars || Buffer.byteLength(s, "utf8") > ASK_LIMITS.questionMaxBytes) return { ok: false, error: "too_long" };
  for (const { segment } of graphemes.segment(s)) {
    if ([...segment].length > MAX_CODE_POINTS_PER_CHARACTER) return { ok: false, error: "too_long" };
  }
  return { ok: true, question: s };
}

// ── Raw statements ──────────────────────────────────────────────────────────
// The ledger's statements with CTEs run as SQL. PGlite returns { rows }, postgres.js an
// array; they only ever return integers, booleans, text and float8, which both drivers
// read the same way.

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

// ── The ledger ──────────────────────────────────────────────────────────────
// One transaction per claim, locking in one order: the person's ask_days row, then their new
// turn, then the shared ask_totals row. Complete and release take the turn, then the day
// row, then totals. The claim never waits on a turn row (its in-flight check is a plain
// read), so the orders can't cross (data spec §1.3–1.4; proven on Postgres 17).

/** Hands back this person's questions that died mid-call (still pending after 45 s). */
async function handBackDead(q: Db, userId: string) {
  await q.execute(sql`
    with dead as (
      delete from ask_turns
      where user_id = ${userId} and status = 'pending' and created_at < now() - make_interval(secs => ${ASK_LIMITS.pendingStaleSeconds})
      returning day
    ), per_day as (select day, count(*)::int as n from dead group by day)
    update ask_days d set used = greatest(d.used - per_day.n, 0)
    from per_day where d.user_id = ${userId} and d.day = per_day.day`);
}

// Thrown inside the claim's transaction so a refusal rolls back everything it counted.
class Refused extends Error {
  reason: "limit" | "too_many_tries" | "busy" | "paused" | "duplicate";
  counters?: AskCounters & { everyone?: number };
  constructor(reason: Refused["reason"], counters?: Refused["counters"]) {
    super(reason);
    this.reason = reason;
    this.counters = counters;
  }
}

export type AskClaim =
  | { ok: true; turnId: string; at: Date; used: number; attempts: number; everyone: number }
  | { ok: false; reason: "limit" | "too_many_tries"; used: number; attempts: number }
  | { ok: false; reason: "busy" | "duplicate" }
  | { ok: false; reason: "paused"; everyone: number };

/**
 * Counts one question and one model call for the person, and one call for everyone, then
 * records the question as pending. Refused (and nothing changed) when: 5 questions are
 * used ("limit"), 10 calls are ("too_many_tries"), another question is in flight ("busy"),
 * this client key was used before ("duplicate"), or the day's breaker is full ("paused";
 * the person's own count isn't touched).
 */
export async function claimAsk(input: {
  userId: string;
  clientKey: string;
  day: string;
  question: string;
  reportId: string | null;
  max: number;
}): Promise<AskClaim> {
  const { userId, clientKey, day, question, reportId, max } = input;
  const d = await db();
  const id = newId();
  try {
    return await d.transaction(async (tx) => {
      await handBackDead(tx, userId);
      // The person: locks their row; a parallel claim waits here, then sees the new counts.
      const [mine] = await tx
        .insert(askDays)
        .values({ userId, day, used: 1, attempts: 1 })
        .onConflictDoUpdate({
          target: [askDays.userId, askDays.day],
          set: { used: sql`${askDays.used} + 1`, attempts: sql`${askDays.attempts} + 1` },
          setWhere: sql`${askDays.used} < ${ASK_LIMITS.perDay} and ${askDays.attempts} < ${ASK_LIMITS.modelCallsPerDay}`,
        })
        .returning({ used: askDays.used, attempts: askDays.attempts });
      if (!mine) {
        // ON CONFLICT … WHERE locks the row even when it refuses, so this read is current.
        const [row] = await tx.select({ used: askDays.used, attempts: askDays.attempts }).from(askDays).where(and(eq(askDays.userId, userId), eq(askDays.day, day)));
        const counters = row ?? { used: 0, attempts: 0 };
        throw new Refused(counters.used >= ASK_LIMITS.perDay ? "limit" : "too_many_tries", counters);
      }
      // The question, when none of theirs is in flight. A repeated client key inserts nothing.
      const [turn] = rowsOf<{ id: string; at_ms: number }>(
        await tx.execute(sql`
          insert into ask_turns (id, user_id, client_key, day, question, report_id)
          select ${id}, ${userId}, ${clientKey}, ${day}::date, ${question}, ${reportId}
          where not exists (
            select 1 from ask_turns
            where user_id = ${userId} and status = 'pending' and created_at > now() - make_interval(secs => ${ASK_LIMITS.pendingStaleSeconds})
          )
          on conflict (user_id, client_key) do nothing
          returning id, (extract(epoch from created_at) * 1000)::float8 as at_ms`),
      );
      if (!turn) {
        const [same] = await tx.select({ status: askTurns.status }).from(askTurns).where(and(eq(askTurns.userId, userId), eq(askTurns.clientKey, clientKey)));
        throw new Refused(same?.status === "answered" ? "duplicate" : "busy");
      }
      // Everyone, last, so the hot shared row stays locked for one statement until COMMIT.
      const [all] = await tx
        .insert(askTotals)
        .values({ day, attempts: 1 })
        .onConflictDoUpdate({ target: askTotals.day, set: { attempts: sql`${askTotals.attempts} + 1` }, setWhere: sql`${askTotals.attempts} < ${max}` })
        .returning({ attempts: askTotals.attempts });
      if (!all) throw new Refused("paused", { used: 0, attempts: 0, everyone: max });
      return { ok: true as const, turnId: turn.id, at: new Date(Number(turn.at_ms)), used: mine.used, attempts: mine.attempts, everyone: all.attempts };
    });
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    const c = error.counters;
    switch (error.reason) {
      case "limit":
      case "too_many_tries":
        return { ok: false, reason: error.reason, used: c?.used ?? 0, attempts: c?.attempts ?? 0 };
      case "paused":
        return { ok: false, reason: "paused", everyone: c?.everyone ?? max };
      default:
        return { ok: false, reason: error.reason };
    }
  }
}

/** Keeps stored link ids to the fixed table: known, no repeats, at most 2. */
export function cleanLinkIds(ids: readonly unknown[] | null | undefined): AskLinkId[] {
  return [...new Set((ids ?? []).filter(isAskLinkId))].slice(0, ASK_LIMITS.linksMax);
}

/** A last guard on the AI text before it's stored; Lane B already cut it at a full sentence. */
const capAnswer = (answer: string | null) => (answer == null ? null : [...answer].slice(0, ASK_LIMITS.answerMaxChars).join(""));

/**
 * Saves the answer, only if the turn is still pending and no report delete reached it.
 * A kind that doesn't count hands the question back. Adds the outcome to everyone's totals.
 * False when nothing was saved (the caller then releases and answers report_deleted).
 */
export async function completeAsk(input: { turnId: string; userId: string; reply: AskReply; usage: AskUsage; counted: boolean }): Promise<boolean> {
  const { turnId, userId, reply, counted } = input;
  const one = (kind: AskTurnKind) => (reply.kind === kind ? 1 : 0);
  const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  const usage = { ...input.usage, inputTokens: whole(input.usage.inputTokens), outputTokens: whole(input.usage.outputTokens), costMicros: whole(input.usage.costMicros), ms: whole(input.usage.ms) };
  const d = await db();
  const rows = rowsOf<{ ok: number }>(
    await d.execute(sql`
      with done as (
        update ask_turns set status = 'answered', kind = ${reply.kind}, counted = ${counted}, answer = ${capAnswer(reply.answer)},
          notice = ${reply.notice ? JSON.stringify(reply.notice) : null}::jsonb, links = ${JSON.stringify(cleanLinkIds(reply.links))}::jsonb,
          lang = ${reply.lang}, model = ${usage.model}, input_tokens = ${usage.inputTokens}, output_tokens = ${usage.outputTokens},
          ms = ${usage.ms}, answered_at = now()
        where id = ${turnId} and user_id = ${userId} and status = 'pending' and removed_at is null
        returning day, counted
      ), refund as (
        update ask_days d set used = greatest(d.used - 1, 0) from done
        where not done.counted and d.user_id = ${userId} and d.day = done.day
        returning 1
      )
      update ask_totals t set answered = t.answered + 1,
        off_topic = t.off_topic + ${one("off_topic")}, doctor = t.doctor + ${one("doctor")},
        urgent = t.urgent + ${one("urgent")}, crisis = t.crisis + ${one("crisis")},
        input_tokens = t.input_tokens + ${usage.inputTokens}, output_tokens = t.output_tokens + ${usage.outputTokens},
        cost_micros = t.cost_micros + ${usage.costMicros}
      from done where t.day = done.day
      returning 1 as ok`),
  );
  return rows.length > 0;
}

/** Hands a question back: deletes the turn if it's still pending and gives back its use. Safe to run twice. Model calls stay counted. */
export async function releaseAsk(turnId: string, userId: string): Promise<void> {
  const d = await db();
  await d.execute(sql`
    with gone as (delete from ask_turns where id = ${turnId} and user_id = ${userId} and status = 'pending' returning day)
    update ask_days d set used = greatest(d.used - 1, 0) from gone where d.user_id = ${userId} and d.day = gone.day`);
}

/**
 * Saves a reply code wrote before any model call (crisis, emergency, an urgent marker
 * named): answered, not counted, no claim. Adds it to everyone's crisis or urgent count,
 * never to the model calls. A client key used before returns that turn instead.
 */
export async function saveFreeTurn(input: {
  userId: string;
  clientKey: string;
  day: string;
  question: string;
  reportId: string | null;
  reply: AskReply;
}): Promise<{ turn: AskTurnRow } | { busy: true }> {
  const { userId, clientKey, day, question, reportId, reply } = input;
  const d = await db();
  return d.transaction(async (tx) => {
    // A dead question with this same key would block the insert; hand it back first.
    await handBackDead(tx, userId);
    const [turn] = await tx
      .insert(askTurns)
      .values({
        id: newId(),
        userId,
        clientKey,
        day,
        status: "answered",
        kind: reply.kind,
        counted: false,
        question,
        answer: capAnswer(reply.answer),
        notice: reply.notice,
        links: cleanLinkIds(reply.links),
        lang: reply.lang,
        reportId,
        answeredAt: new Date(),
      })
      .onConflictDoNothing({ target: [askTurns.userId, askTurns.clientKey] })
      .returning();
    if (!turn) {
      const [same] = await tx.select().from(askTurns).where(and(eq(askTurns.userId, userId), eq(askTurns.clientKey, clientKey)));
      return same?.status === "answered" ? { turn: same } : { busy: true as const };
    }
    const urgent = reply.kind === "urgent" ? 1 : 0;
    const crisis = reply.kind === "crisis" ? 1 : 0;
    await tx
      .insert(askTotals)
      .values({ day, urgent, crisis })
      .onConflictDoUpdate({ target: askTotals.day, set: { urgent: sql`${askTotals.urgent} + ${urgent}`, crisis: sql`${askTotals.crisis} + ${crisis}` } });
    return { turn };
  });
}

/** The person's counts for a day (0 and 0 before their first question). */
export async function askCounters(userId: string, day: string): Promise<AskCounters> {
  const d = await db();
  const [row] = await d.select({ used: askDays.used, attempts: askDays.attempts }).from(askDays).where(and(eq(askDays.userId, userId), eq(askDays.day, day)));
  return row ?? { used: 0, attempts: 0 };
}

/** A turn by its client key, any day: a retry finds the question it already asked. */
export async function turnByClientKey(userId: string, clientKey: string): Promise<AskTurnRow | null> {
  const d = await db();
  const [row] = await d.select().from(askTurns).where(and(eq(askTurns.userId, userId), eq(askTurns.clientKey, clientKey)));
  return row ?? null;
}

// ── The breaker's alerts ────────────────────────────────────────────────────

/**
 * Tells the founders when the day's model calls reach 80% of ASK_DAILY_MAX ("80") or when
 * the breaker first refuses someone ("cap"). Once a day each, by a job_runs marker, as the
 * weekly email's capAlert does; a send that doesn't go frees the marker for a later try.
 * Counts only.
 */
export async function askAlert(which: "80" | "cap", day: string, count: number, max: number, now = new Date()): Promise<string> {
  const marker = `alert:ask-${which}:${day}`;
  const d = await db();
  const [won] = await d.insert(jobRuns).values({ job: marker, lastStartedAt: now }).onConflictDoNothing().returning({ job: jobRuns.job });
  if (!won) return "already_sent";
  const subject =
    which === "80" ? "D-Human: Ask has used 80% of today's limit" : "D-Human: Ask reached today's limit and is resting until midnight (IST)";
  const lines = [
    `Ask has started ${count} model calls today (IST day ${day}). The limit, ASK_DAILY_MAX, is ${max} a day across everyone.`,
    which === "80"
      ? "At the limit, Ask rests for everyone until midnight IST. Crisis and emergency replies still work, and nobody's own questions are used up."
      : "Ask is resting for everyone until midnight IST. Crisis and emergency replies still work, and nobody's own questions are used up.",
    "If this is real use, raise ASK_DAILY_MAX in Vercel and redeploy.",
    "",
    "Sent once a day by Ask. Counts only.",
  ];
  const outcome = await sendFounderAlert({ key: `ask-${which}:${day}`, subject, text: lines.join("\n") }, now).catch(() => ({ status: "failed" as const, error: "threw" }));
  if (outcome.status !== "sent") {
    await d.delete(jobRuns).where(eq(jobRuns.job, marker));
    return outcome.status === "failed" ? "failed" : outcome.reason;
  }
  return "sent";
}

// ── Deletes ─────────────────────────────────────────────────────────────────

/** "Clear now": deletes the person's answered questions, any day. A question in flight stays; counts never change. */
export async function clearAsks(userId: string): Promise<number> {
  const d = await db();
  const gone = await d.delete(askTurns).where(and(eq(askTurns.userId, userId), eq(askTurns.status, "answered"))).returning({ id: askTurns.id });
  return gone.length;
}

/**
 * Inside deleteReports' transaction, once any report went: blanks every answer that used
 * report data and keeps the questions (the person wrote them). Any report, not only the
 * deleted one: an answer can quote an earlier answer that used another report. A turn in
 * flight is marked too, so it can't be saved, and is handed back.
 */
export async function blankAskAnswers(tx: Db, userId: string): Promise<number> {
  const rows = await tx
    .update(askTurns)
    .set({ answer: null, links: null, notice: null, removedAt: new Date() })
    .where(and(eq(askTurns.userId, userId), isNotNull(askTurns.reportId), isNull(askTurns.removedAt)))
    .returning({ id: askTurns.id });
  return rows.length;
}

/**
 * The daily job's purge: questions and per-person counts from before today (IST), less
 * ASK_LIMITS.keepDays. Everyone's totals stay: they hold no personal data.
 */
export async function purgeAsks(d: Db, now = new Date()): Promise<{ askTurns: number; askDays: number }> {
  const cutoff = addDays(istDay(now), -ASK_LIMITS.keepDays);
  const [turns, days] = await Promise.all([
    d.delete(askTurns).where(lt(askTurns.day, cutoff)).returning({ id: askTurns.id }),
    d.delete(askDays).where(lt(askDays.day, cutoff)).returning({ day: askDays.day }),
  ]);
  return { askTurns: turns.length, askDays: days.length };
}

/** The one-time notice: sets ask_consent_at if it isn't set. Repeating it changes nothing. */
export async function acceptAskConsent(userId: string): Promise<Date | null> {
  const d = await db();
  const [row] = await d
    .update(profiles)
    .set({ askConsentAt: sql`coalesce(${profiles.askConsentAt}, now())` })
    .where(eq(profiles.userId, userId))
    .returning({ at: profiles.askConsentAt });
  return row?.at ?? null;
}

// ── The person's data, on the allowlist ─────────────────────────────────────
// Threats spec D4: no name, email, city, lab, report name, brands in the pack, prices, URLs,
// web-search text or the read's words. Every query takes the user id from the session.

const STATUSES: readonly MarkerStatus[] = ["low", "edge_low", "in_range", "edge_high", "high", "unknown"];
const LEVELS: readonly Level[] = ["go", "go_with_tweaks", "build", "doctor_first"];
const asStatus = (s: string): MarkerStatus => (STATUSES.includes(s as MarkerStatus) ? (s as MarkerStatus) : "unknown");
const catalogueName = (key: string | null, printed: string) => markerDef(key)?.name ?? printed;

export const askRegion = (timezone: string | null | undefined): AskRegion => (!timezone || timezone === "Asia/Kolkata" || timezone === "Asia/Calcutta" ? "in" : "other");
const readLanguageOf = (language: string | null | undefined): AskReadLanguage => (language === "hi" || language === "hinglish" ? language : "en");

type StackRow = { id: string; status: string; reportId: string | null; plan: unknown; createdAt: Date };
type FlaggedMarker = { name: string; flag: Flag };

/**
 * The stack as the Stack screen would show it (contract §14), so Ask never quotes a dose the
 * screen hides: none (no stack, or building or failed); held (an urgent result on the newest
 * report, else pregnancy); stale (the stack's report isn't the newest, else changed diet,
 * medicines or conditions); otherwise current, with the saved plan's items.
 */
export function askStackState(
  stack: StackRow | null,
  newest: { id: string; flagged: FlaggedMarker[] } | null,
  profile: Pick<Profile, "conditions" | "diet" | "medications">,
): AskStack {
  if (!stack || stack.status !== "ready") return { state: "none" };
  const builtOn = istDay(stack.createdAt);
  const leftForDoctor = [...new Set((newest?.flagged ?? []).map((m) => m.name))];
  if (newest?.flagged.some((m) => m.flag === "urgent")) return { state: "held", reason: "urgent", builtOn, leftForDoctor };
  if (profile.conditions.includes("pregnant")) return { state: "held", reason: "pregnant", builtOn, leftForDoctor };
  if (stack.reportId !== (newest?.id ?? null)) return { state: "stale", reason: "report", builtOn };
  if (inputsChanged(stack.plan, profile)) return { state: "stale", reason: "profile", builtOn };
  const plan = stack.plan as StackPlan | null;
  return {
    state: "current",
    builtOn,
    basis: stack.reportId ? "report" : "meals",
    items: (plan?.items ?? []).map((i) => ({
      nutrient: i.nutrient,
      form: i.form ?? "",
      dose: i.dose,
      timing: i.timing ?? "",
      duration: i.duration ?? "",
      cautions: i.cautions ?? null,
    })),
    skip: (plan?.skip ?? []).map((s) => s.name),
    leftForDoctor,
  };
}

/** Brand names in their own saved stack, for the brand filter only (never the prompt). */
function stackBrandsOf(plan: unknown): string[] {
  const items = (plan as StackPlan | null)?.items ?? [];
  return [...new Set(items.flatMap((i) => (i.brands ?? []).map((b) => b.brand?.trim())).filter((b): b is string => !!b))];
}

/** What the loader read, before it's cut into AskData and the thread. */
export type AskLoad = {
  day: string;
  now: Date;
  /** Today's turns, oldest first, plus any turn with the request's client key (any day). */
  turns: AskTurnRow[];
  counters: AskCounters;
  /** Everyone's model calls today. */
  everyone: number;
  mealsEver: boolean;
  /** A report is being read right now. */
  reading: boolean;
  persona: Persona;
  newest: { id: string; analyzedAt: Date | null; nameOnReport: string | null; markers: AskMarker[] } | null;
  /** The latest stack's created_at when it's ready (for stale turns). */
  stackMadeAt: Date | null;
  data: Omit<AskData, "plan">;
  plan: PlanView | null;
  about: AskAboutResolved | null;
};

/**
 * Everything Ask needs about one person, in one parallel batch after the session and
 * profile: today's turns, the counters, 14 days of meals, the usual day, the latest stack,
 * the newest ready report with its markers (one statement), the plan (POST only) and the
 * "Ask about this" target, each looked up in their own data and ignored when not found.
 */
export async function loadAsk(
  userId: string,
  profile: Profile,
  opts: { now?: Date; clientKey?: string; about?: AskAboutRequest; plan?: boolean } = {},
): Promise<AskLoad> {
  const now = opts.now ?? new Date();
  const day = istDay(now);
  const today = localDate(profile.timezone, now);
  const from = localDate(profile.timezone, new Date(now.getTime() - 13 * DAY_MS));
  const d = await db();
  const about = opts.about;

  const [turns, scalars, logs, baselines, latestStacks, reportRows, plan, aboutMarker, aboutMeal] = await Promise.all([
    d
      .select()
      .from(askTurns)
      .where(and(eq(askTurns.userId, userId), opts.clientKey ? or(eq(askTurns.day, day), eq(askTurns.clientKey, opts.clientKey)) : eq(askTurns.day, day)))
      .orderBy(asc(askTurns.createdAt)),
    d.execute(sql`
      select
        coalesce((select used from ask_days where user_id = ${userId} and day = ${day}::date), 0)::int as used,
        coalesce((select attempts from ask_days where user_id = ${userId} and day = ${day}::date), 0)::int as attempts,
        coalesce((select attempts from ask_totals where day = ${day}::date), 0)::int as everyone,
        exists (select 1 from food_logs where user_id = ${userId}) as meals_ever,
        exists (
          select 1 from reports where user_id = ${userId} and status in ('reading', 'interpreting')
          and started_at > now() - make_interval(secs => ${READ_STALE_SECONDS})
        ) as reading`),
    d
      .select({
        localDate: foodLogs.localDate,
        meal: foodLogs.meal,
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
      .where(and(eq(foodLogs.userId, userId), gte(foodLogs.localDate, from), lte(foodLogs.localDate, today)))
      .orderBy(asc(foodLogs.createdAt)),
    d.select({ description: dietBaselines.description, estimate: dietBaselines.estimate }).from(dietBaselines).where(eq(dietBaselines.userId, userId)).limit(1),
    d
      .select({ id: stacks.id, status: stacks.status, reportId: stacks.reportId, plan: stacks.plan, createdAt: stacks.createdAt })
      .from(stacks)
      .where(eq(stacks.userId, userId))
      .orderBy(desc(stacks.createdAt))
      .limit(1),
    // The newest ready report by when the blood was taken (newestReadyReport's order) and its
    // markers, in one statement so the two always match. The read's verdict level only, never its words.
    d
      .select({
        id: reports.id,
        collectedOn: reports.collectedOn,
        nameOnReport: reports.nameOnReport,
        analyzedAt: reports.analyzedAt,
        level: sql<string | null>`(select ${analyses.read}->'verdict'->>'level' from ${analyses} where ${analyses.reportId} = ${reports.id})`,
        key: markers.key,
        name: markers.name,
        value: markers.value,
        valueText: markers.valueText,
        unit: markers.unit,
        refLow: markers.refLow,
        refHigh: markers.refHigh,
        status: markers.status,
        flag: markers.flag,
      })
      .from(reports)
      .leftJoin(markers, and(eq(markers.reportId, reports.id), eq(markers.userId, userId)))
      .where(
        and(
          eq(reports.userId, userId),
          inArray(
            reports.id,
            d
              .select({ id: reports.id })
              .from(reports)
              .where(and(eq(reports.userId, userId), eq(reports.status, "ready")))
              .orderBy(...newestReportOrder())
              .limit(1),
          ),
        ),
      )
      .orderBy(asc(markers.position)),
    opts.plan ? planView(userId, profile.timezone) : Promise.resolve(null),
    about?.type === "marker"
      ? d.select({ key: markers.key, name: markers.name }).from(markers).where(and(eq(markers.id, about.id), eq(markers.userId, userId))).limit(1)
      : Promise.resolve([]),
    about?.type === "meal"
      ? d.select({ title: foodLogs.title }).from(foodLogs).where(and(eq(foodLogs.id, about.id), eq(foodLogs.userId, userId))).limit(1)
      : Promise.resolve([]),
  ]);

  const [s] = rowsOf<{ used: number; attempts: number; everyone: number; meals_ever: boolean; reading: boolean }>(scalars);
  const persona = personaFor(profile);
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  const baseline = baselines[0] ?? null;
  const diet = dietPictureFrom(profile, logs, baseline);
  const todayLogs = logs.filter((l) => l.localDate === today);

  const first = reportRows[0];
  const newestMarkers: AskMarker[] = reportRows
    .filter((r) => r.name != null && r.status != null)
    .map((r) => ({
      key: r.key,
      printedName: r.name!,
      value: r.value,
      valueText: r.valueText,
      unit: r.unit,
      refLow: r.refLow,
      refHigh: r.refHigh,
      status: asStatus(r.status!),
      flag: asFlag(r.flag),
    }));
  const newest = first ? { id: first.id, analyzedAt: first.analyzedAt, nameOnReport: first.nameOnReport, markers: newestMarkers } : null;
  const report: AskReport | null = first
    ? {
        id: first.id,
        collectedOn: first.collectedOn,
        verdictLevel: LEVELS.includes(first.level as Level) ? (first.level as Level) : null,
        mayNotBeTheirs: printedFor(first.nameOnReport, profile.name) != null,
        markers: newestMarkers,
      }
    : null;
  const flagged = newestMarkers.flatMap((m) => (m.flag ? [{ name: catalogueName(m.key, m.printedName), flag: m.flag }] : []));

  const stackRow = latestStacks[0] ?? null;
  const stack = askStackState(stackRow, newest && { id: newest.id, flagged }, profile);
  const counters = { used: s?.used ?? 0, attempts: s?.attempts ?? 0 };

  const person: AskPerson = {
    age: persona.age,
    sex: profile.sex,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    archetype: persona.archetype,
    level: profile.level,
    sessionsPerWeek: profile.sessionsPerWeek,
    goals: profile.goals,
    eventTyped: profile.eventInMind,
    diet: profile.diet,
    conditions: profile.conditions,
    medications: profile.medications,
    currentSupplements: profile.currentSupplements,
    readLanguage: readLanguageOf(profile.language),
  };
  const meals: AskMeal[] = todayLogs.map((l) => ({ meal: l.meal as MealKind, title: l.title, at: l.createdAt, kcal: l.kcal, proteinG: l.proteinG }));

  const data: Omit<AskData, "plan"> = {
    now,
    timezone: profile.timezone || "Asia/Kolkata",
    region: askRegion(profile.timezone),
    person,
    // Once this question counts; the route sets it again from the claim.
    asksLeft: Math.max(0, leftOf(counters) - 1),
    targets,
    today: { meals, totals: totalsOf(todayLogs) },
    diet,
    usualDay: baseline?.description ?? null,
    report,
    stack,
    stackBrands: stackRow ? stackBrandsOf(stackRow.plan) : [],
  };

  let resolved: AskAboutResolved | null = null;
  if (about?.type === "marker" && aboutMarker[0]) resolved = { type: "marker", key: aboutMarker[0].key, name: catalogueName(aboutMarker[0].key, aboutMarker[0].name) };
  if (about?.type === "meal" && aboutMeal[0]) resolved = { type: "meal", title: aboutMeal[0].title };
  if (about?.type === "stack_item" && stack.state === "current") {
    const wanted = about.nutrient.trim().toLowerCase();
    const item = stack.items.find((i) => i.nutrient.trim().toLowerCase() === wanted);
    if (item) resolved = { type: "stack_item", nutrient: item.nutrient };
  }
  if (about?.type === "gaps" && diet.gaps.length) resolved = { type: "gaps" };

  return {
    day,
    now,
    turns,
    counters,
    everyone: s?.everyone ?? 0,
    mealsEver: !!s?.meals_ever,
    reading: !!s?.reading,
    persona,
    newest,
    stackMadeAt: stackRow?.status === "ready" ? stackRow.createdAt : null,
    data,
    plan,
    about: resolved,
  };
}

// ── The thread, as the browser sees it ──────────────────────────────────────

const isTurnKind = (k: string | null): k is AskTurnKind => !!k && (ASK_TURN_KINDS as readonly string[]).includes(k);

/** A pending turn this old has died; it's hidden and the next claim hands it back. */
export const isLivePending = (row: Pick<AskTurnRow, "status" | "createdAt">, now: Date) =>
  row.status === "pending" && now.getTime() - row.createdAt.getTime() < ASK_LIMITS.pendingStaleSeconds * 1000;

/** A stored answered turn as AskTurn: link ids become hrefs; a removed answer shows nothing but its question. */
export function turnView(row: AskTurnRow, ctx: { newestReportId: string | null; staleBefore?: Date | null }): AskTurn {
  const removed = row.removedAt != null;
  const links = removed
    ? []
    : cleanLinkIds(row.links as unknown[] | null).flatMap((id) => {
        const href = askLinkHref(id, ctx.newestReportId);
        return href ? [{ id, href }] : [];
      });
  return {
    id: row.id,
    clientKey: row.clientKey,
    question: row.question,
    at: row.createdAt.toISOString(),
    kind: isTurnKind(row.kind) ? row.kind : "answer",
    answer: removed ? null : row.answer,
    notice: removed ? null : ((row.notice as AskNotice | null) ?? null),
    links,
    lang: row.lang ?? "en",
    removed: removed ? "report_deleted" : null,
    stale: !!ctx.staleBefore && row.createdAt < ctx.staleBefore,
    demo: row.model === "mock",
  };
}

/** The last answered pairs from today for a follow-up, oldest first; never a removed or empty answer. */
export function earlierTurns(load: Pick<AskLoad, "turns" | "day">): AskEarlier[] {
  return load.turns
    .filter((t) => t.day === load.day && t.status === "answered" && t.removedAt == null && t.answer)
    .slice(-ASK_LIMITS.earlierTurns)
    .map((t) => ({ question: t.question, answer: t.answer! }));
}

const STARTER_STATUSES: readonly MarkerStatus[] = ["low", "edge_low", "edge_high"];

/** What the browser needs to pick starters (Lane C holds the words). */
export function starterFacts(load: AskLoad): AskStarterFacts {
  const { data, newest, persona } = load;
  const marks = newest?.markers ?? [];
  const flagged = marks.find((m) => m.flag === "urgent") ?? marks.find((m) => m.flag === "doctor") ?? null;
  let foodMarker: { name: string } | null = null;
  for (const key of persona.priorities) {
    const m = marks.find((x) => x.key === key && !x.flag && STARTER_STATUSES.includes(x.status));
    if (m) {
      foodMarker = { name: catalogueName(m.key, m.printedName) };
      break;
    }
  }
  const proteinLeft = data.targets.proteinG > 0 ? Math.round((data.targets.proteinG - data.today.totals.proteinG) / 5) * 5 : null;
  return {
    archetype: persona.archetype,
    flagged: flagged ? { name: catalogueName(flagged.key, flagged.printedName) } : null,
    foodMarker,
    proteinLeftG: proteinLeft != null && proteinLeft >= 10 ? proteinLeft : null,
    mealsToday: data.today.meals.length,
    mealsEver: load.mealsEver,
    hasGaps: !!data.diet.perDay && data.diet.gaps.some((g) => g.pct < SHORT_OF_NEED && !inIuOnly(g.key)),
    stackItem: data.stack.state === "current" ? (data.stack.items[0]?.nutrient ?? null) : null,
  };
}

/** GET /api/ask's body. */
export function askThread(load: AskLoad, profile: Pick<Profile, "askConsentAt" | "name">, state: AskThread["state"]): AskThread {
  const newestReportId = load.newest?.id ?? null;
  const times = [load.newest?.analyzedAt, load.stackMadeAt].filter((t): t is Date => !!t);
  const staleBefore = times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null;
  const today = load.turns.filter((t) => t.day === load.day);
  const pending = today.filter((t) => isLivePending(t, load.now)).at(-1);
  const urgent = [
    ...new Set((load.newest?.markers ?? []).filter((m) => m.flag === "urgent").map((m) => catalogueName(m.key, m.printedName))),
  ];
  return {
    turns: today.filter((t) => t.status === "answered").map((t) => turnView(t, { newestReportId, staleBefore })),
    pending: pending ? { clientKey: pending.clientKey, question: pending.question, at: pending.createdAt.toISOString() } : null,
    left: leftOf(load.counters),
    day: load.day,
    resetsAt: resetsAt(load.day),
    state,
    consentNeeded: !profile.askConsentAt,
    pinned: { urgent, printedFor: load.newest ? printedFor(load.newest.nameOnReport, profile.name) : null },
    report: load.reading ? "reading" : load.newest ? "ready" : "none",
    region: load.data.region,
    readLanguage: load.data.person.readLanguage,
    starters: starterFacts(load),
  };
}

// ── HTTP helpers for the routes ─────────────────────────────────────────────
// Route files may export only handlers and config, so the shared bits live here.

/** Every Ask response: JSON, never cached anywhere. */
export const askJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** An error body: { error, left?, day?, resetsAt? } with the code's status (ASK_ERROR_STATUS). */
export const askFail = (error: AskErrorCode, fields: Partial<{ left: number; day: string; resetsAt: string }> = {}) =>
  askJson({ error, ...fields } satisfies AskError, ASK_ERROR_STATUS[error]);

/** The day fields every reply carries once the person is known. */
export const dayFields = (day: string) => ({ day, resetsAt: resetsAt(day) });

/** askGate as the routes answer it: 403 not_allowed (founders only, or under 18; the reason isn't revealed) or 409 not_onboarded. */
export function askGateError(user: { email: string }, profile: Pick<Profile, "onboardedAt" | "birthYear"> | null): "not_allowed" | "not_onboarded" | null {
  const gate = askGate({ email: user.email, onboardedAt: profile?.onboardedAt ?? null, birthYear: profile?.birthYear ?? null });
  if (gate === "closed" || gate === "under_18") return "not_allowed";
  if (gate === "not_onboarded" || !profile) return "not_onboarded";
  return null;
}

/** For logs: an error's class name only, never its message (a failed query's message holds its parameters). */
export const errorClass = (error: unknown) => (error instanceof Error ? error.constructor.name || "Error" : typeof error);
