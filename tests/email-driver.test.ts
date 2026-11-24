// The email code through production's driver: lib/db's pool, postgres.js and drizzle's
// postgres-js driver (tests/support/driver-db.ts), never PGlite's own. From 2026-11-19 to
// 2026-11-24 the daily email job failed on every live run with "The "string" argument must
// be of type string … Received an instance of Date": its retry sweep compared a bare Date
// with a sql expression, which PGlite takes and production's driver can't send. Every other
// test passed. Here the same code runs the production way:
//   npm test                               PGlite behind a Postgres wire endpoint
//   TEST_DATABASE_URL=postgres://… npm test  a fresh database on that real Postgres
// Resend and the Sheet's web app are stand-ins; nothing leaves the machine.
// Times are UTC; IST is UTC+5:30. 2026-11-22 is a Sunday; its week starts 2026-11-16.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";
import { driverDatabase } from "./support/driver-db.ts";

type Payload = { to: string | string[]; subject: string; text: string; tags: { name: string; value: string }[] };
type Call = { payload: Payload; key: string | undefined };
type AfterFn = () => unknown;
const g = globalThis as unknown as { __fake: { calls: Call[] }; __testUser?: { id: string; email: string } | null; __after?: AfterFn[] };
g.__fake = { calls: [] };

allowAppImports({
  resend: `
    const sendId = (p) => (p.tags.find((t) => t.name === "send_id") || { value: "note" }).value;
    export class Resend {
      constructor() {
        this.emails = { send: async (p, o) => {
          globalThis.__fake.calls.push({ payload: p, key: o && o.idempotencyKey });
          return { data: { id: "re_" + sendId(p) + "_" + globalThis.__fake.calls.length }, error: null, headers: {} };
        } };
        this.batch = { send: async () => { throw new Error("batch not expected"); } };
      }
    }
  `,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null; export const endSession = async () => {};",
  "next/server": "export const after = (fn) => { (globalThis.__after ??= []).push(fn); }; export const connection = async () => {};",
});
const removeDatabase = await driverDatabase();
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_LINK_SECRET = "test-email-link-secret";
process.env.EMAIL_SEND_LOCAL = "1";
process.env.ALERT_EMAILS = "founders@example.com";
for (const k of ["VERCEL_ENV", "EMAIL_BATCH", "EMAIL_DAILY_CAP", "ANTHROPIC_API_KEY", "D_HUMAN_AI_MOCK", "EMAIL_WEEKLY_LIVE", "EMAIL_LIFECYCLE_LIVE", "RAZORPAY_KEY_ID"]) delete process.env[k];

// The Sheet's web app.
const SHEET = { GOOGLE_SHEETS_WEBHOOK_URL: "https://script.example.test/macros/s/test/exec", GOOGLE_SHEETS_WEBHOOK_SECRET: "test-sheet-secret" };
let sheetCalls: { action: string; respondent?: string; rows?: unknown[] }[] = [];
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  sheetCalls.push(body);
  const reply = body.action === "feedback" ? { ok: true, status: "saved", saved: body.rows.length } : { ok: true, status: "forgotten", deleted: 1 };
  return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

const { and, eq, like, sql } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { at } = await import("../lib/db/params.ts");
const jobs = await import("../lib/email/jobs.ts");
const send = await import("../lib/email/send.ts");
const fb = await import("../lib/email/feedback.ts");
const prefs = await import("../lib/email/prefs.ts");
const suppress = await import("../lib/email/suppress.ts");
const counts = await import("../lib/email/counts.ts");
const { stopToken, feedbackToken } = await import("../lib/email/tokens.ts");
const { sendIdempotencyKey } = await import("../lib/email/types.ts");
const { planView } = await import("../lib/platform/plan.ts");
const prefsRoute = await import("../app/api/email/prefs/route.ts");
const unsubscribeRoute = await import("../app/api/email/unsubscribe/route.ts");
const feedbackRoute = await import("../app/api/feedback/route.ts");

