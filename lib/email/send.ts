import "server-only";
import { and, count, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { CreateEmailOptions, ErrorResponse } from "resend";
import { newId } from "@/lib/auth/crypto";
import { db, schema, type Db } from "@/lib/db";
import { absoluteUrl } from "@/lib/site-url";
import { lifecycleLeft, utcDayStart } from "./budget";
import { emailMode, fromAddress, replyToFor, resend, sendingAllowed, whereRunning } from "./client";
import { countOtherSend, otherSentToday, type OtherStream } from "./counts";
import { kindAllowed, type EmailPrefs } from "./prefs";
import { emailLinksReady, oneClickUrl, stopPageUrl } from "./tokens";
import { DEFAULT_EMAIL_PREFS, KIND_CATEGORY, batchIdempotencyKey, sendIdempotencyKey, type EmailFrame, type EmailKind, type RenderedEmail } from "./types";

// Sending a lifecycle email: once, within the day's budget, never to someone who stopped
// it or whose address bounced. Sign-in codes never come through here.
//
// One send:
//   1. Look up the person (address, first name, settings, suppression) in one query.
//   2. Under the budget lock, claim the ledger row (unique on person, kind and dedupe key)
//      and reserve today's budget by setting sent_at. No row: someone else has it.
//      Over budget: nothing is written, so the next run sees the person as not yet sent.
//   3. Render with the send id (it goes on every link as e=), then call Resend with
//      the idempotency key, so a retry within 24 hours can't send twice either.
//   4. Record the answer. A clear refusal (4xx): "failed", the budget given back, retried
//      later under a new key. No clear answer (timeout, 5xx): the row stays "sending" with
//      the same key, for the jobs lane's sweep. A 409 (the key was used for different
//      content, or is in flight): "unknown", never resent, since a missed email beats a
//      double one.
//
// Only from production (sendingAllowed in client.ts): anywhere else every call is a
// logged no-op that claims nothing.

const sends = schema.emailSends;

/** A failed send is tried at most this many times in all. */
export const MAX_ATTEMPTS = 3;
/** A "sending" row this young may still be in flight: leave it alone. */
export const SENDING_GRACE_MS = 10 * 60 * 1000;
/** Resend keeps idempotency keys for 24 hours; past this a "sending" row can't be retried safely. */
export const SENDING_MAX_AGE_MS = 23 * 60 * 60 * 1000;
const RESEND_BATCH_MAX = 100;
const REQUEST_TIMEOUT_MS = 15_000;
/** One by one, at most 4 a second, leaving Resend's 10 a second for sign-in codes. */
const PACE_MS = 250;

export type LifecycleEmail = {
  userId: string;
  kind: EmailKind;
  /** "once" for welcomes, the week's Monday for weekly, the survey id for feedback (lib/email/types.ts). */
  dedupeKey: string;
  /** The person's own calendar day, YYYY-MM-DD, for the one-a-day cap. */
  localDate: string;
  variant?: string | null;
  /** The templates lane's function, given the frame (send id, links, address) for this send. */
  render: (frame: EmailFrame) => RenderedEmail;
};

export type SendOutcome =
  | { status: "sent"; sendId: string; providerId: string }
  /** Already claimed by this or another run: nothing done. */
  | { status: "duplicate" }
  | { status: "skipped"; reason: "no_person" | "suppressed" | "turned_off" | "gave_up" }
  /** Over today's budget: nothing written; the next run tries again. */
  | { status: "budget" }
  /** Resend refused it (or it failed to render); retry later under a new key. */
  | { status: "failed"; sendId: string; error: string; retryAfterSeconds?: number }
  /** No clear answer; the row stays "sending" for the sweep. */
  | { status: "pending"; sendId: string; error: string }
  /** Can't tell whether it went; marked "unknown" and never resent. */
  | { status: "unknown"; sendId: string; error: string }
  /** Nothing claimed or sent: not production, or RESEND_API_KEY or EMAIL_LINK_SECRET missing. */
  | { status: "not_configured"; reason: "not_production" | "no_api_key" | "no_link_secret" };

export type SendOptions = { now?: Date; origin?: string };

type Recipient = { userId: string; email: string; firstName: string | null; prefs: EmailPrefs; suppressed: boolean };
type Claimed = { sendId: string; email: LifecycleEmail; recipient: Recipient; index: number };

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const keyOf = (e: Pick<LifecycleEmail, "userId" | "kind" | "dedupeKey">) => `${e.kind}\u0000${e.userId}\u0000${e.dedupeKey}`;
const originOf = (opts: SendOptions) => (opts.origin ?? absoluteUrl("/")).replace(/\/+$/, "");

/** Resend's idempotency key for a send's next try: the base key, plus the number of clear refusals so far. */
export const attemptKey = (kind: EmailKind, userId: string, dedupeKey: string, refusals: number) =>
  `${sendIdempotencyKey(kind, userId, dedupeKey)}${refusals > 0 ? `:r${refusals}` : ""}`;

/** Why nothing may be sent right now, or null when sending can go ahead. */
function holdBack(kinds: EmailKind[]): Extract<SendOutcome, { status: "not_configured" }> | null {
  if (!sendingAllowed()) {
    console.info(`[email] ${[...new Set(kinds)].join(", ")} not sent (${kinds.length}): lifecycle email goes only from production (${whereRunning()})`);
    return { status: "not_configured", reason: "not_production" };
  }
  if (emailMode() === "off") return { status: "not_configured", reason: "no_api_key" };
  if (kinds.some((k) => KIND_CATEGORY[k]) && !emailLinksReady()) return { status: "not_configured", reason: "no_link_secret" };
  return null;
}

// ── People ──────────────────────────────────────────────────────────────────

// encode(sha256(convert_to(lower(email), 'UTF8')), 'hex'): the same hash as
// lib/email/suppress.ts and the jobs lane's selection query (architecture spec §3.3).
const sqlEmailHash = sql`encode(sha256(convert_to(lower(${schema.users.email}), 'UTF8')), 'hex')`;

async function recipients(d: Db, userIds: string[]): Promise<Map<string, Recipient>> {
  const { users, profiles, emailPrefs, emailSuppressions } = schema;
  const rows = await d
    .select({
      id: users.id,
      email: users.email,
      name: profiles.name,
      weekly: emailPrefs.weekly,
      questions: emailPrefs.questions,
      pausedAt: emailPrefs.weeklyPausedAt,
      suppressedHash: emailSuppressions.emailHash,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .leftJoin(emailPrefs, eq(emailPrefs.userId, users.id))
    .leftJoin(emailSuppressions, eq(emailSuppressions.emailHash, sqlEmailHash))
    .where(inArray(users.id, [...new Set(userIds)]));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        userId: r.id,
        email: r.email,
        firstName: r.name?.trim().split(/\s+/)[0] || null,
        prefs: { weekly: r.weekly ?? DEFAULT_EMAIL_PREFS.weekly, questions: r.questions ?? DEFAULT_EMAIL_PREFS.questions, weeklyPausedAt: r.pausedAt ?? null },
        suppressed: r.suppressedHash !== null,
      },
    ]),
  );
}

