// The daily email job (lib/email/jobs.ts) against a real embedded database, with Resend
// replaced by a fake: who gets the weekly email, the send window, the caps, re-runs that
// send nothing twice, dry runs that send nothing, the lease, the founders' alert, the
// welcome from onboarding, and the cron route's secret. No real email, no AI calls.
// Times are UTC; IST is UTC+5:30. 2026-11-22 is a Sunday; its week starts 2026-11-16.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Payload = { to: string | string[]; subject: string; html?: string; text: string; headers?: Record<string, string>; tags: { name: string; value: string }[] };
type Reply = { data: unknown; error: { statusCode: number | null; name: string; message: string } | null; headers: Record<string, string> | null };
const g = globalThis as unknown as { __fake: { calls: Payload[]; replies: Reply[] } };
g.__fake = { calls: [], replies: [] };

allowAppImports({
  resend: `
    const sendId = (p) => (p.tags.find((t) => t.name === "send_id") || { value: "alert" }).value;
    export class Resend {
      constructor() {
        this.emails = { send: async (p) => {
          globalThis.__fake.calls.push(p);
          return globalThis.__fake.replies.shift() ?? { data: { id: "re_" + sendId(p) + "_" + globalThis.__fake.calls.length }, error: null, headers: {} };
        } };
        this.batch = { send: async () => { throw new Error("batch not expected"); } };
      }
    }
  `,
});
const removeDatabase = tempDatabase();
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_LINK_SECRET = "test-email-link-secret";
process.env.EMAIL_SEND_LOCAL = "1";
process.env.ALERT_EMAILS = "founders@example.com";
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.EMAIL_BATCH;
delete process.env.EMAIL_DAILY_CAP;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.D_HUMAN_AI_MOCK;
delete process.env.EMAIL_WEEKLY_LIVE;
delete process.env.EMAIL_LIFECYCLE_LIVE;