after(removeDatabase);
beforeEach(async () => {
  g.__fake.calls = [];
  g.__after = [];
  g.__testUser = null;
  sheetCalls = [];
  for (const k of ["EMAIL_WEEKLY_LIVE", "EMAIL_LIFECYCLE_LIVE", "EMAIL_DAILY_CAP", ...Object.keys(SHEET)]) delete process.env[k];
  const d = await db();
  await d.execute(sql`truncate users, job_runs, email_suppressions, email_daily_counts, login_codes, ask_totals cascade`);
});

const H = 60 * 60 * 1000;
const SUNDAY_EVENING = new Date("2026-11-22T14:10:00Z"); // 19:40 IST
const MONDAY_MORNING = new Date("2026-11-23T05:10:00Z"); // 10:40 IST
const WEEK = ["2026-11-16", "2026-11-18", "2026-11-20"];
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);
const rows = (result: unknown) => ((result as { rows?: unknown[] }).rows ?? result) as Array<Record<string, unknown>>;
const run = (now: Date, o: { dry?: boolean } = {}) => jobs.runDaily({ now, paceMs: 0, origin: "https://www.d-human.fit", ...o });
const lifecycleCalls = () => g.__fake.calls.filter((c) => c.payload.tags.some((t) => t.name === "send_id"));
const kindOf = (c: Call) => c.payload.tags.find((t) => t.name === "kind")!.value;

let n = 0;
async function person(o: { onboardedAt?: Date | null; accountAt?: Date } = {}) {
  const d = await db();
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const email = `driver${n}@example.com`;
  await d.insert(schema.users).values({ id, email, createdAt: o.accountAt ?? new Date("2026-10-01T00:00:00Z") });
  await d.insert(schema.profiles).values({
    userId: id,
    name: "Asha Rao",
    birthYear: 1994,
    sex: "female",
    heightCm: 160,
    weightKg: 60,
    level: "regular",
    primaryActivity: "running",
    timezone: "Asia/Kolkata",
    onboardedAt: o.onboardedAt === undefined ? new Date("2026-11-01T05:00:00Z") : o.onboardedAt,
  });
  return { id, email };
}
let m = 0;
async function meals(userId: string, days: string[]) {
  const d = await db();
  for (const localDate of days)
    await d.insert(schema.foodLogs).values({
      id: `driver-meal-${++m}`,
      userId,
      localDate,
      meal: "lunch",
      source: "photo",
      title: "Dal rice",
      items: [],
      kcal: 500,
      proteinG: 20,
      carbsG: 60,
      fatG: 10,
      fibreG: 5,
      micros: {},
      createdAt: new Date(`${localDate}T07:00:00Z`),
    });
}
async function sendRow(userId: string, o: Partial<typeof schema.emailSends.$inferInsert>) {
  const d = await db();
  const id = `driver-send-${++m}`;
  await d.insert(schema.emailSends).values({ id, userId, kind: "welcome", dedupeKey: "once", localDate: "2026-11-22", ...o });
  return id;
}
const sendById = async (id: string) => (await (await db()).select().from(schema.emailSends).where(eq(schema.emailSends.id, id)))[0];

describe("production's driver", () => {
  it("refuses a Date outside a column, with the error production logged", async () => {
    const d = await db();
    const error = await d.execute(sql`select ${new Date()}::timestamptz as t`).then(
      () => null,
      (e: unknown) => e as { cause?: { code?: string; message?: string } },
    );
    // If this ever passes, drizzle's driver changed: revisit lib/db/params.ts.
    assert.equal(error?.cause?.code, "ERR_INVALID_ARG_TYPE");
    assert.match(error?.cause?.message ?? "", /Received an instance of Date/);
  });

  it("takes at(date), and Dates through columns", async () => {
    const d = await db();
    const moment = new Date("2026-11-24T08:35:26.123Z");
    assert.equal(rows(await d.execute(sql`select (${at(moment)} = '2026-11-24T08:35:26.123Z'::timestamptz) as same`))[0].same, true);
    const { id } = await person({ accountAt: moment });
    const found = await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.createdAt, moment));
    assert.deepEqual(found, [{ id }]);
  });
});