async function alreadyClaimed(d: Db, emails: LifecycleEmail[]): Promise<Set<string>> {
  const rows = await d
    .select({ userId: sends.userId, kind: sends.kind, dedupeKey: sends.dedupeKey })
    .from(sends)
    .where(
      and(
        inArray(sends.userId, [...new Set(emails.map((e) => e.userId))]),
        inArray(sends.kind, [...new Set(emails.map((e) => e.kind))]),
        inArray(sends.dedupeKey, [...new Set(emails.map((e) => e.dedupeKey))]),
      ),
    );
  return new Set(rows.map((r) => keyOf({ userId: r.userId, kind: r.kind as EmailKind, dedupeKey: r.dedupeKey })));
}

// ── Budget ──────────────────────────────────────────────────────────────────

// One lock for every lifecycle send, held for a few milliseconds while the day's count is
// read and the rows are reserved, so two runs (or a welcome and a run) can't both take the
// last place. Transaction-scoped, so it suits Supabase's transaction pooler. Sign-in codes
// never take it.
const BUDGET_LOCK = sql`select pg_advisory_xact_lock(hashtext('d-human:email-budget'))`;

export type BudgetToday = { left: number; codesToday: number; lifecycleToday: number; otherToday: number };

// Three counts over the UTC day, read again before every send: email_sends by its sent_at
// index, email_daily_counts by its key, and login_codes (no created_at index, but the jobs
// lane's housekeeping keeps it to two days of rows).
async function countToday(d: Db, now: Date): Promise<BudgetToday> {
  const from = utcDayStart(now);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const codes = schema.loginCodes;
  const [[c], [l], other] = await Promise.all([
    d.select({ n: count() }).from(codes).where(and(gte(codes.createdAt, from), lt(codes.createdAt, to))),
    d.select({ n: count() }).from(sends).where(and(gte(sends.sentAt, from), lt(sends.sentAt, to))),
    otherSentToday(d, now),
  ]);
  const left = lifecycleLeft({ codesToday: c.n, lifecycleToday: l.n, otherToday: other });
  return { left, codesToday: c.n, lifecycleToday: l.n, otherToday: other };
}