const { and, eq, like, sql } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const jobs = await import("../lib/email/jobs.ts");
const fb = await import("../lib/email/feedback.ts");
const { setPrefs } = await import("../lib/email/prefs.ts");
const { suppress } = await import("../lib/email/suppress.ts");
const { GET } = await import("../app/api/cron/daily/route.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});
beforeEach(async () => {
  g.__fake.calls = [];
  g.__fake.replies = [];
  delete process.env.EMAIL_WEEKLY_LIVE;
  delete process.env.EMAIL_LIFECYCLE_LIVE;
  delete process.env.EMAIL_DAILY_CAP;
  delete process.env.D_HUMAN_AI_MOCK;
  const d = await db();
  await d.execute(sql`truncate users, job_runs, email_suppressions, email_daily_counts cascade`);
});

const SUNDAY_EVENING = new Date("2026-11-22T14:10:00Z"); // 19:40 IST
const MONDAY_MORNING = new Date("2026-11-23T05:10:00Z"); // 10:40 IST
const MONDAY_NIGHT = new Date("2026-11-23T17:00:00Z"); // 22:30 IST
const run = (now: Date, o: { dry?: boolean } = {}) => jobs.runDaily({ now, paceMs: 0, origin: "https://www.d-human.fit", ...o });

let n = 0;
async function person(o: { name?: string | null; onboardedAt?: Date | null; weightKg?: number | null; timezone?: string; accountAt?: Date } = {}) {
  const d = await db();
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const email = `person${n}@example.com`;
  await d.insert(schema.users).values({ id, email, createdAt: o.accountAt ?? new Date("2026-10-01T00:00:00Z") });
  await d.insert(schema.profiles).values({
    userId: id,
    name: o.name === undefined ? "Asha Rao" : o.name,
    birthYear: 1994,
    sex: "female",
    heightCm: 160,
    weightKg: o.weightKg === undefined ? 60 : o.weightKg,
    level: "regular",
    primaryActivity: "running",
    timezone: o.timezone ?? "Asia/Kolkata",
    onboardedAt: o.onboardedAt === undefined ? new Date("2026-11-01T05:00:00Z") : o.onboardedAt,
  });
  return { id, email };
}

let m = 0;
async function meals(userId: string, days: string[], o: { title?: string; meal?: string; proteinG?: number } = {}) {
  const d = await db();
  for (const localDate of days)
    await d.insert(schema.foodLogs).values({
      id: `meal-${++m}`,
      userId,
      localDate,
      meal: o.meal ?? "lunch",
      source: "photo",
      title: o.title ?? "Dal rice",
      items: [],
      kcal: 500,
      proteinG: o.proteinG ?? 20,
      carbsG: 60,
      fatG: 10,
      fibreG: 5,
      micros: {},
      createdAt: new Date(`${localDate}T07:00:00Z`),
    });
}

const WEEK = ["2026-11-16", "2026-11-18", "2026-11-20"];
async function sendsOf(userId: string) {
  const d = await db();
  return d.select().from(schema.emailSends).where(eq(schema.emailSends.userId, userId));
}
const isAlert = (c: Payload) => c.tags.some((t) => t.value === "founder_alert");
const toWhom = () => g.__fake.calls.filter((c) => !isAlert(c)).map((c) => c.to);
async function sentBefore(userId: string, kind: "welcome" | "weekly" | "feedback", localDate: string, dedupeKey = kind === "weekly" ? localDate : kind === "feedback" ? "fb-1" : "once", extra: object = {}) {
  const d = await db();
  await d.insert(schema.emailSends).values({ id: `prior-${++m}`, userId, kind, dedupeKey, localDate, status: "sent", sentAt: new Date(`${localDate}T05:00:00Z`), ...extra });
}

describe("dry runs (the default)", () => {
  it("with EMAIL_WEEKLY_LIVE unset, the Sunday run records who would get it and sends nothing", async () => {
    const a = await person();
    await meals(a.id, WEEK);
    const r = await run(SUNDAY_EVENING);
    assert.equal(r.status, "ok");
    assert.deepEqual(r.live, { weekly: false, lifecycle: false });
    assert.equal(r.weekly.wouldSend, 1);
    assert.equal(r.weekly.sent, 0);
    assert.equal(g.__fake.calls.length, 0, "nothing reached Resend");
    assert.equal((await sendsOf(a.id)).length, 0, "nothing in the send ledger");
    assert.equal(r.weekly.wraps.made, 0, "no wraps made, so no AI spend");
    const d = await db();
    const dry = await d.select().from(schema.jobRuns).where(like(schema.jobRuns.job, "dry:%"));
    assert.deepEqual(dry.map((x) => x.job), [`dry:weekly:${a.id}:2026-11-16`]);
  });

  it("a later run in the same week doesn't count the same person again", async () => {
    const a = await person();
    await meals(a.id, WEEK);
    await run(SUNDAY_EVENING);
    const monday = await run(MONDAY_MORNING);
    assert.equal(monday.weekly.wouldSend, 0);
    assert.equal(g.__fake.calls.length, 0);
  });

  it("?dry=1 writes nothing at all, even with the weekly email live", async () => {
    process.env.EMAIL_WEEKLY_LIVE = "1";
    const a = await person();
    await meals(a.id, WEEK);
    const r = await run(SUNDAY_EVENING, { dry: true });
    assert.equal(r.weekly.wouldSend, 1);
    assert.equal(g.__fake.calls.length, 0);
    const d = await db();
    assert.equal((await d.select().from(schema.jobRuns)).length, 0, "no lease, no dry rows");
    assert.equal((await sendsOf(a.id)).length, 0);
  });

  it("the welcome from onboarding is only noted while EMAIL_LIFECYCLE_LIVE is off", async () => {
    const a = await person({ onboardedAt: new Date("2026-11-22T13:00:00Z") });
    const d = await db();
    const [profile] = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, a.id));
    assert.equal(await jobs.sendWelcome(profile, SUNDAY_EVENING), "dry");
    assert.equal(g.__fake.calls.length, 0);
    // And the job's catch-up treats it as handled.
    const r = await run(SUNDAY_EVENING);
    assert.equal(r.welcome.wouldSend, 0);
  });
});