describe("each fixed query, through production's driver", () => {
  it("the retry sweep finds refused sends under 3 tries and unanswered ones past 10 minutes", async () => {
    const now = SUNDAY_EVENING;
    const a = await person();
    const refused = await sendRow(a.id, { kind: "weekly", dedupeKey: "2026-11-16", status: "failed", attempts: 1, createdAt: ago(now, 3 * H) });
    await sendRow(a.id, { kind: "feedback", dedupeKey: "fb-1", status: "failed", attempts: 3, createdAt: ago(now, 2 * H) });
    const stale = await sendRow(a.id, { kind: "welcome", status: "sending", sentAt: ago(now, 30 * 60_000), createdAt: ago(now, 30 * 60_000) });
    await sendRow(a.id, { kind: "welcome_unfinished", status: "sending", sentAt: ago(now, 2 * 60_000), createdAt: ago(now, 2 * 60_000) });
    // The old code failed right here, on every live run.
    assert.deepEqual(await send.sendsToRetry(now), [refused, stale]);
  });

  it("a sent email records when it went", async () => {
    const now = SUNDAY_EVENING;
    const a = await person({ onboardedAt: ago(now, H) });
    const outcome = await send.sendLifecycle({ userId: a.id, kind: "welcome", dedupeKey: "once", localDate: "2026-11-22", render: () => ({ subject: "Hi", preheader: "", html: "<p>Hi</p>", text: "Hi" }) }, { now });
    assert.equal(outcome.status, "sent");
    const row = await sendById((outcome as { sendId: string }).sendId);
    assert.equal(row.status, "sent");
    assert.equal(row.sentAt?.toISOString(), now.toISOString());
  });

  it("a pass counts only the reads made inside it", async () => {
    const a = await person();
    const d = await db();
    const now = new Date();
    await d.insert(schema.payments).values({ id: "driver-pay", userId: a.id, orderId: "order_driver", amount: 4900, currency: "INR", status: "paid", mode: "live", startsAt: ago(now, 24 * H), endsAt: new Date(now.getTime() + 29 * 24 * H), paidAt: ago(now, 24 * H) });
    await d.insert(schema.usage).values([
      { id: "driver-u1", userId: a.id, kind: "read", refId: "r-before", createdAt: ago(now, 3 * 24 * H) },
      { id: "driver-u2", userId: a.id, kind: "read", refId: "r-in-1", createdAt: ago(now, 2 * H) },
      { id: "driver-u3", userId: a.id, kind: "read", refId: "r-in-2", createdAt: ago(now, H) },
    ]);
    const view = await planView(a.id, "Asia/Kolkata");
    assert.deepEqual(view.reads, { used: 2, limit: 3, free: false });
  });

  it("the Sheet copy marks an answer whose time has microseconds (Postgres keeps them; a JS Date doesn't)", async () => {
    Object.assign(process.env, SHEET);
    const a = await person();
    const d = await db();
    const stamp = sql`'2026-11-21 10:00:00.123456+00'::timestamptz`;
    await d.insert(schema.feedbackAnswers).values({ id: "driver-ans", userId: a.id, survey: "fb-1", question: "feel", answer: "very", path: "used", source: "page", createdAt: stamp, updatedAt: stamp });
    const result = await fb.syncFeedback({ now: SUNDAY_EVENING });
    assert.deepEqual(result, { status: "ok", sent: 1, marked: 1 });
    const [row] = await d.select().from(schema.feedbackAnswers).where(eq(schema.feedbackAnswers.id, "driver-ans"));
    assert.ok(row.sheetSyncedAt, "marked as copied, so the next run doesn't copy it again");
    assert.equal((await fb.syncFeedback({ now: SUNDAY_EVENING })).status, "ok");
    assert.equal(sheetCalls.filter((c) => c.action === "feedback").length, 1, "copied once");
  });
});

