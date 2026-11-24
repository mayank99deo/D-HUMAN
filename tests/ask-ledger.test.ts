// Ask's daily ledger (lib/platform/ask.ts) against a real embedded database: 5 questions a
// day, one in flight, failures handed back once, at most 10 model calls, kinds that don't
// count, client keys per person, dead questions, deletes that never reset a count, a report
// deleted mid-answer, the breaker per IST day, totals, the purge, the account cascade, the
// IST boundary and the indexes. PGlite runs one query at a time, so the real parallel
// checks are tests/pg/ask-parallel.mts (opt-in, TEST_DATABASE_URL).
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

const g = globalThis as unknown as { __alerts: { key: string; subject: string; text: string }[]; __alertStatus: string };
g.__alerts = [];
g.__alertStatus = "sent";

allowAppImports({
  "@/lib/email/send": `export const sendFounderAlert = async (a) => { globalThis.__alerts.push(a); return globalThis.__alertStatus === "sent" ? { status: "sent" } : { status: "not_configured", reason: "not_production" }; };`,
});
const removeDatabase = tempDatabase();
const { eq, sql } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const ask = await import("../lib/platform/ask.ts");
const { ASK_LIMITS } = await import("../lib/ask/types.ts");
type AskReply = import("../lib/ask/types.ts").AskReply;

after(async () => {
  await removeDatabase();
});

let n = 0;
async function newUser() {
  const d = await db();
  const id = `user-${++n}`;
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  return id;
}
const key = () => crypto.randomUUID();
const DAY = "2026-11-19";
const usage = { model: "claude-haiku-5-5", inputTokens: 5000, outputTokens: 300, costMicros: 650, ms: 2100 };
const reply = (kind: "answer" | "off_topic" | "doctor" | "urgent" | "crisis" = "answer"): AskReply => {
  const notice = { level: "urgent" as const, label: "Get advice today", parts: ["symptom" as const], lines: ["See a doctor today."], markers: [], calls: ["112" as const] };
  if (kind === "urgent") return { kind, answer: null, notice, links: [], lang: "en", floorRaised: true, filter: null };
  if (kind === "crisis") return { kind, answer: null, notice: { ...notice, level: "crisis", label: null, parts: ["crisis"] }, links: [], lang: "en", floorRaised: true, filter: null };
  if (kind === "doctor") return { kind, answer: "Worth showing a doctor.", notice: { ...notice, level: "doctor", label: "Doctor first", parts: ["doctor_general"], calls: [] }, links: ["stack"], lang: "en", floorRaised: false, filter: null };
  if (kind === "off_topic") return { kind, answer: "Ask covers food, training and health.", notice: null, links: [], lang: "en", floorRaised: false, filter: null };
  return { kind, answer: "Add a bowl of dal.", notice: null, links: ["log_meal", "stack"], lang: "en", floorRaised: false, filter: null };
};
const claim = (userId: string, o: { day?: string; clientKey?: string; reportId?: string | null; max?: number } = {}) =>
  ask.claimAsk({ userId, clientKey: o.clientKey ?? key(), day: o.day ?? DAY, question: "What should I eat?", reportId: o.reportId ?? null, max: o.max ?? 1_000_000 });
async function counts(userId: string, day = DAY) {
  return ask.askCounters(userId, day);
}
async function turns(userId: string) {
  const d = await db();
  return d.select().from(schema.askTurns).where(eq(schema.askTurns.userId, userId));
}
async function totals(day: string) {
  const d = await db();
  const [row] = await d.select().from(schema.askTotals).where(eq(schema.askTotals.day, day));
  return row;
}
async function answered(userId: string, o: Parameters<typeof claim>[1] = {}, kind: Parameters<typeof reply>[0] = "answer") {
  const c = await claim(userId, o);
  assert.ok(c.ok, "claimed");
  assert.ok(await ask.completeAsk({ turnId: c.turnId, userId, reply: reply(kind), usage, counted: ["answer", "off_topic", "doctor"].includes(kind) }));
  return c;
}