describe("the weekly email, live", () => {
  beforeEach(() => {
    process.env.EMAIL_WEEKLY_LIVE = "1";
  });

  it("goes to people who logged a meal this week, and to no one else", async () => {
    const active = await person();
    await meals(active.id, WEEK);
    const quiet = await person(); // nothing this week
    await meals(quiet.id, ["2026-11-10"]);
    const off = await person();
    await meals(off.id, WEEK);
    await setPrefs(off.id, { weekly: false }, "settings");
    const bounced = await person();
    await meals(bounced.id, WEEK);
    await suppress(bounced.email.toUpperCase(), "bounce");
    const notOnboarded = await person({ onboardedAt: null });
    await meals(notOnboarded.id, WEEK);
    const newYork = await person({ timezone: "America/New_York" }); // 09:40 on Sunday there
    await meals(newYork.id, WEEK);
    const justWelcomed = await person();
    await meals(justWelcomed.id, WEEK);
    await sentBefore(justWelcomed.id, "welcome", "2026-11-20");

    const r = await run(SUNDAY_EVENING);
    assert.deepEqual(toWhom(), [active.email]);
    assert.equal(r.weekly.sent, 1);
    assert.equal(r.weekly.versions.full, 1);
    assert.equal(r.weekly.capped, 1, "the welcome's 3 quiet days");
    const [mail] = g.__fake.calls;
    assert.equal(mail.subject, "Your week so far");
    const [row] = await sendsOf(active.id);
    assert.ok(mail.text.includes(`https://www.d-human.fit/wraps?week=2026-11-16&e=${row.id}`), "the wrap link carries the week and the send id");
    assert.match(mail.headers?.["List-Unsubscribe"] ?? "", /\/api\/email\/unsubscribe\?t=/);
    assert.deepEqual([row.kind, row.dedupeKey, row.localDate, row.variant, row.status], ["weekly", "2026-11-16", "2026-11-22", "full", "sent"]);
  });

  it("includes a week with only a report read, in the report version", async () => {
    const a = await person();
    const d = await db();
    await d.insert(schema.reports).values({ id: "rep-1", userId: a.id, status: "ready", collectedOn: "2026-11-19" });
    const r = await run(SUNDAY_EVENING);
    assert.equal(r.weekly.versions.report, 1);
    assert.match(g.__fake.calls[0].text, /1 report/);
  });

  it("runs again without sending twice", async () => {
    const a = await person();
    await meals(a.id, WEEK);
    await run(SUNDAY_EVENING);
    const again = await run(new Date("2026-11-22T14:40:00Z"));
    const monday = await run(MONDAY_MORNING);
    assert.equal(g.__fake.calls.length, 1);
    assert.equal(again.weekly.sent + monday.weekly.sent, 0);
    assert.equal((await sendsOf(a.id)).length, 1);
  });

  it("stays inside the send window: nothing at 22:30 on Monday, nothing on a Saturday", async () => {
    const a = await person();
    await meals(a.id, WEEK);
    await run(MONDAY_NIGHT);
    await run(new Date("2026-11-21T14:10:00Z"));
    assert.equal(g.__fake.calls.length, 0);
  });

  it("keeps to one lifecycle email a day: Monday's overflow skips someone who had feedback that day", async () => {
    const a = await person();
    await meals(a.id, WEEK);
    await sentBefore(a.id, "feedback", "2026-11-23");
    const r = await run(MONDAY_MORNING);
    assert.equal(g.__fake.calls.length, 0);
    assert.equal(r.weekly.capped, 1);
  });

  it("over today's budget, the rest wait for Monday's run", async () => {
    process.env.EMAIL_DAILY_CAP = "1";
    const a = await person();
    const b = await person();
    await meals(a.id, WEEK);
    await meals(b.id, WEEK);
    const sunday = await run(SUNDAY_EVENING);
    assert.equal(sunday.weekly.sent, 1);
    assert.equal(sunday.weekly.overBudget, 1);
    const monday = await run(MONDAY_MORNING); // a new UTC day, a new budget
    assert.equal(monday.weekly.sent, 1);
    assert.deepEqual(toWhom().sort(), [a.email, b.email].sort());
  });

  it("pauses the weekly email after 6 untapped ones in a row, and sends nothing", async () => {
    const a = await person();
    await meals(a.id, WEEK);
    for (const w of ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]) await sentBefore(a.id, "weekly", addDays(w, 6), w);
    const r = await run(SUNDAY_EVENING);
    assert.equal(r.weekly.paused, 1);
    assert.equal(g.__fake.calls.length, 0);
    const d = await db();
    const [prefs] = await d.select().from(schema.emailPrefs).where(eq(schema.emailPrefs.userId, a.id));
    assert.ok(prefs.weeklyPausedAt);
  });

  it("tells the founders once a week when the list reaches 80% of the cap", async () => {
    process.env.EMAIL_DAILY_CAP = "2"; // alert from 2 people
    for (let i = 0; i < 3; i++) await meals((await person()).id, WEEK);
    const r = await run(SUNDAY_EVENING);
    assert.equal(r.weekly.alert, "sent");
    const alerts = g.__fake.calls.filter((c) => c.tags.some((t) => t.value === "founder_alert"));
    assert.equal(alerts.length, 1);
    assert.deepEqual(alerts[0].to, ["founders@example.com"]);
    assert.match(alerts[0].text, /due to 3 people/);
    assert.match(alerts[0].text, /The other 1 go on Monday's run/);
    assert.doesNotMatch(alerts[0].text, /@/, "counts only, no addresses");
    const monday = await run(MONDAY_MORNING);
    assert.notEqual(monday.weekly.alert, "sent");
    assert.equal(g.__fake.calls.filter((c) => c.tags.some((t) => t.value === "founder_alert")).length, 1);
  });

  it("pre-makes each recipient's wrap (demo AI), and doesn't pay twice for a fresh one", async () => {
    process.env.D_HUMAN_AI_MOCK = "1";
    const a = await person();
    await meals(a.id, WEEK);
    const r = await run(SUNDAY_EVENING);
    assert.equal(r.weekly.wraps.made, 1);
    const d = await db();
    const [wrap] = await d.select().from(schema.wraps).where(eq(schema.wraps.userId, a.id));
    assert.deepEqual([wrap.period, wrap.startsOn, wrap.endsOn], ["week", "2026-11-16", "2026-11-22"]);
  });

  it("sends nothing outside production even when switched on, and claims nothing", async () => {
    delete process.env.EMAIL_SEND_LOCAL;
    try {
      process.env.D_HUMAN_AI_MOCK = "1";
      const a = await person();
      await meals(a.id, WEEK);
      const r = await run(SUNDAY_EVENING);
      assert.equal(r.stoppedEarly, "not_production");
      assert.equal(r.weekly.sent, 0);
      assert.equal(r.weekly.wraps.made, 0, "no wraps made for emails that can't go");
      assert.equal(g.__fake.calls.length, 0);
      assert.equal((await sendsOf(a.id)).length, 0);
    } finally {
      process.env.EMAIL_SEND_LOCAL = "1";
    }
  });

  it("retries a refused send on the next run while the week is still due", async () => {
    const a = await person();
    await meals(a.id, WEEK);
    g.__fake.replies.push({ data: null, error: { statusCode: 422, name: "validation_error", message: "x" }, headers: {} });
    const sunday = await run(SUNDAY_EVENING);
    assert.equal(sunday.weekly.failed, 1);
    const monday = await run(MONDAY_MORNING);
    assert.equal(monday.retries.sent, 1);
    const [row] = await sendsOf(a.id);
    assert.equal(row.status, "sent");
    assert.equal(g.__fake.calls.length, 2);
  });

  it("gives up on a refused weekly once its week has passed", async () => {
    const a = await person();
    await meals(a.id, WEEK);
    g.__fake.replies.push({ data: null, error: { statusCode: 422, name: "validation_error", message: "x" }, headers: {} });
    await run(SUNDAY_EVENING);
    const tuesday = await run(new Date("2026-11-24T05:10:00Z"));
    assert.equal(tuesday.retries.expired, 1);
    assert.equal(g.__fake.calls.length, 1);
  });
});