describe("the daily run, live, through production's driver", () => {
  it("retries, welcomes, the nudge, the weekly with its overflow, feedback, housekeeping and the Sheet, once each", async () => {
    process.env.EMAIL_WEEKLY_LIVE = "1";
    process.env.EMAIL_LIFECYCLE_LIVE = "1";
    process.env.EMAIL_DAILY_CAP = "6";
    Object.assign(process.env, SHEET);
    const now = SUNDAY_EVENING;
    const d = await db();

    // Retries: refused once, unanswered for 30 minutes, unanswered for 30 hours.
    const r1 = await person({ onboardedAt: ago(now, 20 * H) });
    const refused = await sendRow(r1.id, { status: "failed", attempts: 1, error: "validation_error 422", localDate: "2026-11-21", createdAt: ago(now, 20 * H) });
    const r2 = await person({ onboardedAt: ago(now, H) });
    const unanswered = await sendRow(r2.id, { status: "sending", sentAt: ago(now, 30 * 60_000), createdAt: ago(now, 30 * 60_000) });
    const r3 = await person({ onboardedAt: ago(now, 31 * H) });
    const tooOld = await sendRow(r3.id, { status: "sending", localDate: "2026-11-21", sentAt: ago(now, 30 * H), createdAt: ago(now, 30 * H) });
    // A welcome the onboarding save missed, and someone who never finished setting up.
    const w = await person({ onboardedAt: ago(now, 2 * H) });
    const u = await person({ onboardedAt: null, accountAt: ago(now, 30 * H) });
    // Six people for the weekly email, one feedback ask due Monday (day 10).
    const weekly = [];
    for (let i = 0; i < 6; i++) {
      const k = await person();
      await meals(k.id, WEEK);
      weekly.push(k);
    }
    const f = await person({ onboardedAt: new Date("2026-11-13T05:00:00Z") });
    await meals(f.id, ["2026-11-13", "2026-11-14", "2026-11-15"]);

    // Housekeeping has never run: rows overdue since the platform started (2026-11-09).
    const codes = [];
    for (let day = 9; day <= 22; day++) {
      const date = `2026-11-${String(day).padStart(2, "0")}`;
      for (let i = 0; i < 3; i++) codes.push({ id: `code-${day}-${i}`, email: "x@example.com", codeHash: "h", expiresAt: new Date(`${date}T06:10:00Z`), createdAt: new Date(`${date}T06:00:00Z`) });
    }
    await d.insert(schema.loginCodes).values(codes);
    const k1 = weekly[0].id;
    await d.insert(schema.sessions).values([
      { id: "s-long-gone", userId: k1, expiresAt: new Date("2026-11-10T00:00:00Z") },
      { id: "s-recent", userId: k1, expiresAt: new Date("2026-11-18T00:00:00Z") },
      { id: "s-live", userId: k1, expiresAt: new Date("2026-12-22T00:00:00Z") },
    ]);
    for (const day of ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]) {
      await d.insert(schema.askTurns).values({ id: `turn-${day}`, userId: k1, clientKey: `key-${day}`, day, status: "answered", question: "How much protein?", answer: "About 100 g." });
      await d.insert(schema.askDays).values({ userId: k1, day, used: 1, attempts: 1 });
    }
    await d.insert(schema.askTotals).values({ day: "2026-11-19", attempts: 1 });
    await d.insert(schema.jobRuns).values([
      { job: "dry:welcome:old:once", lastStartedAt: new Date("2026-11-01T05:00:00Z") },
      { job: "dry:welcome:recent:once", lastStartedAt: new Date("2026-11-19T05:00:00Z") },
      { job: "sheet-forget:r_0123456789ab", lastStartedAt: new Date("2026-11-20T00:00:00Z") },
    ]);
    const stamp = sql`'2026-11-21 10:00:00.123456+00'::timestamptz`;
    await d.insert(schema.feedbackAnswers).values({ id: "run-ans", userId: weekly[1].id, survey: "fb-1", question: "feel", answer: "very", path: "used", source: "page", createdAt: stamp, updatedAt: stamp });

    // ── Sunday evening ──
    const sunday = await run(now);
    assert.equal(sunday.status, "ok", sunday.error);
    assert.deepEqual(sunday.live, { weekly: true, lifecycle: true });
    assert.deepEqual(
      { tried: sunday.retries.tried, sent: sunday.retries.sent, unknown: sunday.retries.unknown, failed: sunday.retries.failed },
      { tried: 3, sent: 2, unknown: 1, failed: 0 },
    );
    assert.equal(sunday.welcome.sent, 1);
    assert.equal(sunday.welcome_unfinished.sent, 1);
    assert.deepEqual([sunday.weekly.due, sunday.weekly.sent, sunday.weekly.overBudget, sunday.weekly.alert], [6, 2, 4, "sent"]);
    assert.equal(sunday.feedback.due, 0, "never on a Sunday");
    assert.deepEqual(sunday.housekeeping, { loginCodes: 36, sessions: 1, dryRows: 1, askTurns: 3, askDays: 3 });
    assert.deepEqual(sunday.sheet, { forgotten: 1, forgetsPending: 0, sync: { status: "ok", sent: 1, marked: 1 } });

    // The retries went under the right keys: a refused one under a new key, an unanswered one under its own.
    const keyFor = (to: string) => g.__fake.calls.find((c) => c.payload.to === to)?.key;
    assert.equal(keyFor(r1.email), `${sendIdempotencyKey("welcome", r1.id, "once")}:r1`);
    assert.equal(keyFor(r2.email), sendIdempotencyKey("welcome", r2.id, "once"));
    assert.equal(keyFor(r3.email), undefined, "too old to retry safely: never resent");
    assert.deepEqual([(await sendById(refused)).status, (await sendById(unanswered)).status], ["sent", "sent"]);
    assert.deepEqual([(await sendById(tooOld)).status, (await sendById(tooOld)).error], ["unknown", "too_old_to_retry"]);
    assert.ok(keyFor(w.email) && keyFor(u.email));

    // Everything overdue went, whatever its day; today's and the recent stayed.
    const left = async (t: typeof schema.loginCodes | typeof schema.sessions | typeof schema.askTurns | typeof schema.askDays | typeof schema.askTotals) => (await d.select().from(t)).length;
    assert.equal(await left(schema.loginCodes), 6);
    assert.deepEqual((await d.select({ id: schema.sessions.id }).from(schema.sessions)).map((s) => s.id).sort(), ["s-live", "s-recent"]);
    assert.deepEqual((await d.select({ day: schema.askTurns.day }).from(schema.askTurns)).map((t) => t.day), ["2026-11-22"]);
    assert.deepEqual([await left(schema.askDays), await left(schema.askTotals)], [1, 1]);
    assert.deepEqual((await d.select({ job: schema.jobRuns.job }).from(schema.jobRuns).where(like(schema.jobRuns.job, "dry:%"))).map((j) => j.job), ["dry:welcome:recent:once"]);
    const [answer] = await d.select().from(schema.feedbackAnswers).where(eq(schema.feedbackAnswers.id, "run-ans"));
    assert.ok(answer.sheetSyncedAt);

    // ── A second Sunday run: nothing twice, the overflow still waits ──
    const before = g.__fake.calls.length;
    const again = await run(new Date(now.getTime() + 5 * 60_000));
    assert.equal(again.status, "ok", again.error);
    assert.equal(g.__fake.calls.length, before, "nothing sent again");
    assert.deepEqual([again.retries.tried, again.weekly.due, again.weekly.overBudget], [0, 4, 4]);
    assert.deepEqual(again.housekeeping, { loginCodes: 0, sessions: 0, dryRows: 0, askTurns: 0, askDays: 0 });

    // ── Monday morning: the overflow and the feedback ask go ──
    const monday = await run(MONDAY_MORNING);
    assert.equal(monday.status, "ok", monday.error);
    assert.deepEqual([monday.weekly.sent, monday.weekly.overBudget, monday.feedback.sent], [4, 0, 1]);

    // Each person got each email once, across all three runs.
    const seen = lifecycleCalls().map((c) => `${c.payload.to}|${kindOf(c)}`);
    assert.equal(new Set(seen).size, seen.length);
    assert.deepEqual(weekly.map((k) => seen.filter((s) => s === `${k.email}|weekly`).length), [1, 1, 1, 1, 1, 1]);
    assert.equal(seen.filter((s) => s === `${f.email}|feedback`).length, 1);
    assert.equal(g.__fake.calls.filter((c) => kindOf(c) === "founder_alert").length, 1);

    // The lease is free, and the run is on record as ok.
    const [job] = await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, "daily"));
    assert.equal(job.leaseUntil, null);
    assert.equal(job.lastOkAt?.toISOString(), MONDAY_MORNING.toISOString());
    assert.equal((job.lastResult as { status: string }).status, "ok");
  });

  it("a ?dry=1 run reads only: no sends, no rows, no lease, no housekeeping, no Sheet", async () => {
    process.env.EMAIL_WEEKLY_LIVE = "1";
    process.env.EMAIL_LIFECYCLE_LIVE = "1";
    Object.assign(process.env, SHEET);
    const d = await db();
    const a = await person();
    await meals(a.id, WEEK);
    const refused = await sendRow(a.id, { status: "failed", attempts: 1, createdAt: ago(SUNDAY_EVENING, H) });
    await d.insert(schema.loginCodes).values({ id: "old-code", email: "x@example.com", codeHash: "h", expiresAt: new Date("2026-11-01T00:10:00Z"), createdAt: new Date("2026-11-01T00:00:00Z") });
    const snapshot = async () => ({
      sends: await d.select().from(schema.emailSends),
      jobs: await d.select().from(schema.jobRuns),
      codes: (await d.select().from(schema.loginCodes)).length,
    });
    const before = await snapshot();
    const r = await run(SUNDAY_EVENING, { dry: true });
    assert.equal(r.status, "ok", r.error);
    assert.deepEqual([r.dry, r.live.weekly, r.live.lifecycle, r.housekeeping, r.sheet], [true, false, false, null, null]);
    assert.equal(r.weekly.wouldSend, 1);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await sendById(refused)).status, "failed");
    assert.equal(g.__fake.calls.length, 0);
    assert.equal(sheetCalls.length, 0);
  });
});