/** Today's numbers, for the jobs lane (alerts, dry runs, job_runs.last_result). */
export async function budgetToday(now = new Date()): Promise<BudgetToday> {
  return countToday(await db(), now);
}

// ── Talking to Resend ───────────────────────────────────────────────────────

function frameFor(c: Pick<Claimed, "sendId" | "email" | "recipient">, origin: string): EmailFrame {
  const category = KIND_CATEGORY[c.email.kind];
  return {
    sendId: c.sendId,
    siteUrl: origin,
    email: c.recipient.email,
    firstName: c.recipient.firstName,
    stopUrl: category ? stopPageUrl(c.recipient.userId, category, origin) : null,
    settingsUrl: `${origin}/settings#emails`,
    canReply: Boolean(replyToFor(c.email.kind)),
  };
}

/**
 * The exact payload for Resend. Deterministic (no clocks, no random values), so rebuilding
 * a send gives the same bytes and Resend's idempotency check accepts the retry.
 */
export function resendPayload(c: Pick<Claimed, "sendId" | "email" | "recipient">, rendered: RenderedEmail, origin: string): CreateEmailOptions {
  const category = KIND_CATEGORY[c.email.kind];
  return {
    from: fromAddress(),
    to: c.recipient.email,
    replyTo: replyToFor(c.email.kind),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // RFC 8058 one-click unsubscribe, for the mail app's own button; only for email people can stop.
    ...(category
      ? { headers: { "List-Unsubscribe": `<${oneClickUrl(c.recipient.userId, category, origin)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }
      : {}),
    // Ids only: Resend keeps tags with the email for 30 days.
    tags: [
      { name: "kind", value: c.email.kind },
      { name: "send_id", value: c.sendId },
    ],
  };
}

type Answer = { kind: "ok"; ids: string[] } | { kind: "refused" | "unclear" | "conflict"; error: string; retryAfterSeconds?: number };

function classify(error: ErrorResponse, headers: Record<string, string> | null): Answer {
  const status = error.statusCode;
  const text = `${error.name}${status ? ` ${status}` : ""}`.slice(0, 200);
  // The key was used for other content, or the same request is still running: it may have gone.
  if (status === 409) return { kind: "conflict", error: text };
  if (typeof status === "number" && status >= 400 && status < 500) {
    const retryAfter = Number(headers?.["retry-after"]);
    return { kind: "refused", error: text, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}) };
  }
  return { kind: "unclear", error: text };
}

async function callResend(payloads: CreateEmailOptions[], idempotencyKey: string, claimed: Claimed[]): Promise<Answer> {
  if (emailMode() === "log") {
    // Local dev without a key: say what would go (kind and send id, never an address).
    for (const c of claimed) console.info(`[email] ${c.email.kind} ${c.sendId}: logged, not sent (no RESEND_API_KEY)`);
    return { kind: "ok", ids: claimed.map((c) => `log:${c.sendId}`) };
  }
  const client = resend();
  if (!client) return { kind: "refused", error: "not_configured" };
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    if (payloads.length === 1) {
      const { data, error, headers } = await client.emails.send(payloads[0], { idempotencyKey, signal });
      return error ? classify(error, headers) : { kind: "ok", ids: [data.id] };
    }
    const { data, error, headers } = await client.batch.send(payloads, { idempotencyKey, signal });
    if (error) return classify(error, headers);
    const ids = data.data.map((x) => x.id);
    // Resend answers in the order sent; anything else is a reply we can't map safely.
    return ids.length === payloads.length ? { kind: "ok", ids } : { kind: "unclear", error: "batch_count_mismatch" };
  } catch (error) {
    return { kind: "unclear", error: (error instanceof Error ? error.name : "error").slice(0, 200) };
  }
}

// Every write here only moves a row on from "sending", so it can't undo what a webhook
// (a bounce or spam report arriving within seconds) has already recorded.
async function record(d: Db, claimed: Claimed[], answer: Answer, now: Date): Promise<SendOutcome[]> {
  const open = and(
    inArray(
      sends.id,
      claimed.map((c) => c.sendId),
    ),
    eq(sends.status, "sending"),
  );
  if (answer.kind === "ok") {
    const stillSending = sql`${sends.status} = 'sending'`;
    await Promise.all(
      claimed.map((c, i) =>
        d
          .update(sends)
          .set({
            status: sql`case when ${stillSending} then 'sent' else ${sends.status} end`,
            providerId: sql`coalesce(${sends.providerId}, ${answer.ids[i]})`,
            sentAt: sql`case when ${stillSending} then ${now.toISOString()}::timestamptz else ${sends.sentAt} end`,
            error: sql`case when ${stillSending} then null else ${sends.error} end`,
          })
          .where(eq(sends.id, c.sendId)),
      ),
    );
    return claimed.map((c, i) => ({ status: "sent", sendId: c.sendId, providerId: answer.ids[i] }));
  }
  if (answer.kind === "refused") {
    // Nothing went: hand the day's place back and count the refusal.
    await d
      .update(sends)
      .set({ status: "failed", sentAt: null, attempts: sql`${sends.attempts} + 1`, error: answer.error })
      .where(open);
    return claimed.map((c) => ({ status: "failed", sendId: c.sendId, error: answer.error, ...(answer.retryAfterSeconds ? { retryAfterSeconds: answer.retryAfterSeconds } : {}) }));
  }
  if (answer.kind === "conflict") {
    await d.update(sends).set({ status: "unknown", error: answer.error }).where(open);
    return claimed.map((c) => ({ status: "unknown", sendId: c.sendId, error: answer.error }));
  }
  // Unclear: it may have gone. Keep the day's place and the key; the sweep decides.
  await d.update(sends).set({ error: answer.error }).where(open);
  return claimed.map((c) => ({ status: "pending", sendId: c.sendId, error: answer.error }));
}

/** Renders each claimed send; one that throws is marked failed on its own and left out. */
async function renderAll(d: Db, claimed: Claimed[], origin: string) {
  const ok: { c: Claimed; payload: CreateEmailOptions }[] = [];
  const broken: Claimed[] = [];
  for (const c of claimed) {
    try {
      ok.push({ c, payload: resendPayload(c, c.email.render(frameFor(c, origin)), origin) });
    } catch (error) {
      console.error(`[email] render failed for ${c.email.kind} ${c.sendId}:`, error instanceof Error ? error.message : error);
      broken.push(c);
    }
  }
  const failed = broken.length ? await record(d, broken, { kind: "refused", error: "render" }, new Date()) : [];
  return { ok, failed: new Map(broken.map((c, i) => [c.sendId, failed[i]])) };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Sends one lifecycle email (the welcome from onboarding, or anything the daily job sends).
 * Safe to call any number of times for the same (person, kind, dedupe key): it sends once.
 */
export async function sendLifecycle(email: LifecycleEmail, opts: SendOptions = {}): Promise<SendOutcome> {
  const [outcome] = await sendMany([email], opts, false);
  return outcome;
}

/**
 * Sends a list, in priority order: when the budget runs short, the first ones go, and the
 * rest come back "budget" for the next run. Outcomes come back in the same order.
 *
 * One by one by default (at most 4 a second), each with its own key and its own budget
 * check, so an unclear answer strands one email at most. EMAIL_BATCH=1 switches to Resend
 * batch calls of up to 100 (one claim, one call, one write each): worth it on a paid plan
 * with thousands a run, but a batch with no clear answer is marked "unknown" whole and
 * never resent.
 */
export async function sendLifecycleBatch(emails: LifecycleEmail[], opts: SendOptions & { paceMs?: number } = {}): Promise<SendOutcome[]> {
  const out: SendOutcome[] = [];
  if (process.env.EMAIL_BATCH === "1") {
    for (let i = 0; i < emails.length; i += RESEND_BATCH_MAX) out.push(...(await sendMany(emails.slice(i, i + RESEND_BATCH_MAX), opts, true)));
    return out;
  }
  const pace = opts.paceMs ?? PACE_MS;
  let lastCall = 0;
  for (const email of emails) {
    // Once the budget or the setup says no, it says no to the rest of the list too.
    const stop = out.at(-1);
    if (stop?.status === "budget" || stop?.status === "not_configured") {
      out.push(stop);
      continue;
    }
    const wait = lastCall + pace - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const outcome = await sendLifecycle(email, opts);
    if ("sendId" in outcome) lastCall = Date.now(); // it reached Resend
    out.push(outcome);
  }
  return out;
}

async function sendMany(emails: LifecycleEmail[], opts: SendOptions, asBatch: boolean): Promise<SendOutcome[]> {
  if (!emails.length) return [];
  for (const e of emails) if (!LOCAL_DATE.test(e.localDate)) throw new Error(`localDate must be YYYY-MM-DD, got "${e.localDate}"`);
  const held = holdBack(emails.map((e) => e.kind));
  if (held) return emails.map(() => held);

  const now = opts.now ?? new Date();
  const origin = originOf(opts);
  const d = await db();
  const [people, taken] = await Promise.all([recipients(d, emails.map((e) => e.userId)), alreadyClaimed(d, emails)]);

  const outcomes: (SendOutcome | null)[] = emails.map(() => null);
  const candidates: { index: number; sendId: string; email: LifecycleEmail; recipient: Recipient }[] = [];
  emails.forEach((email, index) => {
    const recipient = people.get(email.userId);
    if (!recipient) outcomes[index] = { status: "skipped", reason: "no_person" };
    else if (taken.has(keyOf(email))) outcomes[index] = { status: "duplicate" };
    else if (recipient.suppressed) outcomes[index] = { status: "skipped", reason: "suppressed" };
    else if (!kindAllowed(recipient.prefs, email.kind)) outcomes[index] = { status: "skipped", reason: "turned_off" };
    else candidates.push({ index, sendId: newId(), email, recipient });
  });

  // Claim and reserve, in the order given, as far as today's budget goes.
  const batchId = asBatch && candidates.length > 1 ? newId() : null;
  const claimedIds = await d.transaction(async (tx) => {
    await tx.execute(BUDGET_LOCK);
    let left = (await countToday(tx, now)).left;
    const won = new Set<string>();
    let next = 0;
    while (next < candidates.length && left > 0) {
      const chunk = candidates.slice(next, next + left);
      next += chunk.length;
      const rows = await tx
        .insert(sends)
        .values(
          chunk.map((c) => ({
            id: c.sendId,
            userId: c.email.userId,
            kind: c.email.kind,
            dedupeKey: c.email.dedupeKey,
            variant: c.email.variant ?? null,
            localDate: c.email.localDate,
            status: "sending",
            batchId,
            sentAt: now,
          })),
        )
        .onConflictDoNothing({ target: [sends.userId, sends.kind, sends.dedupeKey] })
        .returning({ id: sends.id });
      for (const r of rows) won.add(r.id);
      left -= rows.length;
    }
    for (const c of candidates.slice(next)) outcomes[c.index] = { status: "budget" };
    return won;
  });

  const claimed: Claimed[] = [];
  for (const c of candidates) {
    if (outcomes[c.index]) continue;
    if (!claimedIds.has(c.sendId)) outcomes[c.index] = { status: "duplicate" }; // claimed by a parallel call
    else claimed.push(c);
  }

  if (claimed.length) {
    // Resend's batch keeps our order; sorting by send id makes a rebuilt batch identical.
    claimed.sort((a, b) => (a.sendId < b.sendId ? -1 : 1));
    const { ok, failed } = await renderAll(d, claimed, origin);
    for (const c of claimed) if (failed.has(c.sendId)) outcomes[c.index] = failed.get(c.sendId)!;
    if (ok.length) {
      const first = ok[0].c.email;
      const key = batchId ? batchIdempotencyKey(batchId) : attemptKey(first.kind, first.userId, first.dedupeKey, 0);
      const sent = ok.map((x) => x.c);
      const answer = await callResend(
        ok.map((x) => x.payload),
        key,
        sent,
      );
      const results = await record(d, sent, answer, now);
      sent.forEach((c, i) => (outcomes[c.index] = results[i]));
    }
  }
  return outcomes.map((o) => o ?? { status: "duplicate" });
}

/**
 * The jobs lane's retry sweep, for one ledger row:
 * - "failed" (Resend refused it) under MAX_ATTEMPTS: sent again under a new key.
 * - "sending" older than 10 minutes: sent again under the same key, so Resend sends it at
 *   most once; older than 23 hours, or part of a batch: marked "unknown", never resent.
 * Settings and suppression are checked again first. Pass the same render as the first try.
 */
export async function retrySend(sendId: string, render: LifecycleEmail["render"], opts: SendOptions = {}): Promise<SendOutcome> {
  const now = opts.now ?? new Date();
  const origin = originOf(opts);
  const d = await db();
  const [row] = await d.select().from(sends).where(eq(sends.id, sendId)).limit(1);
  if (!row) return { status: "skipped", reason: "no_person" };
  const kind = row.kind as EmailKind;
  const held = holdBack([kind]);
  if (held) return held;
  if (row.status !== "failed" && row.status !== "sending") return { status: "duplicate" };

  const markUnknown = async (error: string): Promise<SendOutcome> => {
    await d.update(sends).set({ status: "unknown", error }).where(and(eq(sends.id, sendId), eq(sends.status, "sending")));
    return { status: "unknown", sendId, error };
  };
  if (row.status === "sending") {
    const since = (row.sentAt ?? row.createdAt).getTime();
    if (now.getTime() - since < SENDING_GRACE_MS) return { status: "pending", sendId, error: "in_flight" };
    if (row.batchId) return markUnknown("batch_unclear");
    if (now.getTime() - since > SENDING_MAX_AGE_MS) return markUnknown("too_old_to_retry");
  } else if (row.attempts >= MAX_ATTEMPTS) {
    return { status: "skipped", reason: "gave_up" };
  }

  const recipient = (await recipients(d, [row.userId])).get(row.userId);
  const email: LifecycleEmail = { userId: row.userId, kind, dedupeKey: row.dedupeKey, localDate: row.localDate, variant: row.variant, render };
  if (!recipient || recipient.suppressed || !kindAllowed(recipient.prefs, kind)) {
    // Stopped or bounced since: give up on this one for good.
    await d.update(sends).set({ status: "failed", sentAt: null, attempts: MAX_ATTEMPTS, error: "stopped_before_retry" }).where(eq(sends.id, sendId));
    return { status: "skipped", reason: !recipient ? "no_person" : recipient.suppressed ? "suppressed" : "turned_off" };
  }

  const reserved = await d.transaction(async (tx) => {
    await tx.execute(BUDGET_LOCK);
    if ((await countToday(tx, now)).left < 1) return "budget" as const;
    // Takes the row only if nobody touched it since it was read (two sweeps can't both resend).
    const [won] = await tx
      .update(sends)
      .set({ status: "sending", sentAt: now })
      .where(
        and(
          eq(sends.id, sendId),
          eq(sends.status, row.status),
          eq(sends.attempts, row.attempts),
          row.sentAt ? eq(sends.sentAt, row.sentAt) : isNull(sends.sentAt),
        ),
      )
      .returning({ id: sends.id });
    return won ? ("ok" as const) : ("lost" as const);
  });
  if (reserved === "budget") return { status: "budget" };
  if (reserved === "lost") return { status: "duplicate" };

  const claimed: Claimed = { sendId, email, recipient, index: 0 };
  const { ok, failed } = await renderAll(d, [claimed], origin);
  if (!ok.length) return failed.get(sendId)!;
  const answer = await callResend([ok[0].payload], attemptKey(kind, row.userId, row.dedupeKey, row.attempts), [claimed]);
  const [outcome] = await record(d, [claimed], answer, now);
  return outcome;
}

/** Rows the sweep should look at: refused ones still under MAX_ATTEMPTS, and unanswered ones past the grace time. */
export async function sendsToRetry(now = new Date(), limit = 200): Promise<string[]> {
  const d = await db();
  const settled = new Date(now.getTime() - SENDING_GRACE_MS);
  // The status filter matches email_sends_open_idx (created_at, where status is sending or failed).
  const rows = await d
    .select({ id: sends.id })
    .from(sends)
    .where(
      and(
        inArray(sends.status, ["sending", "failed"]),
        or(
          and(eq(sends.status, "failed"), sql`${sends.attempts} < ${MAX_ATTEMPTS}`),
          and(eq(sends.status, "sending"), lte(sql`coalesce(${sends.sentAt}, ${sends.createdAt})`, settled)),
        ),
      ),
    )
    .orderBy(sends.createdAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * The first tap on any link in an email (`e` = its send id), for the weekly pause and the
 * numbers in the UX spec §8. Counts only when the send belongs to `userId`; `e` grants nothing.
 * Lane G calls it from /api/email/tap, and after sign-in for a tap that hit sign-in first.
 */
export async function recordTap(userId: string, sendId: string, now = new Date()): Promise<boolean> {
  const d = await db();
  const rows = await d
    .update(sends)
    .set({ firstTapAt: now })
    .where(and(eq(sends.id, sendId), eq(sends.userId, userId), isNull(sends.firstTapAt)))
    .returning({ id: sends.id });
  return rows.length > 0;
}

// ── The founders' alert ─────────────────────────────────────────────────────

/** ALERT_EMAILS, or BLOG_OWNER_EMAILS when unset: comma-separated. */
export function alertRecipients(): string[] {
  const raw = process.env.ALERT_EMAILS?.trim() || process.env.BLOG_OWNER_EMAILS || "";
  return [...new Set(raw.split(",").map((a) => a.trim().toLowerCase()).filter((a) => /^[^\s@]+@[^\s@]+$/.test(a)))];
}

export type AlertOutcome = { status: "sent" } | { status: "failed"; error: string } | { status: "not_configured"; reason: "not_production" | "no_api_key" | "no_recipients" };

type PlainNote = { stream: Exclude<OtherStream, "waitlist_welcome">; to: string[]; subject: string; text: string; html?: string; idempotencyKey: string };

/**
 * A short note outside the lifecycle ledger: only from production, like lifecycle email,
 * and counted in today's budget under its stream before it goes (a failed send over-counts
 * by one, the safe side). The idempotency key makes it once-only at Resend for 24 hours.
 */
async function sendPlainNote(note: PlainNote, now: Date): Promise<AlertOutcome> {
  if (!sendingAllowed()) {
    console.info(`[email] ${note.stream} not sent: goes only from production (${whereRunning()})`);
    return { status: "not_configured", reason: "not_production" };
  }
  if (!note.to.length) return { status: "not_configured", reason: "no_recipients" };
  const mode = emailMode();
  if (mode === "off") return { status: "not_configured", reason: "no_api_key" };
  await countOtherSend(note.stream, note.to.length, now).catch((error) => console.error(`[email] counting ${note.stream} failed:`, error instanceof Error ? error.message : error));
  if (mode === "log") {
    console.info(`[email] ${note.stream}: logged, not sent (no RESEND_API_KEY)`);
    return { status: "sent" };
  }
  const { error } = await resend()!.emails.send(
    { from: fromAddress(), to: note.to, subject: note.subject, text: note.text, ...(note.html ? { html: note.html } : {}), tags: [{ name: "kind", value: note.stream }] },
    { idempotencyKey: note.idempotencyKey.slice(0, 256), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  return error ? { status: "failed", error: `${error.name}${error.statusCode ? ` ${error.statusCode}` : ""}` } : { status: "sent" };
}

/**
 * A plain-text note to the founders (the jobs lane's "weekly list nearing the cap" alert).
 * `key` makes it once-only at Resend for 24 hours (e.g. "weekly-cap:2026-11-16"); the jobs
 * lane keeps its own once-a-week marker in job_runs. Counts in the text, never addresses
 * or anything about anyone's health.
 */
export async function sendFounderAlert(alert: { key: string; subject: string; text: string }, now = new Date()): Promise<AlertOutcome> {
  return sendPlainNote({ stream: "founder_alert", to: alertRecipients(), subject: alert.subject, text: alert.text, idempotencyKey: `alert:${alert.key}` }, now);
}

/**
 * /write's "Ask {name} for a read": one email to one writer with the preview link. Same
 * rules as the founders' alert (production only, counted in the day's budget); `key` is
 * the review request's id, so a repeat can't send twice.
 */
export async function sendReviewRequest(email: { key: string; to: string; subject: string; text: string; html: string }, now = new Date()): Promise<AlertOutcome> {
  return sendPlainNote({ stream: "review_request", to: [email.to], subject: email.subject, text: email.text, html: email.html, idempotencyKey: `review:${email.key}` }, now);
}