describe("the day's five", () => {
  it("counts five questions; the sixth is refused as the limit and changes nothing", async () => {
    const me = await newUser();
    for (let i = 0; i < 5; i++) await answered(me);
    assert.deepEqual(await counts(me), { used: 5, attempts: 5 });
    const sixth = await claim(me);
    assert.deepEqual(sixth, { ok: false, reason: "limit", used: 5, attempts: 5 });
    assert.deepEqual(await counts(me), { used: 5, attempts: 5 });
    assert.equal((await turns(me)).length, 5, "no turn left behind");
    assert.equal(ask.leftOf(await counts(me)), 0);
  });

  it("lets one question be in flight; a second is busy and rolls back", async () => {
    const me = await newUser();
    const first = await claim(me);
    assert.ok(first.ok);
    assert.deepEqual(await claim(me), { ok: false, reason: "busy" });
    assert.deepEqual(await counts(me), { used: 1, attempts: 1 }, "the busy claim counted nothing");
    await ask.completeAsk({ turnId: first.turnId, userId: me, reply: reply(), usage, counted: true });
    assert.ok((await claim(me)).ok, "free again once answered");
  });

  it("hands a failed question back once; release after answering does nothing", async () => {
    const me = await newUser();
    const c = await claim(me);
    assert.ok(c.ok);
    await ask.releaseAsk(c.turnId, me);
    await ask.releaseAsk(c.turnId, me);
    assert.deepEqual(await counts(me), { used: 0, attempts: 1 }, "handed back once; the call stays counted");
    assert.equal((await turns(me)).length, 0);
    const done = await answered(me);
    await ask.releaseAsk(done.turnId, me);
    assert.deepEqual(await counts(me), { used: 1, attempts: 2 }, "an answered question isn't released");
    assert.equal((await turns(me)).length, 1);
  });

  it("stops at 10 model calls even when every one failed", async () => {
    const me = await newUser();
    for (let i = 0; i < ASK_LIMITS.modelCallsPerDay; i++) {
      const c = await claim(me);
      assert.ok(c.ok, `call ${i + 1}`);
      await ask.releaseAsk(c.turnId, me);
    }
    assert.deepEqual(await counts(me), { used: 0, attempts: 10 });
    assert.deepEqual(await claim(me), { ok: false, reason: "too_many_tries", used: 0, attempts: 10 });
    assert.equal(ask.leftOf(await counts(me)), 0, "no questions left once the calls are used");
  });

  it("hands back urgent and crisis replies from the model, keeping the call", async () => {
    const me = await newUser();
    await answered(me, {}, "urgent");
    await answered(me, {}, "crisis");
    await answered(me, {}, "off_topic");
    assert.deepEqual(await counts(me), { used: 1, attempts: 3 }, "only the off-topic answer used a question");
    const saved = await turns(me);
    assert.deepEqual(saved.map((t) => [t.kind, t.counted, t.status]).sort(), [["crisis", false, "answered"], ["off_topic", true, "answered"], ["urgent", false, "answered"]]);
  });

  it("scopes client keys by person: a repeat is refused, another person may use the same key", async () => {
    const me = await newUser();
    const you = await newUser();
    const k = key();
    const first = await answered(me, { clientKey: k });
    assert.ok(first.ok);
    assert.deepEqual(await claim(me, { clientKey: k }), { ok: false, reason: "duplicate" });
    assert.deepEqual(await counts(me), { used: 1, attempts: 1 }, "the repeat rolled back");
    assert.ok((await claim(you, { clientKey: k })).ok, "the same key is a new question for someone else");
    // A key still pending is busy, not a duplicate.
    const k2 = key();
    const other = await newUser();
    assert.ok((await claim(other, { clientKey: k2 })).ok);
    assert.deepEqual(await claim(other, { clientKey: k2 }), { ok: false, reason: "busy" });
  });

  it("hands back a question that died mid-call when the next one is claimed", async () => {
    const me = await newUser();
    const dead = await claim(me);
    assert.ok(dead.ok);
    const d = await db();
    await d.update(schema.askTurns).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(schema.askTurns.id, dead.turnId));
    const next = await claim(me);
    assert.ok(next.ok, "a dead question doesn't block");
    assert.deepEqual(await counts(me), { used: 1, attempts: 2 });
    assert.equal((await turns(me)).length, 1, "the dead turn went");
  });

  it("never resets a count when questions are cleared or answers blanked", async () => {
    const me = await newUser();
    for (let i = 0; i < 5; i++) await answered(me, { reportId: "r1" });
    assert.equal(await ask.clearAsks(me), 5);
    assert.deepEqual(await claim(me), { ok: false, reason: "limit", used: 5, attempts: 5 });
    const you = await newUser();
    await answered(you, { reportId: "r1" });
    const d = await db();
    await d.transaction((tx) => ask.blankAskAnswers(tx, you));
    assert.deepEqual(await counts(you), { used: 1, attempts: 1 });
  });

  it("saves nothing when a report delete reaches the turn mid-answer, and hands it back", async () => {
    const me = await newUser();
    const c = await claim(me, { reportId: "r9" });
    assert.ok(c.ok);
    const d = await db();
    assert.equal(await d.transaction((tx) => ask.blankAskAnswers(tx, me)), 1);
    assert.equal(await ask.completeAsk({ turnId: c.turnId, userId: me, reply: reply(), usage, counted: true }), false);
    await ask.releaseAsk(c.turnId, me);
    assert.deepEqual(await counts(me), { used: 0, attempts: 1 });
    assert.equal((await turns(me)).length, 0);
  });

  it("saves code's own replies free: answered, not counted, no call", async () => {
    const me = await newUser();
    const k = key();
    const saved = await ask.saveFreeTurn({ userId: me, clientKey: k, day: "2026-11-02", question: "I want to end it", reportId: null, reply: reply("crisis") });
    assert.ok("turn" in saved && saved.turn.status === "answered" && saved.turn.counted === false && saved.turn.answer === null);
    assert.deepEqual(await counts(me, "2026-11-02"), { used: 0, attempts: 0 });
    const t = await totals("2026-11-02");
    assert.deepEqual([t.attempts, t.crisis, t.urgent, t.answered], [0, 1, 0, 0]);
    const again = await ask.saveFreeTurn({ userId: me, clientKey: k, day: "2026-11-02", question: "I want to end it", reportId: null, reply: reply("crisis") });
    assert.ok("turn" in again && again.turn.id === saved.turn.id, "a repeated key returns the saved turn");
    assert.equal((await totals("2026-11-02")).crisis, 1, "counted once");
  });
});