describe("welcome, didn't finish, and feedback, live", () => {
  beforeEach(() => {
    process.env.EMAIL_LIFECYCLE_LIVE = "1";
  });

  it("sends the welcome once from onboarding; the job's catch-up doesn't send another", async () => {
    const a = await person({ onboardedAt: new Date("2026-11-22T13:00:00Z") });
    const d = await db();
    const [profile] = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, a.id));
    assert.equal(await jobs.sendWelcome(profile, SUNDAY_EVENING), "sent");
    assert.equal(await jobs.sendWelcome(profile, SUNDAY_EVENING), "duplicate");
    await run(SUNDAY_EVENING);
    assert.equal(g.__fake.calls.length, 1);
    assert.match(g.__fake.calls[0].subject, /You're in, Asha/);
  });

  it("catches up a welcome that didn't go, within 48 hours only", async () => {
    const recent = await person({ onboardedAt: new Date("2026-11-21T10:00:00Z") });
    await person({ onboardedAt: new Date("2026-11-19T10:00:00Z") }); // older: no backfill
    const r = await run(SUNDAY_EVENING);
    assert.equal(r.welcome.sent, 1);
    assert.deepEqual(toWhom(), [recent.email]);
  });

  it("nudges someone who signed in a day ago and didn't finish, once", async () => {
    const stuck = await person({ onboardedAt: null, accountAt: new Date("2026-11-21T04:00:00Z") });
    await person({ onboardedAt: null, accountAt: new Date("2026-11-22T00:00:00Z") }); // 5 hours old
    await person({ onboardedAt: null, accountAt: new Date("2026-11-10T00:00:00Z") }); // 12 days old
    const morning = new Date("2026-11-22T05:10:00Z");
    const r = await run(morning);
    assert.equal(r.welcome_unfinished.sent, 1);
    assert.deepEqual(toWhom(), [stuck.email]);
    await run(new Date("2026-11-22T14:10:00Z"));
    assert.equal(g.__fake.calls.length, 1);
  });

  it("never nudges the blog's writers, who sign in only to write", async () => {
    const writer = await person({ onboardedAt: null, accountAt: new Date("2026-11-21T04:00:00Z") });
    process.env.BLOG_OWNER_EMAILS = ` ${writer.email.toUpperCase()} , someone@example.com`;
    try {
      const r = await run(new Date("2026-11-22T05:10:00Z"));
      assert.equal(r.welcome_unfinished.due, 0);
      assert.deepEqual(toWhom(), []);
    } finally {
      delete process.env.BLOG_OWNER_EMAILS;
    }
  });

  it("asks for feedback on day 10, never on a Sunday, on the right path", async () => {
    const used = await person({ onboardedAt: new Date("2026-11-13T05:00:00Z") });
    await meals(used.id, ["2026-11-13", "2026-11-15", "2026-11-17"]);
    const barely = await person({ onboardedAt: new Date("2026-11-13T05:00:00Z") });
    const sunday = await run(new Date("2026-11-22T05:10:00Z")); // day 9
    assert.equal(sunday.feedback.due, 0);
    const monday = await run(MONDAY_MORNING); // day 10
    assert.equal(monday.feedback.sent, 2);
    assert.deepEqual([monday.feedback.used, monday.feedback.barely], [1, 1]);
    const usedMail = g.__fake.calls.find((c) => c.to === used.email)!;
    const barelyMail = g.__fake.calls.find((c) => c.to === barely.email)!;
    assert.match(usedMail.text, /feedback\?t=[^&]+&q=feel&a=very/);
    assert.match(barelyMail.text, /q=gotinway/);
    const rows = await sendsOf(used.id);
    assert.deepEqual([rows[0].dedupeKey, rows[0].variant], ["fb-1", "used"]);
  });

  it("the answer buttons open /feedback with that answer chosen, carry the tap id, and opening saves nothing", async () => {
    const used = await person({ onboardedAt: new Date("2026-11-13T05:00:00Z") });
    await meals(used.id, ["2026-11-13", "2026-11-15", "2026-11-17"]);
    await run(MONDAY_MORNING);
    const mail = g.__fake.calls.find((c) => c.to === used.email)!;
    const links = [...mail.text.matchAll(/https:\/\/www\.d-human\.fit\/feedback\?\S+/g)].map((x) => new URL(x[0]));
    assert.deepEqual(
      links.map((u) => u.searchParams.get("a")),
      ["very", "somewhat", "not", "not_used"],
    );
    const [send] = await sendsOf(used.id);
    for (const url of links) {
      assert.equal(url.searchParams.get("q"), "feel");
      assert.equal(url.searchParams.get("e"), send.id, "the tap is recorded against this send");
      const state = await fb.feedbackPageState(url.searchParams.get("t"), { q: url.searchParams.get("q")!, a: url.searchParams.get("a")! }, MONDAY_MORNING.getTime());
      assert.equal(state.status, "ok");
      if (state.status === "ok") assert.deepEqual([state.path, state.start, state.pending], ["used", "feel", url.searchParams.get("a")]);
    }
    const d = await db();
    assert.equal((await d.select().from(schema.feedbackAnswers).where(eq(schema.feedbackAnswers.userId, used.id))).length, 0, "nothing saved by opening");
  });

  it("with questions turned off, no feedback email", async () => {
    const a = await person({ onboardedAt: new Date("2026-11-13T05:00:00Z") });
    await setPrefs(a.id, { questions: false }, "settings");
    const r = await run(MONDAY_MORNING);
    assert.equal(r.feedback.due, 0);
    assert.equal(g.__fake.calls.length, 0);
  });
});