describe("the other email paths, through production's driver", () => {
  it("Resend's webhook: a hard bounce, a spam report, and an address taken off the list", async () => {
    const a = await person();
    const outcome = await send.sendLifecycle({ userId: a.id, kind: "welcome", dedupeKey: "once", localDate: "2026-11-22", render: () => ({ subject: "Hi", preheader: "", html: "<p>Hi</p>", text: "Hi" }) }, { now: SUNDAY_EVENING });
    const sent = await sendById((outcome as { sendId: string }).sendId);
    const bounced = { type: "email.bounced", created_at: "2026-11-22T14:11:00Z", data: { email_id: sent.providerId, to: [a.email], tags: { send_id: sent.id }, bounce: { type: "Permanent" } } };
    assert.equal(await suppress.handleResendEvent(bounced as never), "bounced");
    assert.equal((await sendById(sent.id)).status, "bounced");
    assert.equal(await suppress.isSuppressed(a.email), true);

    const b = await person();
    const complained = { type: "email.complained", created_at: "2026-11-22T14:12:00Z", data: { email_id: "re_unknown", to: [b.email], tags: {} } };
    assert.equal(await suppress.handleResendEvent(complained as never), "complained");
    assert.deepEqual(await prefs.getPrefs(b.id), { weekly: false, questions: false, weeklyPausedAt: null });

    const removed = { type: "suppression.removed", created_at: "2026-11-22T14:13:00Z", data: { email: a.email } };
    assert.equal(await suppress.handleResendEvent(removed as never), "suppression_removed");
    assert.equal(await suppress.isSuppressed(a.email), false);
  });

  it("the stop page, one-click unsubscribe, Settings → Emails, and the weekly pause", async () => {
    const a = await person();
    const t = stopToken(a.id, "weekly");
    assert.equal((await prefs.stopLinkState(t)).status, "ok");
    const form = new FormData();
    form.append("t", t);
    form.append("weekly", "off");
    const res = await prefsRoute.POST(new Request("https://www.d-human.fit/api/email/prefs", { method: "POST", body: form }));
    assert.equal(res.status, 303);
    assert.equal((await prefs.getPrefs(a.id)).weekly, false);

    const q = stopToken(a.id, "questions");
    const one = await unsubscribeRoute.POST(new Request(`https://www.d-human.fit/api/email/unsubscribe?t=${q}`, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    assert.equal(one.status, 200);
    assert.equal((await prefs.getPrefs(a.id)).questions, false);

    assert.deepEqual(await prefs.setPrefs(a.id, { weekly: true, questions: true }, "settings", SUNDAY_EVENING), { weekly: true, questions: true, weeklyPausedAt: null });
    await prefs.pauseWeekly(a.id, SUNDAY_EVENING);
    await prefs.pauseWeekly(a.id, MONDAY_MORNING);
    assert.equal((await prefs.getPrefs(a.id)).weeklyPausedAt?.toISOString(), SUNDAY_EVENING.toISOString(), "keeps the first pause");
  });

  it("a feedback answer from the email: saved once, its tap recorded, copied to the Sheet", async () => {
    Object.assign(process.env, SHEET);
    const a = await person();
    const sendId = await sendRow(a.id, { kind: "feedback", dedupeKey: "fb-1", status: "sent", sentAt: SUNDAY_EVENING });
    const body = { t: feedbackToken(a.id, "fb-1"), question: "feel", answer: "very", source: "email_tap", e: sendId };
    const post = () => feedbackRoute.POST(new Request("https://www.d-human.fit/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const first = await post();
    assert.equal(first.status, 200);
    assert.equal(((await first.json()) as { status: string }).status, "saved");
    assert.equal(((await (await post()).json()) as { status: string }).status, "unchanged");
    assert.ok((await sendById(sendId)).firstTapAt, "the tap counts");
    for (const fn of g.__after ?? []) await fn();
    assert.equal(sheetCalls.filter((c) => c.action === "feedback").length, 1);
    const [row] = await (await db()).select().from(schema.feedbackAnswers).where(and(eq(schema.feedbackAnswers.userId, a.id), eq(schema.feedbackAnswers.question, "feel")));
    assert.ok(row.sheetSyncedAt);
  });

  it("the day's budget, the founders' note, a review request and the welcome's dry ledger", async () => {
    const a = await person();
    await counts.countOtherSend("waitlist_welcome", 2, SUNDAY_EVENING);
    assert.equal(await counts.otherSentToday(await db(), SUNDAY_EVENING), 2);
    assert.deepEqual(await send.sendFounderAlert({ key: "driver-test", subject: "Test", text: "Counts only." }, SUNDAY_EVENING), { status: "sent" });
    assert.deepEqual(await send.sendReviewRequest({ key: "driver-review", to: "writer@example.com", subject: "Read", text: "Link", html: "<p>Link</p>" }, SUNDAY_EVENING), { status: "sent" });
    const budget = await send.budgetToday(SUNDAY_EVENING);
    assert.deepEqual([budget.otherToday, budget.lifecycleToday], [4, 0]);

    const [profile] = await (await db()).select().from(schema.profiles).where(eq(schema.profiles.userId, a.id));
    assert.equal(await jobs.sendWelcome(profile, SUNDAY_EVENING), "dry");
    const dry = await (await db()).select().from(schema.jobRuns).where(like(schema.jobRuns.job, `dry:welcome:${a.id}:%`));
    assert.equal(dry.length, 1);
    assert.equal(await send.recordTap(a.id, "no-such-send", SUNDAY_EVENING), false);
  });
});