describe("the breaker", () => {
  it("refuses everyone past ASK_DAILY_MAX, keeping each person's own count and leaving no turn; a new IST day reopens", async () => {
    const day = "2026-11-03";
    const people = [await newUser(), await newUser(), await newUser()];
    for (const p of people.slice(0, 2)) await answered(p, { day, max: 2 });
    const third = await claim(people[2], { day, max: 2 });
    assert.deepEqual(third, { ok: false, reason: "paused", everyone: 2 });
    assert.deepEqual(await counts(people[2], day), { used: 0, attempts: 0 }, "their own count untouched");
    assert.equal((await turns(people[2])).length, 0);
    assert.ok((await claim(people[2], { day: "2026-11-04", max: 2 })).ok, "the next day starts again");
  });

  it("adds up calls, answers by kind, tokens and cost for the day", async () => {
    const day = "2026-11-05";
    const me = await newUser();
    await answered(me, { day }, "answer");
    await answered(me, { day }, "doctor");
    await answered(me, { day }, "off_topic");
    await answered(me, { day }, "urgent");
    const c = await claim(me, { day });
    assert.ok(c.ok);
    await ask.releaseAsk(c.turnId, me);
    const t = await totals(day);
    assert.deepEqual(
      { attempts: t.attempts, answered: t.answered, offTopic: t.offTopic, doctor: t.doctor, urgent: t.urgent, crisis: t.crisis, inputTokens: Number(t.inputTokens), outputTokens: Number(t.outputTokens), costMicros: Number(t.costMicros) },
      { attempts: 5, answered: 4, offTopic: 1, doctor: 1, urgent: 1, crisis: 0, inputTokens: 20_000, outputTokens: 1200, costMicros: 2600 },
    );
  });

  it("reads ASK_DAILY_MAX as a whole number from 0 up, else 2,000", () => {
    assert.equal(ask.askDailyMax(undefined), 2000);
    assert.equal(ask.askDailyMax(""), 2000);
    assert.equal(ask.askDailyMax("abc"), 2000);
    assert.equal(ask.askDailyMax("-5"), 2000);
    assert.equal(ask.askDailyMax("2.5"), 2000);
    assert.equal(ask.askDailyMax(" 0 "), 0);
    assert.equal(ask.askDailyMax("3000"), 3000);
    assert.equal(ask.alertLine(2000), 1600);
    assert.equal(ask.alertLine(3), 3);
  });

  it("emails the founders once a day for 80% and once for the cap, retrying a send that didn't go", async () => {
    g.__alerts = [];
    assert.equal(await ask.askAlert("80", "2026-11-06", 1600, 2000), "sent");
    assert.equal(await ask.askAlert("80", "2026-11-06", 1700, 2000), "already_sent");
    assert.equal(await ask.askAlert("cap", "2026-11-06", 2000, 2000), "sent");
    assert.equal(await ask.askAlert("80", "2026-11-07", 1600, 2000), "sent", "a new day alerts again");
    assert.equal(g.__alerts.length, 3);
    assert.match(g.__alerts[0].text, /1600 model calls/);
    assert.match(g.__alerts[0].text, /raise ASK_DAILY_MAX in Vercel and redeploy/);
    assert.doesNotMatch(g.__alerts.map((a) => a.text).join(" "), /@|user-/, "counts only");
    g.__alertStatus = "not_configured";
    assert.equal(await ask.askAlert("cap", "2026-11-08", 2000, 2000), "not_production");
    const d = await db();
    assert.equal((await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, "alert:ask-cap:2026-11-08"))).length, 0, "the marker is freed for a later try");
    g.__alertStatus = "sent";
    assert.equal(await ask.askAlert("cap", "2026-11-08", 2000, 2000), "sent");
  });
});