describe("the lease", () => {
  it("two runs at once: one works, the other answers busy", async () => {
    process.env.EMAIL_WEEKLY_LIVE = "1";
    const a = await person();
    await meals(a.id, WEEK);
    const [first, second] = await Promise.all([run(SUNDAY_EVENING), run(SUNDAY_EVENING)]);
    assert.deepEqual([first.status, second.status].sort(), ["busy", "ok"]);
    assert.equal(g.__fake.calls.length, 1);
  });

  it("a lease left by a run that died is taken once it runs out, and released after", async () => {
    const d = await db();
    await d.insert(schema.jobRuns).values({ job: "daily", leaseUntil: new Date(SUNDAY_EVENING.getTime() + 60_000) });
    assert.equal((await run(SUNDAY_EVENING)).status, "busy");
    assert.equal((await run(new Date(SUNDAY_EVENING.getTime() + 2 * 60_000))).status, "ok");
    const [row] = await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, "daily"));
    assert.equal(row.leaseUntil, null);
    assert.ok(row.lastOkAt);
    assert.doesNotMatch(JSON.stringify(row.lastResult), /@/, "counts only, no addresses");
  });
});

describe("housekeeping", () => {
  it("deletes sign-in codes older than 2 days and sessions expired over a week ago", async () => {
    const a = await person();
    const d = await db();
    await d.insert(schema.loginCodes).values([
      { id: "old", email: a.email, codeHash: "x", expiresAt: new Date("2026-11-19T00:10:00Z"), createdAt: new Date("2026-11-19T00:00:00Z") },
      { id: "new", email: a.email, codeHash: "x", expiresAt: new Date("2026-11-22T00:10:00Z"), createdAt: new Date("2026-11-22T00:00:00Z") },
    ]);
    await d.insert(schema.sessions).values([
      { id: "gone", userId: a.id, expiresAt: new Date("2026-11-10T00:00:00Z") },
      { id: "live", userId: a.id, expiresAt: new Date("2026-12-10T00:00:00Z") },
    ]);
    const r = await run(SUNDAY_EVENING);
    assert.deepEqual([r.housekeeping?.loginCodes, r.housekeeping?.sessions], [1, 1]);
    assert.deepEqual((await d.select({ id: schema.loginCodes.id }).from(schema.loginCodes)).map((x) => x.id), ["new"]);
    assert.deepEqual((await d.select({ id: schema.sessions.id }).from(schema.sessions).where(and(eq(schema.sessions.userId, a.id)))).map((x) => x.id), ["live"]);
  });

  // Ask keeps questions for the IST day only (contract §11). SUNDAY_EVENING is the 22nd in IST.
  it("deletes Ask's questions and counts from before today (IST), keeping today's and everyone's totals", async () => {
    const a = await person();
    const d = await db();
    await d.insert(schema.askTurns).values([
      { id: "yesterday", userId: a.id, clientKey: "k1", day: "2026-11-21", status: "answered", kind: "answer", question: "q1", answer: "a1" },
      { id: "today", userId: a.id, clientKey: "k2", day: "2026-11-22", status: "answered", kind: "answer", question: "q2", answer: "a2" },
    ]);
    await d.insert(schema.askDays).values([
      { userId: a.id, day: "2026-11-21", used: 3, attempts: 3 },
      { userId: a.id, day: "2026-11-22", used: 1, attempts: 1 },
    ]);
    await d.insert(schema.askTotals).values({ day: "2026-11-21", attempts: 3, answered: 3 }).onConflictDoNothing();
    const r = await run(SUNDAY_EVENING);
    assert.deepEqual([r.housekeeping?.askTurns, r.housekeeping?.askDays], [1, 1]);
    assert.deepEqual((await d.select({ id: schema.askTurns.id }).from(schema.askTurns)).map((x) => x.id), ["today"]);
    assert.deepEqual((await d.select({ day: schema.askDays.day }).from(schema.askDays)).map((x) => x.day), ["2026-11-22"]);
    assert.equal((await d.select().from(schema.askTotals).where(eq(schema.askTotals.day, "2026-11-21"))).length, 1, "totals hold no personal data and stay");
    const dry = await run(SUNDAY_EVENING, { dry: true });
    assert.equal(dry.housekeeping, null, "a read-only run deletes nothing");
  });
});

