// /api/ask and /api/ask/consent against a real embedded database, with the AI
// (lib/ai/ask.ts) stubbed so a test can make it answer each kind, fail, refuse, time out,
// throw or hang. Covers every error code with its status and whether `left` moved, the
// check order of the contract's §3.2, crisis replies while Ask is off, paused or used up,
// two people whose threads never cross, a canary that never reaches the logs, no-store and
// Origin on every method, the gate, replays, a report deleted mid-answer, the breaker's
// alerts, and GET's stale, pending, pinned, starters and left.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Input = { question: string; about: unknown; earlier: { question: string; answer: string }[]; data: Record<string, unknown> & { report: { id: string } | null; asksLeft: number }; spoken?: string | null };
type Globals = {
  __testUser?: { id: string; email: string } | null;
  __after: (() => unknown)[];
  __alerts: { key: string; subject: string; text: string }[];
  __ask: {
    pre: (input: { question: string; about: unknown; data: unknown }) => unknown;
    answer: (input: Input, opts: { signal: AbortSignal }) => Promise<unknown>;
    preCalls: { question: string; about: unknown; data: unknown }[];
    calls: Input[];
  };
};
const g = globalThis as unknown as Globals;
g.__after = [];
g.__alerts = [];

allowAppImports({
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "@/lib/ai/ask": `
    export const askPreCheck = (input) => { globalThis.__ask.preCalls.push(input); return globalThis.__ask.pre(input); };
    export const answerAsk = (input, opts) => { globalThis.__ask.calls.push(input); return globalThis.__ask.answer(input, opts); };
  `,
  "@/lib/email/send": `export const sendFounderAlert = async (a) => { globalThis.__alerts.push(a); return { status: "sent" }; };`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ASK_OPEN;
delete process.env.ASK_DAILY_MAX;
process.env.D_HUMAN_AI_MOCK = "1";

const { eq, and } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const route = await import("../app/api/ask/route.ts");
const consentRoute = await import("../app/api/ask/consent/route.ts");
const { istDay, claimAsk } = await import("../lib/platform/ask.ts");
const { deleteReports } = await import("../lib/platform/reports.ts");
const { ASK_ERROR_STATUS } = await import("../lib/ask/types.ts");
type AskReply = import("../lib/ask/types.ts").AskReply;

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

const usage = { model: "claude-haiku-5-5", inputTokens: 4000, outputTokens: 200, costMicros: 500, ms: 1800 };
const answerReply = (text = "Add a bowl of dal to lunch."): AskReply => ({ kind: "answer", answer: text, notice: null, links: ["log_meal", "report"], lang: "en", floorRaised: false, filter: null });
const crisisReply: AskReply = {
  kind: "crisis",
  answer: null,
  notice: { level: "crisis", label: null, parts: ["crisis"], lines: ["You don't have to face this alone."], markers: [], calls: ["14416", "112"] },
  links: [],
  lang: "en",
  floorRaised: true,
  filter: null,
};
function resetAsk() {
  g.__ask = { pre: () => null, answer: async () => ({ ok: true, reply: answerReply(), usage }), preCalls: [], calls: [] };
}
resetAsk();
beforeEach(() => {
  resetAsk();
  g.__after = [];
  delete process.env.ASK_DAILY_MAX;
  process.env.D_HUMAN_AI_MOCK = "1";
});
const runAfters = async () => {
  const jobs = g.__after.splice(0);
  for (const job of jobs) await job();
};

// ── People ──────────────────────────────────────────────────────────────────

let n = 0;
const owners: string[] = [];
type Person = { id: string; email: string; ip: string };
async function person(o: { founder?: boolean; birthYear?: number | null; onboarded?: boolean; askConsent?: boolean; timezone?: string; name?: string; medications?: string; conditions?: string[] } = {}): Promise<Person> {
  const d = await db();
  const id = crypto.randomUUID();
  const email = `p${++n}@example.com`;
  await d.insert(schema.users).values({ id, email });
  await d.insert(schema.profiles).values({
    userId: id,
    name: o.name ?? "Asha Rao",
    birthYear: o.birthYear === undefined ? 1994 : o.birthYear,
    sex: "female",
    heightCm: 160,
    weightKg: 56,
    timezone: o.timezone ?? "Asia/Kolkata",
    primaryActivity: "running",
    activities: ["running"],
    level: "regular",
    diet: "veg",
    conditions: o.conditions ?? [],
    medications: o.medications ?? null,
    consentAt: new Date(),
    onboardedAt: o.onboarded === false ? null : new Date(),
    askConsentAt: o.askConsent === false ? null : new Date(),
  });
  if (o.founder !== false) {
    owners.push(email);
    process.env.BLOG_OWNER_EMAILS = owners.join(",");
  }
  return { id, email, ip: `10.1.${Math.floor(n / 250)}.${n % 250}` };
}
const signIn = (p: Person | null) => (g.__testUser = p ? { id: p.id, email: p.email } : null);

const ORIGIN = "http://localhost";
function postRequest(p: Person | null, body: unknown, headers: Record<string, string> = {}, path = "/api/ask") {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": p?.ip ?? "10.250.0.1", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
type Res = { status: number; body: Record<string, unknown>; headers: Headers };
async function read(res: Response): Promise<Res> {
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
}
async function ask(p: Person, question = "What should I eat before a 10K?", extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Res> {
  signIn(p);
  return read(await route.POST(postRequest(p, { clientKey: crypto.randomUUID(), question, ...extra }, headers)));
}
async function thread(p: Person): Promise<Res> {
  signIn(p);
  return read(await route.GET());
}
async function counts(p: Person) {
  const d = await db();
  const [row] = await d.select().from(schema.askDays).where(and(eq(schema.askDays.userId, p.id), eq(schema.askDays.day, istDay())));
  return { used: row?.used ?? 0, attempts: row?.attempts ?? 0 };
}
async function setCounts(p: Person, used: number, attempts: number) {
  const d = await db();
  await d.insert(schema.askDays).values({ userId: p.id, day: istDay(), used, attempts }).onConflictDoUpdate({ target: [schema.askDays.userId, schema.askDays.day], set: { used, attempts } });
}
async function setEveryone(attempts: number) {
  const d = await db();
  await d.insert(schema.askTotals).values({ day: istDay(), attempts }).onConflictDoUpdate({ target: schema.askTotals.day, set: { attempts } });
}
async function turnsOf(p: Person) {
  const d = await db();
  return d.select().from(schema.askTurns).where(eq(schema.askTurns.userId, p.id));
}
async function readyReport(p: Person, o: { collectedOn?: string; analyzedAt?: Date; nameOnReport?: string; markers?: { key: string; name: string; status: string; flag?: string | null; value?: number }[] } = {}) {
  const d = await db();
  const id = crypto.randomUUID();
  await d.insert(schema.reports).values({ id, userId: p.id, status: "ready", collectedOn: o.collectedOn ?? "2026-11-01", nameOnReport: o.nameOnReport ?? "Asha Rao", analyzedAt: o.analyzedAt ?? new Date() });
  await d.insert(schema.analyses).values({ reportId: id, userId: p.id, read: { verdict: { level: "go_with_tweaks", line: "CANARY_READ_TEXT" } } });
  let pos = 0;
  for (const m of o.markers ?? [{ key: "vitamin_d", name: "Vitamin D", status: "low" }]) {
    await d.insert(schema.markers).values({ id: crypto.randomUUID(), reportId: id, userId: p.id, key: m.key, name: m.name, value: m.value ?? 12, unit: "ng/mL", status: m.status, flag: m.flag ?? null, position: pos++ });
  }
  return id;
}

// ── The order of checks, and every code ─────────────────────────────────────

describe("POST: the checks, in order", () => {
  it("1. refuses a missing or foreign Origin first, even signed out", async () => {
    signIn(null);
    for (const headers of [{ origin: "https://evil.example" }, { origin: "" }]) {
      const res = await read(await route.POST(postRequest(null, "not json", headers)));
      assert.equal(res.status, 403);
      assert.equal(res.body.error, "bad_origin");
    }
  });

  it("2. refuses anything but JSON before reading the body or the session", async () => {
    signIn(null);
    const res = await read(await route.POST(postRequest(null, "question=hi", { "content-type": "text/plain" })));
    assert.deepEqual([res.status, res.body.error], [415, "bad_type"]);
    const form = await read(await route.POST(postRequest(null, "a=b", { "content-type": "application/x-www-form-urlencoded" })));
    assert.equal(form.body.error, "bad_type");
  });

  it("3. refuses a body over 4 KB by its length, and by what arrives when the length isn't given", async () => {
    signIn(null);
    const big = JSON.stringify({ clientKey: crypto.randomUUID(), question: "x".repeat(10_000) });
    const res = await read(await route.POST(postRequest(null, big, { "content-length": String(Buffer.byteLength(big)) })));
    assert.deepEqual([res.status, res.body.error], [413, "too_large"]);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const chunked = new Request(`${ORIGIN}/api/ask`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    const res2 = await read(await route.POST(chunked));
    assert.deepEqual([res2.status, res2.body.error], [413, "too_large"]);
  });

  it("4. answers signed_out without a session", async () => {
    signIn(null);
    const res = await read(await route.POST(postRequest(null, { clientKey: crypto.randomUUID(), question: "hi there" })));
    assert.deepEqual([res.status, res.body.error], [401, "signed_out"]);
    assert.equal(res.body.left, undefined, "no day fields before the person is known");
  });

  it("5. slows a burst: the 7th POST in a minute is rate_limited, before anything is read", async () => {
    const me = await person();
    for (let i = 0; i < 6; i++) await ask(me, "What should I eat?");
    const seventh = await ask(me, "What should I eat?");
    assert.deepEqual([seventh.status, seventh.body.error], [429, "rate_limited"]);
    assert.equal(seventh.body.day, istDay());
  });

  it("6. keeps Ask to founders (403 not_allowed), adults (403 not_allowed, reason not revealed) and finished onboarding (409)", async () => {
    const stranger = await person({ founder: false });
    assert.deepEqual(Object.values((await ask(stranger)).body).slice(0, 1), ["not_allowed"]);
    assert.equal((await ask(stranger)).status, 403);
    const young = await person({ birthYear: new Date().getFullYear() - 17 });
    const y = await ask(young);
    assert.deepEqual([y.status, y.body.error], [403, "not_allowed"]);
    const unknownAge = await person({ birthYear: null });
    assert.equal((await ask(unknownAge)).body.error, "not_allowed");
    const halfway = await person({ onboarded: false });
    const h = await ask(halfway);
    assert.deepEqual([h.status, h.body.error], [409, "not_onboarded"]);
    process.env.ASK_OPEN = "all";
    try {
      assert.equal((await ask(stranger)).status, 200, "ASK_OPEN=all opens it to every onboarded adult");
    } finally {
      delete process.env.ASK_OPEN;
    }
  });

  it("7. asks for the one-time notice before reading the question (an invalid body still gets consent_needed)", async () => {
    const before = await person({ askConsent: false });
    signIn(before);
    const res = await read(await route.POST(postRequest(before, "{broken")));
    assert.deepEqual([res.status, res.body.error], [409, "consent_needed"]);
    assert.equal(g.__ask.preCalls.length + g.__ask.calls.length, 0, "nothing sent anywhere before consent");
  });

  it("8. refuses an empty or over-long question as 400, never cutting it", async () => {
    const me = await person();
    const empty = await ask(me, "   ");
    assert.deepEqual([empty.status, empty.body.error], [400, "empty"]);
    const long = await ask(me, "a".repeat(301));
    assert.deepEqual([long.status, long.body.error], [400, "too_long"]);
    assert.equal(g.__ask.calls.length, 0);
  });
});

describe("POST: the Speaking in pick", () => {
  it("passes a pick from the mic to the AI, null when typed, and refuses one off the list", async () => {
    const me = await person();
    assert.equal((await ask(me, "मुझे कितना प्रोटीन चाहिए", { spoken: "hinglish" })).status, 200);
    assert.equal(g.__ask.calls[0].spoken, "hinglish");
    assert.equal((await ask(me, "मुझे कितना प्रोटीन चाहिए")).status, 200);
    assert.equal(g.__ask.calls[1].spoken, null);
    const bad = await ask(me, "मुझे कितना प्रोटीन चाहिए", { spoken: "klingon" });
    assert.deepEqual([bad.status, bad.body.error], [400, "invalid"]);
    assert.equal(g.__ask.calls.length, 2);
  });
});

describe("POST: answers and the day's count", () => {
  it("answers with the saved turn and left 4; GET returns it; the AI saw no name, email or city", async () => {
    const me = await person({ name: "CANARY_NAME Rao" });
    const res = await ask(me, "How much protein today?");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(res.body).sort(), ["day", "kind", "left", "resetsAt", "turn"]);
    assert.equal(res.body.kind, "answer");
    assert.equal(res.body.left, 4);
    assert.equal(res.body.day, istDay());
    const turn = res.body.turn as { id: string; question: string; answer: string; links: { id: string; href: string }[]; stale: boolean; demo: boolean; removed: null };
    assert.equal(turn.question, "How much protein today?");
    assert.equal(turn.answer, "Add a bowl of dal to lunch.");
    assert.deepEqual(turn.links, [{ id: "log_meal", href: "/fuel" }], "the report link is dropped with no ready report");
    assert.equal(turn.stale, false);
    const input = g.__ask.calls[0];
    assert.equal(input.data.asksLeft, 4);
    assert.ok(input.data.plan, "the plan is in the data");
    const seen = JSON.stringify(input);
    for (const secret of ["CANARY_NAME", me.email, me.id]) assert.ok(!seen.includes(secret), `the AI never sees ${secret}`);
    const got = await thread(me);
    assert.equal(got.status, 200);
    assert.deepEqual((got.body.turns as { id: string }[]).map((t) => t.id), [turn.id]);
  });

  it("counts 5 a day: left runs 4, 3, 2, 1, 0, and the 6th is kind limit with no turn and no AI call", async () => {
    const me = await person();
    const lefts = [];
    for (let i = 0; i < 5; i++) lefts.push((await ask(me, `Question number ${i + 1}?`)).body.left);
    assert.deepEqual(lefts, [4, 3, 2, 1, 0]);
    const sixth = await ask(me, "One more?");
    assert.equal(sixth.status, 200);
    assert.deepEqual(sixth.body, { kind: "limit", turn: null, left: 0, day: istDay(), resetsAt: sixth.body.resetsAt });
    assert.equal(g.__ask.calls.length, 5);
    assert.equal((await turnsOf(me)).length, 5);
  });

  it("hands back failures with their codes, left unchanged, and counts the call", async () => {
    const me = await person();
    await ask(me, "first one?"); // left 4
    for (const [error, status] of [["refused", 422], ["failed", 502], ["timeout", 504], ["ai_off", 503]] as const) {
      g.__ask.answer = async () => ({ ok: false, error });
      const res = await ask(me, `fails as ${error}?`);
      assert.deepEqual([res.status, res.body.error, res.body.left], [status, error, 4], error);
      assert.equal(ASK_ERROR_STATUS[error], status);
    }
    assert.deepEqual(await counts(me), { used: 1, attempts: 5 });
    assert.equal((await turnsOf(me)).length, 1, "failed questions leave no turn");
  });

  it("answers 500 error, handed back, when the AI side throws", async () => {
    const me = await person();
    g.__ask.answer = async () => {
      throw new TypeError("boom");
    };
    const res = await ask(me);
    assert.deepEqual([res.status, res.body.error, res.body.left], [500, "error", 5]);
    assert.deepEqual(await counts(me), { used: 0, attempts: 1 });
    // A reply of a kind that doesn't exist is never saved.
    g.__ask.answer = async () => ({ ok: true, reply: { ...answerReply(), kind: "nonsense" }, usage });
    const stray = await ask(me);
    assert.deepEqual([stray.status, stray.body.error, stray.body.left], [500, "error", 5]);
    assert.equal((await turnsOf(me)).length, 0);
  });

  it("passes the 20 s deadline as a signal", async () => {
    const me = await person();
    const seen: { signal?: AbortSignal } = {};
    g.__ask.answer = async (_i, opts) => {
      seen.signal = opts.signal;
      return { ok: true, reply: answerReply(), usage };
    };
    await ask(me);
    assert.ok(seen.signal instanceof AbortSignal && !seen.signal.aborted);
  });

  it("answers too_many_tries after 10 model calls, and limit when 5 are used", async () => {
    const tried = await person();
    await setCounts(tried, 2, 10);
    const res = await ask(tried);
    assert.deepEqual([res.status, res.body.error, res.body.left], [429, "too_many_tries", 0]);
    const used = await person();
    await setCounts(used, 5, 7);
    assert.equal((await ask(used)).body.kind, "limit");
    assert.equal(g.__ask.calls.length, 0);
  });

  it("refuses a second question while one is in flight (busy), and the same key while it's pending", async () => {
    const me = await person();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    g.__ask.answer = async () => {
      entered();
      await gate;
      return { ok: true, reply: answerReply(), usage };
    };
    const key = crypto.randomUUID();
    signIn(me);
    const first = route.POST(postRequest(me, { clientKey: key, question: "slow one?" }));
    await inside;
    const other = await ask(me, "and another?");
    assert.deepEqual([other.status, other.body.error, other.body.left], [409, "busy", 4]);
    signIn(me);
    const same = await read(await route.POST(postRequest(me, { clientKey: key, question: "slow one?" })));
    assert.deepEqual([same.status, same.body.error], [409, "busy"]);
    release();
    assert.equal((await first).status, 200);
    assert.deepEqual(await counts(me), { used: 1, attempts: 1 }, "the busy ones counted nothing");
  });

  it("replays a repeated client key: the saved turn again, nothing counted, no second call", async () => {
    const me = await person();
    const key = crypto.randomUUID();
    signIn(me);
    const one = await read(await route.POST(postRequest(me, { clientKey: key, question: "Is curd good after a run?" })));
    signIn(me);
    const two = await read(await route.POST(postRequest(me, { clientKey: key.toUpperCase(), question: "Is curd good after a run?" })));
    assert.equal(two.status, 200);
    assert.deepEqual((two.body.turn as { id: string }).id, (one.body.turn as { id: string }).id);
    assert.equal(two.body.left, 4);
    assert.equal(g.__ask.calls.length, 1);
    assert.deepEqual(await counts(me), { used: 1, attempts: 1 });
  });

  it("hands back a question whose report was deleted mid-answer (409 report_deleted)", async () => {
    const me = await person();
    await readyReport(me);
    g.__ask.answer = async () => {
      await deleteReports(me.id, "all");
      return { ok: true, reply: answerReply(), usage };
    };
    const res = await ask(me, "What does my vitamin D mean?");
    assert.deepEqual([res.status, res.body.error, res.body.left], [409, "report_deleted", 5]);
    assert.equal((await turnsOf(me)).length, 0);
    assert.deepEqual(await counts(me), { used: 0, attempts: 1 });
  });

  it("gives back the question when the model's reply is urgent, and counts off-topic", async () => {
    const me = await person();
    g.__ask.answer = async () => ({
      ok: true,
      reply: { kind: "urgent", answer: null, notice: { level: "urgent", label: "Get advice today", parts: ["symptom"], lines: ["See a doctor today."], markers: [], calls: ["112"] }, links: [], lang: "en", floorRaised: true, filter: null },
      usage,
    });
    const urgent = await ask(me, "My chest hurts when I run, what should I eat?");
    assert.deepEqual([urgent.status, urgent.body.kind, urgent.body.left], [200, "urgent", 5]);
    g.__ask.answer = async () => ({ ok: true, reply: { kind: "off_topic", answer: "Ask covers food, training and health.", notice: null, links: [], lang: "en", floorRaised: false, filter: null }, usage });
    const off = await ask(me, "Who wins the cricket?");
    assert.deepEqual([off.body.kind, off.body.left], ["off_topic", 4]);
  });
});

describe("POST: code's own replies come before every switch", () => {
  afterEach(() => {
    process.env.D_HUMAN_AI_MOCK = "1";
    delete process.env.ASK_DAILY_MAX;
  });

  it("answers a crisis while Ask is off, paused and at the limit: free, no model call", async () => {
    g.__ask.pre = () => crisisReply;
    const off = await person();
    delete process.env.D_HUMAN_AI_MOCK;
    const r1 = await ask(off, "I want to end my life");
    assert.deepEqual([r1.status, r1.body.kind, r1.body.left], [200, "crisis", 5]);
    process.env.D_HUMAN_AI_MOCK = "1";

    const paused = await person();
    process.env.ASK_DAILY_MAX = "1";
    await setEveryone(1);
    assert.equal((await ask(paused, "I want to end my life")).body.kind, "crisis");

    const usedUp = await person();
    await setCounts(usedUp, 5, 5);
    const r3 = await ask(usedUp, "I want to end my life");
    assert.deepEqual([r3.body.kind, r3.body.left], ["crisis", 0]);
    const t = r3.body.turn as { answer: null; notice: { calls: string[] } };
    assert.equal(t.answer, null);
    assert.deepEqual(t.notice.calls, ["14416", "112"]);
    assert.equal(g.__ask.calls.length, 0);
    assert.deepEqual(await counts(usedUp), { used: 5, attempts: 5 });
    const saved = await turnsOf(usedUp);
    assert.deepEqual(saved.map((x) => [x.kind, x.counted]), [["crisis", false]]);
  });

  it("answers ai_off when there's no AI, or ASK_DAILY_MAX is 0", async () => {
    const me = await person();
    delete process.env.D_HUMAN_AI_MOCK;
    const r = await ask(me);
    assert.deepEqual([r.status, r.body.error, r.body.left], [503, "ai_off", 5]);
    process.env.D_HUMAN_AI_MOCK = "1";
    process.env.ASK_DAILY_MAX = "0";
    assert.equal((await ask(me)).body.error, "ai_off");
    assert.deepEqual(await counts(me), { used: 0, attempts: 0 });
  });

  it("answers paused at the breaker, keeps the person's count, and emails the founders once a day", async () => {
    g.__alerts = [];
    process.env.ASK_DAILY_MAX = "3";
    await setEveryone(3);
    const a = await person();
    const b = await person();
    const ra = await ask(a);
    assert.deepEqual([ra.status, ra.body.error, ra.body.left], [503, "paused", 5]);
    await runAfters();
    await ask(b);
    await runAfters();
    assert.equal(g.__alerts.length, 1, "one cap email a day");
    assert.match(g.__alerts[0].subject, /limit/);
    assert.deepEqual(await counts(a), { used: 0, attempts: 0 });
    const d = await db();
    assert.equal((await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, `alert:ask-cap:${istDay()}`))).length, 1);
    const got = await thread(a);
    assert.equal(got.body.state, "paused");
  });

  it("emails the founders once when the day's calls reach 80%", async () => {
    g.__alerts = [];
    process.env.ASK_DAILY_MAX = "100";
    await setEveryone(78);
    const me = await person();
    await ask(me, "first?"); // 79
    await runAfters();
    assert.equal(g.__alerts.length, 0);
    await ask(me, "second?"); // 80
    await runAfters();
    await ask(me, "third?"); // 81
    await runAfters();
    assert.equal(g.__alerts.length, 1);
    assert.match(g.__alerts[0].text, /80 model calls/);
    assert.match(g.__alerts[0].text, /ASK_DAILY_MAX/);
  });
});

describe("two people", () => {
  it("never see each other's thread, turn or data; another's client key is a new question", async () => {
    const a = await person({ medications: "CANARY_A_MED" });
    const b = await person();
    const reportA = await readyReport(a, { markers: [{ key: "ferritin", name: "CANARY_A_MARKER", status: "low" }] });
    const d = await db();
    await d.insert(schema.foodLogs).values({ id: crypto.randomUUID(), userId: a.id, localDate: istDay(), meal: "lunch", source: "text", title: "CANARY_A_MEAL", items: [], kcal: 500, proteinG: 20, carbsG: 60, fatG: 15, fibreG: 5, micros: {} });
    const key = crypto.randomUUID();
    signIn(a);
    const fromA = await read(await route.POST(postRequest(a, { clientKey: key, question: "CANARY_A_QUESTION about iron?" })));
    assert.equal(fromA.status, 200);
    const inputA = JSON.stringify(g.__ask.calls[0]);
    assert.ok(inputA.includes("CANARY_A_MEAL") && inputA.includes("CANARY_A_MED"), "A's own data reaches A's answer");
    assert.ok(!inputA.includes("CANARY_READ_TEXT"), "never the read's words");

    signIn(b);
    const fromB = await read(await route.POST(postRequest(b, { clientKey: key, question: "What about my iron?", about: { type: "marker", id: (await d.select({ id: schema.markers.id }).from(schema.markers).where(eq(schema.markers.reportId, reportA)))[0].id } })));
    assert.equal(fromB.status, 200);
    assert.notEqual((fromB.body.turn as { id: string }).id, (fromA.body.turn as { id: string }).id, "B's question is B's own");
    const inputB = g.__ask.calls[1];
    assert.equal(inputB.about, null, "A's marker id is ignored for B");
    assert.ok(!JSON.stringify(inputB).includes("CANARY_A"), "nothing of A's reaches B's call");
    const gotB = await thread(b);
    assert.ok(!JSON.stringify(gotB.body).includes("CANARY_A"));
    assert.equal((gotB.body.turns as unknown[]).length, 1);

    // DELETE as B leaves A's.
    signIn(b);
    const cleared = await read(await route.DELETE(new Request(`${ORIGIN}/api/ask`, { method: "DELETE", headers: { origin: ORIGIN } })));
    assert.deepEqual(cleared.body, { cleared: 1, left: 4 });
    assert.equal((await turnsOf(a)).length, 1);
  });

  it("resolves Ask about this in the person's own data only", async () => {
    const me = await person();
    const reportId = await readyReport(me, { markers: [{ key: "ferritin", name: "FERRITIN (SERUM)", status: "low" }] });
    const d = await db();
    const [m] = await d.select({ id: schema.markers.id }).from(schema.markers).where(eq(schema.markers.reportId, reportId));
    await ask(me, "What does this mean?", { about: { type: "marker", id: m.id } });
    assert.deepEqual(g.__ask.calls[0].about, { type: "marker", key: "ferritin", name: "Ferritin" });
    await ask(me, "Why this?", { about: { type: "stack_item", nutrient: "Iron" } });
    assert.equal(g.__ask.calls[1].about, null, "no current stack, so the item is ignored");
    await ask(me, "And this meal?", { about: { type: "meal", id: "no-such-meal" } });
    assert.equal(g.__ask.calls[2].about, null);
  });
});

describe("logs", () => {
  it("never carry the question, the person's data or the answer, on any path", async () => {
    const lines: string[] = [];
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const saved = methods.map((m) => console[m]);
    for (const m of methods) console[m] = (...args: unknown[]) => void lines.push(args.map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    try {
      const me = await person({ medications: "CANARY_LOG_MED", name: "CANARY_LOG_NAME" });
      await readyReport(me, { markers: [{ key: "vitamin_d", name: "CANARY_LOG_MARKER", status: "low" }] });
      const q = "CANARY_LOG question about vitamin D?";
      g.__ask.answer = async () => ({ ok: true, reply: answerReply("CANARY_LOG answer text."), usage });
      await ask(me, q);
      g.__ask.answer = async () => ({ ok: true, reply: { ...answerReply("CANARY_LOG filtered."), kind: "doctor", answer: null, notice: { level: "doctor", label: "Doctor first", parts: ["dose"], lines: ["x"], markers: [], calls: [] }, filter: "dose" } as AskReply, usage });
      await ask(me, q);
      g.__ask.answer = async () => ({ ok: false, error: "refused" });
      await ask(me, q);
      g.__ask.answer = async () => {
        throw new Error(`CANARY_LOG in an error message: ${q}`);
      };
      await ask(me, q);
      g.__ask.pre = () => crisisReply;
      await ask(me, q);
      await thread(me);
      // A failed query's message holds its parameters: the route logs the class only.
      g.__ask.pre = () => null;
      g.__ask.answer = async () => ({ ok: true, reply: { ...answerReply("CANARY_LOG"), kind: "nonsense" } as unknown as AskReply, usage });
      await ask(me, q);
    } finally {
      methods.forEach((m, i) => (console[m] = saved[i]));
    }
    assert.ok(lines.some((l) => l.startsWith("[ask] kind=answer counted=1")), lines.join("\n"));
    assert.ok(lines.some((l) => l.includes("filter=dose")));
    for (const line of lines) assert.ok(!line.includes("CANARY_LOG"), `leaked: ${line}`);
  });
});

describe("GET /api/ask", () => {
  it("is no-store, signed in only, gated, and never 409 for the notice", async () => {
    signIn(null);
    assert.equal((await read(await route.GET())).status, 401);
    const stranger = await person({ founder: false });
    assert.deepEqual([(await thread(stranger)).status, (await thread(stranger)).body.error], [403, "not_allowed"]);
    const notYet = await person({ askConsent: false });
    const res = await thread(notYet);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.body.consentNeeded, true);
    assert.equal(res.body.state, "ready");
    assert.equal(res.body.report, "none");
    assert.equal(res.body.region, "in");
  });

  it("marks turns asked before a newer report or stack as stale", async () => {
    const me = await person();
    await ask(me, "before anything?");
    let got = await thread(me);
    assert.equal((got.body.turns as { stale: boolean }[])[0].stale, false);
    await readyReport(me, { analyzedAt: new Date(Date.now() + 1000) });
    got = await thread(me);
    assert.equal((got.body.turns as { stale: boolean }[])[0].stale, true);
    assert.equal(got.body.report, "ready");
  });

  it("shows a question in flight under 45 s as pending, and hides a dead one", async () => {
    const me = await person();
    const c = await claimAsk({ userId: me.id, clientKey: crypto.randomUUID(), day: istDay(), question: "still thinking?", reportId: null, max: 1e6 });
    assert.ok(c.ok);
    let got = await thread(me);
    assert.equal((got.body.pending as { question: string }).question, "still thinking?");
    assert.deepEqual(got.body.turns, []);
    const d = await db();
    await d.update(schema.askTurns).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(schema.askTurns.id, c.turnId));
    got = await thread(me);
    assert.equal(got.body.pending, null);
  });

  it("pins urgent markers and a report printed for someone else, and picks starter facts", async () => {
    const me = await person({ name: "Asha Rao" });
    await readyReport(me, {
      nameOnReport: "Ravi Kumar",
      markers: [
        { key: "hemoglobin", name: "HAEMOGLOBIN", status: "low", flag: "urgent", value: 6.1 },
        { key: "vitamin_d", name: "Vit D", status: "low" },
        { key: "ferritin", name: "Ferritin", status: "edge_low" },
      ],
    });
    const got = await thread(me);
    assert.deepEqual(got.body.pinned, { urgent: ["Haemoglobin"], printedFor: "Ravi Kumar" });
    const s = got.body.starters as Record<string, unknown>;
    assert.equal(s.archetype, "running");
    assert.deepEqual(s.flagged, { name: "Haemoglobin" });
    assert.deepEqual(s.foodMarker, { name: "Ferritin" }, "the runner's first priority that's low or at the edge and not flagged");
    assert.equal(s.mealsToday, 0);
    assert.equal(s.mealsEver, false);
    assert.equal(s.stackItem, null);
    assert.ok(typeof s.proteinLeftG === "number" && (s.proteinLeftG as number) % 5 === 0);
  });

  it("says left 0 after 10 failed calls, and off without AI", async () => {
    const me = await person();
    await setCounts(me, 0, 10);
    assert.equal((await thread(me)).body.left, 0);
    delete process.env.D_HUMAN_AI_MOCK;
    assert.equal((await thread(me)).body.state, "off");
    process.env.D_HUMAN_AI_MOCK = "1";
  });

  it("says region other for a time zone outside India, and the read language", async () => {
    const me = await person({ timezone: "Europe/London" });
    const d = await db();
    await d.update(schema.profiles).set({ language: "hinglish" }).where(eq(schema.profiles.userId, me.id));
    const got = await thread(me);
    assert.equal(got.body.region, "other");
    assert.equal(got.body.readLanguage, "hinglish");
  });
});

describe("DELETE /api/ask and POST /api/ask/consent", () => {
  it("DELETE needs our Origin and a session, clears answered turns, keeps one in flight and the count", async () => {
    const me = await person();
    signIn(me);
    assert.equal((await read(await route.DELETE(new Request(`${ORIGIN}/api/ask`, { method: "DELETE", headers: { origin: "https://evil.example" } })))).status, 403);
    signIn(null);
    assert.equal((await read(await route.DELETE(new Request(`${ORIGIN}/api/ask`, { method: "DELETE", headers: { origin: ORIGIN } })))).status, 401);
    await ask(me, "one?");
    await ask(me, "two?");
    await claimAsk({ userId: me.id, clientKey: crypto.randomUUID(), day: istDay(), question: "in flight?", reportId: null, max: 1e6 });
    signIn(me);
    const res = await read(await route.DELETE(new Request(`${ORIGIN}/api/ask`, { method: "DELETE", headers: { origin: ORIGIN } })));
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(res.body, { cleared: 2, left: 2 });
    assert.deepEqual((await turnsOf(me)).map((t) => t.status), ["pending"]);
  });

  it("consent needs our Origin and a session, sets the moment once, and opens Ask", async () => {
    const me = await person({ askConsent: false });
    signIn(me);
    const foreign = await read(await consentRoute.POST(postRequest(me, "", { origin: "https://evil.example" }, "/api/ask/consent")));
    assert.deepEqual([foreign.status, foreign.body.error], [403, "bad_origin"]);
    const first = await read(await consentRoute.POST(postRequest(me, "", {}, "/api/ask/consent")));
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-store");
    const again = await read(await consentRoute.POST(postRequest(me, "", {}, "/api/ask/consent")));
    assert.equal(again.body.consentAt, first.body.consentAt, "repeating changes nothing");
    assert.equal((await ask(me)).status, 200);
    const stranger = await person({ founder: false, askConsent: false });
    signIn(stranger);
    assert.equal((await read(await consentRoute.POST(postRequest(stranger, "", {}, "/api/ask/consent")))).body.error, "not_allowed");
    signIn(null);
    assert.equal((await read(await consentRoute.POST(postRequest(null, "", {}, "/api/ask/consent")))).status, 401);
  });
});

