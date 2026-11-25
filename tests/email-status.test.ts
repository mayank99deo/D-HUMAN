// The founders' email status page (/write/status): its words for each recent sign-up's
// welcome or "finish setting up" email, the switches, the daily job, and the loader, run
// through production's driver (tests/support/driver-db.ts). The end-to-end case goes the
// way a real sign-up does: onboarding's last save, the welcome in after(), Resend's
// "delivered" webhook, then the page. Resend is a stand-in; nothing leaves the machine.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";
import { driverDatabase } from "./support/driver-db.ts";

type Payload = { to: string; subject: string; tags: { name: string; value: string }[] };
type AfterFn = () => unknown;
const g = globalThis as unknown as { __fake: { calls: { payload: Payload; id: string }[] }; __testUser?: { id: string; email: string } | null; __after?: AfterFn[] };
g.__fake = { calls: [] };

allowAppImports({
  resend: `
    export class Resend {
      constructor() {
        this.emails = { send: async (p) => {
          const id = "re_" + (globalThis.__fake.calls.length + 1);
          globalThis.__fake.calls.push({ payload: p, id });
          return { data: { id }, error: null, headers: {} };
        } };
        this.batch = { send: async () => { throw new Error("batch not expected"); } };
        this.webhooks = { verify: () => null };
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
process.env.BLOG_OWNER_EMAILS = "writer@example.com";
for (const k of ["VERCEL_ENV", "EMAIL_BATCH", "EMAIL_DAILY_CAP", "ANTHROPIC_API_KEY", "D_HUMAN_AI_MOCK", "EMAIL_WEEKLY_LIVE", "EMAIL_LIFECYCLE_LIVE", "RESEND_WEBHOOK_SECRET", "CRON_SECRET"]) delete process.env[k];

const { sql } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const view = await import("../lib/email/status-view.ts");
const { isOn, switchState } = await import("../lib/email/switches.ts");
const { loadEmailStatus, switchLines } = await import("../lib/email/status.ts");
const { handleResendEvent } = await import("../lib/email/suppress.ts");
const { emailHash } = await import("../lib/email/suppress.ts");
const jobs = await import("../lib/email/jobs.ts");
const profileRoute = await import("../app/api/profile/route.ts");

after(removeDatabase);
beforeEach(async () => {
  g.__fake.calls = [];
  g.__after = [];
  g.__testUser = null;
  delete process.env.EMAIL_LIFECYCLE_LIVE;
  const d = await db();
  await d.execute(sql`truncate users, job_runs, email_suppressions, email_daily_counts, login_codes cascade`);
});

const H = 60 * 60 * 1000;
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);
const ctx = (o: Partial<{ now: Date; lifecycleLive: boolean; budgetLeft: number }> = {}) => ({ now: new Date("2026-11-25T09:00:00Z"), lifecycleLive: true, budgetLeft: 50, maxAttempts: 3, ...o });
const NOW = new Date("2026-11-25T09:00:00Z");
const person = (o: Partial<Parameters<typeof view.welcomeCell>[0]> = {}) => ({
  accountAt: ago(NOW, 3 * H),
  onboardedAt: ago(NOW, 2 * H),
  writer: false,
  suppressed: false,
  welcome: null,
  unfinished: null,
  dryWelcome: false,
  dryUnfinished: false,
  ...o,
});
const send = (status: string, o: Partial<{ error: string; attempts: number; sentAt: Date | null }> = {}) => ({
  status,
  sentAt: o.sentAt === undefined ? ago(NOW, H) : o.sentAt,
  createdAt: ago(NOW, H),
  hasProviderId: true,
  error: o.error ?? null,
  attempts: o.attempts ?? 0,
});

describe("small rules", () => {
  it("masks an address to its first two letters and its domain", () => {
    assert.equal(view.maskEmail("abhishek@gmail.com"), "ab•••@gmail.com");
    assert.equal(view.maskEmail("ab@gmail.com"), "a•••@gmail.com");
    assert.equal(view.maskEmail("a@x.in"), "a•••@x.in");
    assert.equal(view.maskEmail("nonsense"), "•••");
  });

  it("cuts error text before query parameters and masks any address in it", () => {
    assert.equal(view.cleanError('Failed query: select 1 where email = $1\nparams: asha@example.com'), "Failed query: select 1 where email = $1");
    assert.equal(view.cleanError("bounce to asha.rao@example.com failed"), "bounce to as•••@example.com failed");
    assert.equal(view.cleanError("x".repeat(400))?.length, 160);
    assert.equal(view.cleanError(null), null);
  });

  it("reads a switch the way the daily job does, and names one set but not read as on", () => {
    for (const v of ["1", "true", " ON ", "Yes"]) assert.deepEqual([isOn(v), switchState(v)], [true, "on"]);
    for (const v of [undefined, "", "  "]) assert.deepEqual([isOn(v), switchState(v)], [false, "off"]);
    for (const v of ['"1"', "0", "false", "enabled"]) assert.deepEqual([isOn(v), switchState(v)], [false, "unrecognised"]);
  });

  it("puts alert markers into words", () => {
    assert.equal(view.alertWords("alert:daily-failed:2026-11-24"), "The daily job failed (24 Nov, UTC day)");
    assert.equal(view.alertWords("alert:weekly-cap:2026-11-16"), "The weekly list neared the daily limit (week of 16 Nov)");
    assert.equal(view.alertWords("alert:ask-cap:2026-11-20"), "Ask reached its daily limit (20 Nov)");
    assert.equal(view.alertWords("something-else"), "something-else");
  });

  it("shows any other job's result in one line: status, plain fields one level deep, addresses masked", () => {
    assert.equal(view.resultLine(null), "no result yet");
    assert.equal(view.resultLine({ status: "ok", copied: 4, pending: 0, sync: { rows: 2, note: "sent to asha@example.com" }, list: [1, 2] }), "ok, copied 4, pending 0, sync.rows 2, sync.note sent to as•••@example.com");
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    assert.equal(view.resultLine(many).split(", ").length, 12);
  });
});

describe("the welcome, in words", () => {
  it("follows the ledger: delivered, sent, sending, no answer, failed, gave up, bounced, spam, unknown", () => {
    const c = ctx();
    assert.deepEqual([view.welcomeCell(person({ welcome: send("delivered") }), c).label, view.welcomeCell(person({ welcome: send("delivered") }), c).tone], ["Delivered", "done"]);
    assert.equal(view.welcomeCell(person({ welcome: send("sent") }), c).label, "Sent");
    assert.equal(view.welcomeCell(person({ welcome: send("sending", { sentAt: ago(NOW, 60_000) }) }), c).label, "Sending");
    assert.equal(view.welcomeCell(person({ welcome: send("sending", { sentAt: ago(NOW, 30 * 60_000) }) }), c).label, "No answer yet");
    const failed = view.welcomeCell(person({ welcome: send("failed", { error: "validation_error 422", attempts: 1 }) }), c);
    assert.deepEqual([failed.tone, failed.label], ["problem", "Failed"]);
    assert.match(failed.detail ?? "", /validation_error 422.*Try 1 of 3/);
    assert.equal(view.welcomeCell(person({ welcome: send("failed", { attempts: 3 }) }), c).label, "Failed, gave up");
    assert.equal(view.welcomeCell(person({ welcome: send("bounced", { error: "bounce:Permanent" }) }), c).label, "Bounced");
    assert.equal(view.welcomeCell(person({ welcome: send("complained") }), c).label, "Marked as spam");
    assert.equal(view.welcomeCell(person({ welcome: send("unknown") }), c).tone, "problem");
  });

  it("without a ledger row: waits for onboarding, held by the switch, on its way, or missed", () => {
    assert.equal(view.welcomeCell(person({ onboardedAt: null }), ctx()).label, "Waits for onboarding");
    assert.deepEqual(Object.values(view.welcomeCell(person({ dryWelcome: true }), ctx({ lifecycleLive: false }))).slice(0, 2), ["dry", "Dry run"]);
    assert.equal(view.welcomeCell(person(), ctx({ lifecycleLive: false })).detail, "EMAIL_LIFECYCLE_LIVE is off");
    const waiting = view.welcomeCell(person({ dryWelcome: true }), ctx());
    assert.deepEqual([waiting.tone, waiting.label], ["wait", "Not yet"]);
    assert.match(waiting.detail ?? "", /dry run.*next daily run/);
    assert.match(view.welcomeCell(person(), ctx({ budgetLeft: 0 })).detail ?? "", /budget is used up/);
    assert.deepEqual(Object.values(view.welcomeCell(person({ onboardedAt: ago(NOW, 49 * H) }), ctx())).slice(0, 2), ["problem", "Never sent"]);
    assert.equal(view.welcomeCell(person({ suppressed: true }), ctx()).tone, "problem");
  });
});

describe('"finish setting up", in words', () => {
  const fresh = { onboardedAt: null };
  it("not needed once they finish; never for writers; waits 24 hours; due after; not for old accounts", () => {
    assert.equal(view.unfinishedCell(person(), ctx()).label, "Not needed");
    assert.equal(view.unfinishedCell(person({ ...fresh, writer: true }), ctx()).label, "Never");
    const young = view.unfinishedCell(person({ ...fresh, accountAt: ago(NOW, 2 * H) }), ctx());
    assert.deepEqual([young.tone, young.label], ["wait", "Not yet"]);
    assert.match(young.detail ?? "", /^Due from 26 Nov, 12:30 IST/);
    assert.equal(view.unfinishedCell(person({ ...fresh, accountAt: ago(NOW, 30 * H) }), ctx()).label, "Due");
    assert.equal(view.unfinishedCell(person({ ...fresh, accountAt: ago(NOW, 30 * H) }), ctx({ lifecycleLive: false })).tone, "dry");
    assert.equal(view.unfinishedCell(person({ ...fresh, accountAt: ago(NOW, 8 * 24 * H) }), ctx()).label, "Not sent");
    assert.equal(view.unfinishedCell(person({ ...fresh, unfinished: send("delivered") }), ctx()).label, "Delivered");
  });

  it("the row leads with the email that matters now, and the totals count that one", () => {
    const rows = [
      view.signupRow({ ...person({ welcome: send("delivered") }), email: "asha@example.com" }, ctx()),
      view.signupRow({ ...person({ ...fresh, accountAt: ago(NOW, 30 * H) }), email: "ravi@example.com" }, ctx()),
      view.signupRow({ ...person({ welcome: send("failed", { attempts: 1 }) }), email: "meera@example.com" }, ctx()),
    ];
    assert.deepEqual(rows.map((r) => r.main), ["welcome", "welcome_unfinished", "welcome"]);
    assert.deepEqual(view.signupTotals(rows), { signups: 3, onboarded: 2, delivered: 1, sent: 1, waiting: 1, dry: 0, problems: 1 });
  });
});

describe("the daily job's last result", () => {
  it("reads a real run, and survives junk", async () => {
    process.env.EMAIL_LIFECYCLE_LIVE = "1";
    const result = await jobs.runDaily({ now: NOW, paceMs: 0, origin: "https://www.d-human.fit" });
    const run = view.runView(JSON.parse(JSON.stringify(result)));
    assert.ok(run);
    assert.equal(run.status, "ok");
    assert.deepEqual(run.kinds.map((k) => [k.kind, k.live]), [["Welcome", true], ["Finish setting up", true], ["Weekly", false], ["Feedback", true]]);
    assert.match(run.housekeeping ?? "", /^deleted 0 old codes/);
    assert.equal(view.runView(null), null);
    assert.equal(view.runView({}), null);
    assert.equal(view.runView({ status: "error", failedAt: "welcome", error: "Failed query: x\nparams: a@b.co" })?.error, "Failed query: x");
  });
});

let n = 0;
async function account(o: { accountAt?: Date; onboardedAt?: Date | null; email?: string } = {}) {
  const d = await db();
  const id = `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
  const email = o.email ?? `person${n}@example.com`;
  await d.insert(schema.users).values({ id, email, createdAt: o.accountAt ?? ago(new Date(), 3 * H) });
  await d.insert(schema.profiles).values({ userId: id, name: "Asha Rao", birthYear: 1994, timezone: "Asia/Kolkata", onboardedAt: o.onboardedAt === undefined ? ago(new Date(), 2 * H) : o.onboardedAt });
  return { id, email };
}

describe("the page's data, through production's driver", () => {
  it("a sign-up finishes onboarding: the welcome goes in after(), Resend reports it delivered, and the page says so", async () => {
    process.env.EMAIL_LIFECYCLE_LIVE = "1";
    const a = await account({ onboardedAt: null });
    g.__testUser = { id: a.id, email: a.email };
    const response = await profileRoute.POST(
      new Request("https://www.d-human.fit/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true, complete: true, name: "Asha Rao" }) }),
    );
    assert.equal(response.status, 200);
    assert.equal(g.__fake.calls.length, 0, "nothing goes before the response");
    for (const fn of g.__after ?? []) await fn();
    const welcome = g.__fake.calls.find((c) => c.payload.tags.some((t) => t.name === "kind" && t.value === "welcome"));
    assert.ok(welcome, "the welcome went to Resend");
    assert.equal(welcome.payload.to, a.email);

    let status = await loadEmailStatus(new Date());
    assert.deepEqual([status.signups[0].email, status.signups[0].welcome.label], ["pe•••@example.com", "Sent"]);

    // Resend's webhook: the receiving server took it.
    const sendId = welcome.payload.tags.find((t) => t.name === "send_id")!.value;
    const event = { type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: welcome.id, to: [a.email], tags: { kind: "welcome", send_id: sendId } } };
    assert.equal(await handleResendEvent(event as unknown as Parameters<typeof handleResendEvent>[0]), "delivered");
    status = await loadEmailStatus(new Date());
    assert.deepEqual([status.signups[0].welcome.tone, status.signups[0].welcome.label, status.signups[0].unfinished.label], ["done", "Delivered", "Not needed"]);
    assert.deepEqual([status.sends[0].kind, status.sends[0].cell.label, status.sends[0].resendId], ["Welcome", "Delivered", true]);
    assert.equal(status.totals.delivered, 1);
  });

  it("every case at once: dry rows, the bounce list, writers, refusals, the job, alerts and the Sheet lanes; no full address anywhere", async () => {
    const now = new Date();
    const d = await db();
    const dry = await account({ email: "dry.run@example.com" });
    await d.insert(schema.jobRuns).values({ job: `dry:welcome:${dry.id}:once`, lastStartedAt: ago(now, H) });
    const waiting = await account({ onboardedAt: null, accountAt: ago(now, 30 * H), email: "waiting@example.com" });
    const young = await account({ onboardedAt: null, accountAt: ago(now, H), email: "young@example.com" });
    const writer = await account({ onboardedAt: null, accountAt: ago(now, 30 * H), email: "writer@example.com" });
    const bounced = await account({ email: "bounced@example.com" });
    await d.insert(schema.emailSuppressions).values({ emailHash: emailHash(bounced.email), reason: "bounce" });
    const refused = await account({ email: "refused@example.com" });
    await d.insert(schema.emailSends).values({ id: "refused-1", userId: refused.id, kind: "welcome", dedupeKey: "once", localDate: "2026-11-25", status: "failed", attempts: 1, error: `Failed query: x\nparams: ${refused.email}` });
    const old = await account({ accountAt: ago(now, 15 * 24 * H), email: "old.one@example.com" });
    await d.insert(schema.jobRuns).values([
      { job: "alert:daily-failed:2026-11-24", lastStartedAt: ago(now, 20 * H) },
      { job: "users-sync", lastStartedAt: ago(now, H), lastOkAt: ago(now, H), lastResult: { status: "ok", rows: 7, note: `last ${waiting.email}` } },
      { job: "sheet-forget:r_0123456789ab", lastStartedAt: ago(now, H) },
      { job: "sheet-forget:r_ba9876543210", lastStartedAt: ago(now, H) },
    ]);
    const run = await jobs.runDaily({ now, dry: true, origin: "https://www.d-human.fit" });
    assert.equal(run.status, "ok");

    const status = await loadEmailStatus(now);
    const row = (u: { email: string }) => status.signups.find((s) => s.email === view.maskEmail(u.email))!;
    assert.equal(row(old), undefined, "older than 14 days");
    assert.equal(status.signups.length, 6);
    assert.deepEqual([row(dry).welcome.tone, row(dry).welcome.label], ["dry", "Dry run"]);
    assert.deepEqual([row(waiting).main, row(waiting).unfinished.label], ["welcome_unfinished", "Not sent"], "switch off: held");
    assert.deepEqual([row(young).unfinished.tone, row(young).unfinished.detail], ["dry", "EMAIL_LIFECYCLE_LIVE is off"], "the switch, not the 24 hours, is what holds it");
    assert.equal(row(writer).unfinished.label, "Never");
    assert.equal(row(bounced).welcome.tone, "problem");
    assert.deepEqual([row(refused).welcome.label, row(refused).welcome.detail], ["Failed", "Failed query: x. Try 1 of 3; the next run tries again"]);
    assert.deepEqual(status.alerts.map((a) => a.what), ["The daily job failed (24 Nov, UTC day)"]);
    assert.deepEqual(status.sheetJobs.map((j) => j.job), ["users-sync"], "per-person forget rows are counted, not listed");
    // jsonb keeps its own key order (shorter keys first), so the fields are checked as a set.
    assert.deepEqual(status.sheetJobs[0].result.split(", ").sort(), ["note last wa•••@example.com", "ok", "rows 7"]);
    assert.equal(status.forgetsWaiting, 2);
    assert.equal(status.daily, null, "a ?dry=1 run writes nothing, so no daily row yet");
    assert.ok(status.budget.cap > 0);

    // Masked addresses only, and no field about anyone's health.
    const json = JSON.stringify(status);
    assert.doesNotMatch(json, /[a-z0-9._-]{3,}@/i);
    assert.deepEqual(Object.keys(status.signups[0]).sort(), ["email", "main", "onboarded", "signedUp", "unfinished", "welcome"]);
  });

  it("names every switch by name only, never its value", () => {
    process.env.EMAIL_LIFECYCLE_LIVE = '"1"';
    process.env.CRON_SECRET = "a-secret-value-that-must-not-show";
    try {
      const lines = switchLines();
      const lifecycle = lines.find((l) => l.name === "EMAIL_LIFECYCLE_LIVE")!;
      assert.deepEqual([lifecycle.on, lifecycle.state], [false, "unrecognised"]);
      assert.deepEqual([lines.find((l) => l.name === "CRON_SECRET")!.state, lines.find((l) => l.name === "RESEND_WEBHOOK_SECRET")!.state], ["set", "missing"]);
      assert.doesNotMatch(JSON.stringify(lines), /a-secret-value|re_test|test-email-link/);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