describe("the feedback Sheet's catch-up", () => {
  const SHEET = { GOOGLE_SHEETS_WEBHOOK_URL: "https://script.example.test/exec", GOOGLE_SHEETS_WEBHOOK_SECRET: "sheet-secret" };
  async function withSheet(fn: (calls: { action: string; respondent?: string; rows?: unknown[] }[]) => Promise<void>) {
    const realFetch = globalThis.fetch;
    const calls: { action: string; respondent?: string; rows?: unknown[] }[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      const reply = body.action === "feedback" ? { ok: true, status: "saved", saved: body.rows.length } : { ok: true, status: "forgotten", deleted: 1 };
      return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    Object.assign(process.env, SHEET);
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of Object.keys(SHEET)) delete process.env[k];
    }
  }

  it("finishes forgets the Sheet missed and copies answers that didn't arrive; dry runs leave the Sheet alone", async () => {
    await withSheet(async (calls) => {
      const a = await person();
      const d = await db();
      await d.insert(schema.feedbackAnswers).values({ id: "ans-1", userId: a.id, survey: "fb-1", question: "feel", answer: "very", path: "used", source: "page" });
      await d.insert(schema.jobRuns).values({ job: "sheet-forget:r_0123456789ab", lastStartedAt: new Date("2026-11-20T00:00:00Z") });

      const dry = await run(SUNDAY_EVENING, { dry: true });
      assert.equal(dry.sheet, null);
      assert.equal(calls.length, 0, "a read-only run doesn't touch the Sheet");

      const r = await run(SUNDAY_EVENING);
      assert.deepEqual(
        calls.map((c) => c.action),
        ["forget", "feedback"],
      );
      assert.equal(calls[0].respondent, "r_0123456789ab");
      assert.deepEqual(r.sheet, { forgotten: 1, forgetsPending: 0, sync: { status: "ok", sent: 1, marked: 1 } });
      assert.equal((await d.select().from(schema.jobRuns).where(like(schema.jobRuns.job, "sheet-forget:%"))).length, 0, "marker gone");
      const [row] = await d.select().from(schema.feedbackAnswers).where(eq(schema.feedbackAnswers.id, "ans-1"));
      assert.ok(row.sheetSyncedAt, "marked as copied");
    });
  });

  it("without the Sheet's URL and secret, it does nothing", async () => {
    const r = await run(SUNDAY_EVENING);
    assert.deepEqual(r.sheet, { forgotten: 0, forgetsPending: 0, sync: { status: "not_configured" } });
  });
});

describe("the cron route", () => {
  const call = (headers: Record<string, string> = {}, query = "") => GET(new Request(`https://www.d-human.fit/api/cron/daily${query}`, { headers }));

  it("refuses without CRON_SECRET set, or with the wrong one", async () => {
    delete process.env.CRON_SECRET;
    assert.equal((await call({ authorization: "Bearer anything" })).status, 503);
    process.env.CRON_SECRET = "cron-secret-for-tests";
    assert.equal((await call()).status, 401);
    assert.equal((await call({ authorization: "Bearer wrong" })).status, 401);
    assert.equal((await call({ authorization: "cron-secret-for-tests" })).status, 401);
  });

  it("runs with Vercel's bearer header; ?dry=1 is read-only", async () => {
    process.env.CRON_SECRET = "cron-secret-for-tests";
    const res = await call({ authorization: "Bearer cron-secret-for-tests" }, "?dry=1");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; dry: boolean };
    assert.deepEqual([body.status, body.dry], ["ok", true]);
    const d = await db();
    assert.equal((await d.select().from(schema.jobRuns)).length, 0);
  });
});

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