describe("keeping and deleting", () => {
  it("purges questions and counts from before today (IST) and keeps today's and the totals", async () => {
    const me = await newUser();
    const now = new Date("2026-11-21T05:00:00Z"); // 10:30 IST on the 21st
    await answered(me, { day: "2026-11-20" });
    await answered(me, { day: "2026-11-21" });
    const before = (await totals("2026-11-20")).attempts;
    const d = await db();
    const purged = await ask.purgeAsks(d, now);
    assert.ok(purged.askTurns >= 1 && purged.askDays >= 1);
    const left = await turns(me);
    assert.deepEqual(left.map((t) => t.day), ["2026-11-21"]);
    assert.deepEqual(await counts(me, "2026-11-20"), { used: 0, attempts: 0 });
    assert.deepEqual(await counts(me, "2026-11-21"), { used: 1, attempts: 1 });
    assert.equal((await totals("2026-11-20")).attempts, before, "totals hold no personal data and stay");
  });

  it("takes every question and count with the account; totals stay", async () => {
    const me = await newUser();
    await answered(me, { day: "2026-11-09" });
    const d = await db();
    await d.delete(schema.users).where(eq(schema.users.id, me));
    assert.equal((await turns(me)).length, 0);
    assert.equal((await d.select().from(schema.askDays).where(eq(schema.askDays.userId, me))).length, 0);
    assert.ok((await totals("2026-11-09")).attempts >= 1);
  });

  it("clears answered questions but leaves one in flight", async () => {
    const me = await newUser();
    await answered(me);
    const live = await claim(me);
    assert.ok(live.ok);
    assert.equal(await ask.clearAsks(me), 1);
    const left = await turns(me);
    assert.deepEqual(left.map((t) => t.status), ["pending"]);
  });
});

describe("the IST day", () => {
  it("turns at 18:30 UTC, and resetsAt is that moment, across a year end too", () => {
    assert.equal(ask.istDay(new Date("2026-11-19T18:29:59.999Z")), "2026-11-19");
    assert.equal(ask.istDay(new Date("2026-11-19T18:30:00.000Z")), "2026-11-20");
    assert.equal(ask.istDay(new Date("2026-12-31T18:30:00.000Z")), "2027-01-01");
    assert.equal(ask.resetsAt("2026-11-19"), "2026-11-19T18:30:00.000Z");
    assert.equal(ask.resetsAt("2026-12-31"), "2026-12-31T18:30:00.000Z");
  });
});

describe("query plans", () => {
  it("serve the thread, the in-flight check, client keys and the purge from indexes", async () => {
    const d = await db();
    // One transaction, so the setting and every explain share a connection on any driver
    // (real Postgres through the pool too: TEST_DATABASE_URL in tests/support/app.ts).
    await d.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      for (const [label, q] of [
        ["thread", sql`explain select * from ask_turns where user_id = 'u' and day = '2026-11-19' order by created_at`],
        ["thread or replay", sql`explain select * from ask_turns where user_id = 'u' and (day = '2026-11-19' or client_key = 'k')`],
        ["one in flight", sql`explain select 1 from ask_turns where user_id = 'u' and status = 'pending'`],
        ["client key", sql`explain select 1 from ask_turns where user_id = 'u' and client_key = 'k'`],
        ["purge", sql`explain delete from ask_turns where day < '2026-11-12'`],
        ["counters", sql`explain select used from ask_days where user_id = 'u' and day = '2026-11-19'`],
        ["report delete", sql`explain update ask_turns set answer = null where user_id = 'u' and report_id is not null and removed_at is null`],
      ] as const) {
        const result = (await tx.execute(q)) as unknown as Record<string, string>[] | { rows: Record<string, string>[] };
        const plan = (Array.isArray(result) ? result : result.rows).map((r) => r["QUERY PLAN"]).join(" | ");
        assert.match(plan, /Index|Bitmap/, `${label}: ${plan}`);
      }
    });
  });
});

