// The Ask sheet's state (components/platform/ask-state.ts) and its calls (ask-api.ts), with
// no browser: sending, answers, the limit, the timeout check over GET, a retry that keeps
// its key, a new day, clearing, consent, paused and off. A fake send() plays the server.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const St = await import("../components/platform/ask-state.ts");
const Api = await import("../components/platform/ask-api.ts");
const { ASK_LIMITS } = await import("../lib/ask/types.ts");
type AskThread = import("../lib/ask/types.ts").AskThread;
type AskTurn = import("../lib/ask/types.ts").AskTurn;
type AskState = import("../components/platform/ask-state.ts").AskState;
type AskAction = import("../components/platform/ask-state.ts").AskAction;
type Send = import("../components/platform/ask-api.ts").Send;

const DAY = "2026-11-19";
const RESETS = "2026-11-19T18:30:00.000Z";
const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";

const turn = (over: Partial<AskTurn> = {}): AskTurn => ({
  id: "t1",
  clientKey: KEY_A,
  question: "What should I eat before a run?",
  at: "2026-11-19T10:00:00.000Z",
  kind: "answer",
  answer: "A banana and some curd, an hour before.",
  notice: null,
  links: [{ id: "log_meal", href: "/fuel" }],
  lang: "en",
  removed: null,
  stale: false,
  demo: false,
  ...over,
});

const thread = (over: Partial<AskThread> = {}): AskThread => ({
  turns: [],
  pending: null,
  left: 5,
  day: DAY,
  resetsAt: RESETS,
  state: "ready",
  consentNeeded: false,
  pinned: { urgent: [], printedFor: null },
  report: "ready",
  region: "in",
  readLanguage: "en",
  starters: { archetype: "running", flagged: null, foodMarker: null, proteinLeftG: null, mealsToday: 0, mealsEver: true, hasGaps: false, stackItem: null },
  ...over,
});

const run = (s: AskState, ...actions: AskAction[]) => actions.reduce(St.askReducer, s);
const q = (question = "What should I eat before a run?", clientKey = KEY_A) => ({ clientKey, question, about: null });
const loaded = (over: Partial<AskThread> = {}) => run(St.initialAskState(), { type: "load" }, { type: "loaded", thread: thread(over) });
const typed = (s: AskState, text: string) => run(s, { type: "type", text });

describe("sending and answers", () => {
  it("sends: the box clears, the question shows as in flight, and Send waits", () => {
    let s = typed(loaded(), "What should I eat before a run?");
    assert.equal(St.canSend(s), true);
    s = run(s, { type: "send", question: q(), at: 1 });
    assert.equal(s.draft.text, "");
    assert.equal(s.sending?.clientKey, KEY_A);
    assert.equal(St.canSend(typed(s, "And for dinner?")), false, "one question in flight");
  });

  it("an answer joins the thread, the counter moves, and it's marked to read out", () => {
    let s = run(typed(loaded(), "x y"), { type: "send", question: q("x y"), at: 1 });
    s = run(s, { type: "settled", question: q("x y"), outcome: { type: "ok", reply: { kind: "answer", turn: turn({ question: "x y" }), left: 4, day: DAY, resetsAt: RESETS } } });
    assert.equal(s.sending, null);
    assert.equal(s.turns.length, 1);
    assert.equal(s.left, 4);
    assert.equal(s.landed, "t1");
    assert.equal(s.error, null);
  });

  it("the same answer twice (a replayed key) shows once", () => {
    const reply = { kind: "answer" as const, turn: turn(), left: 4, day: DAY, resetsAt: RESETS };
    const s = run(loaded(), { type: "settled", question: q(), outcome: { type: "ok", reply } }, { type: "settled", question: q(), outcome: { type: "ok", reply } });
    assert.equal(s.turns.length, 1);
  });

  it("needs two to 300 characters, counted as people count them", () => {
    assert.equal(St.canSend(typed(loaded(), "a")), false);
    assert.equal(St.canSend(typed(loaded(), "  ab  ")), true);
    assert.equal(St.canSend(typed(loaded(), "क".repeat(300))), true);
    assert.equal(St.canSend(typed(loaded(), "x".repeat(301))), false);
    assert.equal(St.charCount("😀😀"), 2);
  });

  it("makes v4 keys", () => {
    const k = St.newKey();
    assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(St.newKey(), k);
  });
});

describe("the limit", () => {
  it("at none left, Send stops; starters and the box's find-only mode follow from left = 0", () => {
    const s = typed(loaded({ left: 0 }), "how do I pay");
    assert.equal(s.left, 0);
    assert.equal(St.canSend(s), false);
  });

  it("a limit on send (another device used the last one): nothing saved, the question back in the box", () => {
    let s = run(typed(loaded({ left: 1 }), "What about dinner?"), { type: "send", question: q("What about dinner?"), at: 1 });
    s = run(s, { type: "settled", question: q("What about dinner?"), outcome: { type: "ok", reply: { kind: "limit", turn: null, left: 0, day: DAY, resetsAt: RESETS } } });
    assert.equal(s.turns.length, 0);
    assert.equal(s.left, 0);
    assert.equal(s.draft.text, "What about dinner?");
    assert.equal(s.error, null);
  });
});

describe("failures hand the question back, and retries keep their key", () => {
  it("a server error: the question goes back in the box, with Try again on the same key", () => {
    let s = run(typed(loaded(), "x y"), { type: "send", question: q("x y"), at: 1 });
    s = run(s, { type: "settled", question: q("x y"), outcome: { type: "error", error: "failed", body: { error: "failed", left: 5, day: DAY, resetsAt: RESETS } } });
    assert.equal(s.draft.text, "x y");
    assert.equal(s.error?.code, "failed");
    assert.equal(s.error?.retry?.clientKey, KEY_A);
    assert.equal(s.left, 5, "a failure never lowers the count");
    // Sending the same words from the box reuses the key; new words get a new one.
    assert.equal(St.questionFor(s.draft, s.handedBack, null, () => KEY_B).clientKey, KEY_A);
    assert.equal(St.questionFor({ text: "something else", about: null }, s.handedBack, null, () => KEY_B).clientKey, KEY_B);
  });

  it("offline: back in the box, no Try again button, and the box's own Ask reuses the key", () => {
    let s = run(typed(loaded(), "x y"), { type: "send", question: q("x y"), at: 1 });
    s = run(s, { type: "settled", question: q("x y"), outcome: { type: "offline" } });
    assert.equal(s.error?.code, "offline");
    assert.equal(s.error?.retry, null);
    assert.equal(St.questionFor(s.draft, s.handedBack, null, () => KEY_B).clientKey, KEY_A);
  });

  it("dictated in हिंदी, sent offline, sent again from the box: the same key and the same pick (QA, 2026-11-22)", () => {
    // The mic heard the words in हिंदी; the box emptied on send, so the mic now says nothing.
    const sent = St.questionFor({ text: "x y", about: null }, null, "hi", () => KEY_A);
    assert.deepEqual(sent, { clientKey: KEY_A, question: "x y", about: null, spoken: "hi" });
    let s = run(typed(loaded(), "x y"), { type: "send", question: sent, at: 1 });
    s = run(s, { type: "settled", question: sent, outcome: { type: "offline" } });
    assert.equal(s.draft.text, "x y");
    assert.deepEqual(St.questionFor(s.draft, s.handedBack, null, () => KEY_B), sent);
    // Edited words are a new question, with whatever the mic heard them in.
    assert.deepEqual(St.questionFor({ text: "x y z", about: null }, s.handedBack, null, () => KEY_B), { clientKey: KEY_B, question: "x y z", about: null });
    assert.deepEqual(St.questionFor({ text: "x y z", about: null }, s.handedBack, "hinglish", () => KEY_B), { clientKey: KEY_B, question: "x y z", about: null, spoken: "hinglish" });
  });

  it("typed and handed back: sent again with no pick", () => {
    let s = run(typed(loaded(), "x y"), { type: "send", question: q("x y"), at: 1 });
    s = run(s, { type: "settled", question: q("x y"), outcome: { type: "offline" } });
    assert.equal("spoken" in St.questionFor(s.draft, s.handedBack, null, () => KEY_B), false);
  });

  it("a timeout offers Try again on the same key", () => {
    let s = run(typed(loaded(), "x y"), { type: "send", question: q("x y"), at: 1 });
    s = run(s, { type: "settled", question: q("x y"), outcome: { type: "timeout", thread: null } });
    assert.equal(s.error?.code, "timeout");
    assert.equal(s.error?.retry?.clientKey, KEY_A);
  });

  it("a timeout that GET found landed shows the answer, with no error", () => {
    let s = run(typed(loaded(), "x y"), { type: "send", question: q("x y"), at: 1 });
    const t = turn({ question: "x y" });
    s = run(s, { type: "settled", question: q("x y"), outcome: { type: "landed", turn: t, thread: thread({ turns: [t], left: 4 }) } });
    assert.equal(s.turns.length, 1);
    assert.equal(s.error, null);
    assert.equal(s.left, 4);
    assert.equal(s.draft.text, "");
  });

  it("refused and busy: plain words, no Try again", () => {
    for (const code of ["refused", "busy", "rate_limited", "too_many_tries", "paused", "ai_off", "report_deleted"] as const) {
      const s = run(loaded(), { type: "send", question: q(), at: 1 }, { type: "settled", question: q(), outcome: { type: "error", error: code, body: { error: code } } });
      assert.equal(s.error?.code, code);
      assert.equal(s.error?.retry, null, code);
    }
    assert.equal(St.refetchAfter("busy"), true);
    assert.equal(St.refetchAfter("report_deleted"), true);
    assert.equal(St.refetchAfter("failed"), false);
  });

  it("new typing during the wait isn't overwritten when the old question comes back", () => {
    let s = run(typed(loaded(), "first one"), { type: "send", question: q("first one"), at: 1 });
    s = typed(s, "second one");
    s = run(s, { type: "settled", question: q("first one"), outcome: { type: "offline" } });
    assert.equal(s.draft.text, "second one");
    // "Try again" from the error line sends the old one and leaves the new typing alone.
    s = run(s, { type: "send", question: q("first one"), at: 2 });
    assert.equal(s.draft.text, "second one");
  });
});

describe("the day, clearing, consent and the server's state", () => {
  it("a new day in any reply drops yesterday's turns from view", () => {
    let s = loaded({ turns: [turn()], left: 4 });
    s = run(s, { type: "settled", question: q("x y", KEY_B), outcome: { type: "ok", reply: { kind: "answer", turn: turn({ id: "t2", clientKey: KEY_B }), left: 4, day: "2026-11-20", resetsAt: "2026-11-20T18:30:00.000Z" } } });
    assert.deepEqual(s.turns.map((t) => t.id), ["t2"]);
    assert.equal(s.day, "2026-11-20");
    const viaError = run(loaded({ turns: [turn()] }), { type: "settled", question: q(), outcome: { type: "error", error: "failed", body: { error: "failed", day: "2026-11-20" } } });
    assert.equal(viaError.turns.length, 0);
  });

  it("a GET that started before an answer landed doesn't take the answer away", () => {
    let s = run(loaded(), { type: "send", question: q(), at: 1 }, { type: "load" });
    s = run(s, { type: "settled", question: q(), outcome: { type: "ok", reply: { kind: "answer", turn: turn(), left: 4, day: DAY, resetsAt: RESETS } } });
    s = run(s, { type: "loaded", thread: thread({ turns: [], left: 5 }) });
    assert.equal(s.turns.length, 1, "the older GET's empty list is ignored");
    s = run(s, { type: "load" }, { type: "loaded", thread: thread({ turns: [turn(), turn({ id: "t2", clientKey: KEY_B })] }) });
    assert.equal(s.turns.length, 2, "a fresh GET is taken as it is");
  });

  it("clear: the thread empties, used questions still count, and an older GET can't bring it back", () => {
    let s = run(loaded({ turns: [turn()], left: 4 }), { type: "load" }, { type: "cleared", left: 4 });
    assert.equal(s.turns.length, 0);
    assert.equal(s.left, 4);
    assert.equal(s.status, "cleared");
    s = run(s, { type: "loaded", thread: thread({ turns: [turn()], left: 4 }) });
    assert.equal(s.turns.length, 0);
    assert.equal(run(loaded(), { type: "clear_failed" }).status, "clear_failed");
  });

  it("consent: the notice until Got it, and a 409 brings it back with the question kept", () => {
    let s = loaded({ consentNeeded: true });
    assert.equal(s.consentNeeded, true);
    assert.equal(St.canSend(typed(s, "x y")), false);
    s = run(s, { type: "consented" });
    assert.equal(s.consentNeeded, false);
    s = run(typed(s, "x y"), { type: "send", question: q("x y"), at: 1 }, { type: "settled", question: q("x y"), outcome: { type: "error", error: "consent_needed", body: { error: "consent_needed" } } });
    assert.equal(s.consentNeeded, true);
    assert.equal(s.error, null);
    assert.equal(s.draft.text, "x y");
    assert.equal(run(loaded({ consentNeeded: true }), { type: "consent_failed" }).status, "consent_failed");
  });

  it("paused and off are facts from GET; the box still sends, for crisis replies", () => {
    for (const state of ["paused", "off"] as const) {
      const s = typed(loaded({ state }), "x y");
      assert.equal(s.facts?.state, state);
      assert.equal(St.canSend(s), true);
    }
  });

  it("a question in flight from elsewhere holds Send until it lands", () => {
    const s = typed(loaded({ pending: { clientKey: KEY_B, question: "from my phone", at: "2026-11-19T10:00:00.000Z" } }), "x y");
    assert.equal(s.elsewhere?.clientKey, KEY_B);
    assert.equal(St.canSend(s), false);
  });

  it("signed out on load says so; other load failures keep asking possible", () => {
    assert.equal(run(St.initialAskState(), { type: "load" }, { type: "load_failed", error: "signed_out" }).error?.code, "signed_out");
    const s = run(St.initialAskState(), { type: "load" }, { type: "load_failed", error: "offline" });
    assert.equal(s.load, "failed");
    assert.equal(s.error, null);
  });

  it("a prefill replaces the box and sets the chip; it never sends", () => {
    const about = { request: { type: "stack_item" as const, nutrient: "Magnesium" }, name: "Magnesium", status: null };
    const s = run(typed(loaded(), "old words"), { type: "prefill", text: "Why is Magnesium in my stack?", about });
    assert.equal(s.draft.text, "Why is Magnesium in my stack?");
    assert.deepEqual(s.draft.about, about);
    assert.equal(s.sending, null);
    assert.equal(run(s, { type: "drop_about" }).draft.about, null);
  });
});

// ── The wire ───────────────────────────────────────────────────────────────

type Call = { url: string; method: string; body: unknown };
function fakeServer(script: ((c: Call, i: number) => { ok: boolean; status: number; offline: boolean; data: unknown } | Promise<never>)[]) {
  const calls: Call[] = [];
  let clock = 0;
  const send = (async (url: string, o: { method?: string; body?: unknown } = {}) => {
    const c = { url, method: o.method ?? "POST", body: o.body };
    calls.push(c);
    const step = script[calls.length - 1];
    if (!step) throw new Error(`unexpected call ${calls.length}: ${c.method} ${url}`);
    return step(c, calls.length - 1);
  }) as unknown as Send;
  const deps = { send, now: () => clock, sleep: async (ms: number) => void (clock += ms) };
  return { calls, deps, advance: (ms: number) => void (clock += ms) };
}
const ok = (data: unknown) => () => ({ ok: true, status: 200, offline: false, data });
const fail = (status: number, data: unknown) => () => ({ ok: false, status, offline: false, data });

describe("askQuestion over HTTP", () => {
  const req = { clientKey: KEY_A, question: "x y" };
  const post = { kind: "answer", turn: turn(), left: 4, day: DAY, resetsAt: RESETS };

  it("posts once and returns the answer, cleaned", async () => {
    const f = fakeServer([ok(post)]);
    const out = await Api.askQuestion(req, f.deps);
    assert.equal(out.type, "ok");
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].body, req);
  });

  it("an error keys on `error`, never the status, and keeps the day fields", async () => {
    const f = fakeServer([fail(429, { error: "too_many_tries", left: 0, day: DAY, resetsAt: RESETS })]);
    const out = await Api.askQuestion(req, f.deps);
    assert.deepEqual(out, { type: "error", error: "too_many_tries", body: { error: "too_many_tries", left: 0, day: DAY, resetsAt: RESETS } });
    const odd = await Api.askQuestion(req, fakeServer([fail(500, { error: "<script>" })]).deps);
    assert.equal(odd.type === "error" && odd.error, "error", "an unknown code is a plain error");
  });

  const drop = () => ({ ok: false, status: 0, offline: true, data: {} });

  it("a quick drop is resent once, 1 s later, with the same key and words, and asks for the whole answer", async () => {
    const f = fakeServer([drop, ok(post)]);
    const opts: unknown[] = [];
    const send = f.deps.send;
    const out = await Api.askQuestion(req, {
      ...f.deps,
      send: ((url: string, o: unknown) => (opts.push(o), send(url, o as never))) as Send,
    });
    assert.equal(out.type, "ok");
    assert.deepEqual(f.calls.map((c) => c.method), ["POST", "POST"]);
    assert.deepEqual(f.calls[1].body, f.calls[0].body);
    assert.deepEqual(f.calls[1].body, req, "the same clientKey");
    assert.ok(opts.every((o) => (o as { wholeAnswer?: boolean }).wholeAnswer === true), "an answer cut off on the way counts as a drop");
  });

  it("two quick drops are offline: two POSTs, no GET, nothing more", async () => {
    const f = fakeServer([drop, drop]);
    assert.deepEqual(await Api.askQuestion(req, f.deps), { type: "offline" });
    assert.deepEqual(f.calls.map((c) => c.method), ["POST", "POST"]);
  });

  it("never resends after an HTTP answer", async () => {
    for (const status of [400, 409, 429, 500, 502, 503, 504]) {
      const f = fakeServer([fail(status, { error: "failed" })]);
      assert.equal((await Api.askQuestion(req, f.deps)).type, "error");
      assert.equal(f.calls.length, 1, `one POST for ${status}`);
    }
  });

  it("a drop, then an HTTP refusal on the resend: that answer, and no third send", async () => {
    const f = fakeServer([drop, fail(429, { error: "too_many_tries", left: 0, day: DAY, resetsAt: RESETS })]);
    const out = await Api.askQuestion(req, f.deps);
    assert.equal(out.type === "error" && out.error, "too_many_tries");
    assert.deepEqual(f.calls.map((c) => c.method), ["POST", "POST"]);
  });

  it("a drop, then busy on the resend (the first send still being answered): GET waits for it and shows it", async () => {
    const pending = thread({ pending: { clientKey: KEY_A, question: "x y", at: "2026-11-19T10:00:00.000Z" } });
    const f = fakeServer([drop, fail(409, { error: "busy", left: 4, day: DAY, resetsAt: RESETS }), ok(pending), ok(thread({ turns: [turn()], left: 4 }))]);
    const out = await Api.askQuestion(req, f.deps);
    assert.equal(out.type, "landed");
    assert.deepEqual(f.calls.map((c) => c.method), ["POST", "POST", "GET", "GET"], "never a third POST");
  });

  it("a drop, then a server error on the resend: GET finds the first send answered, and shows it", async () => {
    const f = fakeServer([drop, fail(500, { error: "error" }), ok(thread({ turns: [turn()], left: 4 }))]);
    const out = await Api.askQuestion(req, f.deps);
    assert.equal(out.type, "landed");
  });

  it("a drop, then a server error, and GET has no such question: the error, which truly didn't count", async () => {
    const f = fakeServer([drop, fail(500, { error: "error" }), ok(thread())]);
    const out = await Api.askQuestion(req, f.deps);
    assert.equal(out.type === "error" && out.error, "error");
    assert.deepEqual(f.calls.map((c) => c.method), ["POST", "POST", "GET"]);
  });

  it("says words for offline that hold whether or not the question reached us", async () => {
    const { ASK_ERROR_WORDS } = await import("../components/platform/ask-copy.ts");
    assert.doesNotMatch(ASK_ERROR_WORDS.offline, /didn't count/i, "only the answer may have been lost");
    assert.match(ASK_ERROR_WORDS.offline, /won't count twice/);
    assert.match(ASK_ERROR_WORDS.offline, /still here/);
  });

  it("a wait that ran out with no GET getting through is offline, not a timeout that claims it didn't count", async () => {
    const f = fakeServer([
      () => {
        f.advance(ASK_LIMITS.clientTimeoutMs);
        return drop();
      },
      ...Array.from({ length: 30 }, () => drop),
    ]);
    assert.deepEqual(await Api.askQuestion(req, f.deps), { type: "offline" });
    assert.equal(f.calls.filter((c) => c.method === "POST").length, 1, "a whole wait is never resent");
  });

  it("after 24 s with no reply, GET looks for the key: found answered", async () => {
    const f = fakeServer([
      () => {
        f.advance(ASK_LIMITS.clientTimeoutMs);
        return { ok: false, status: 0, offline: true, data: {} };
      },
      ok(thread({ turns: [turn()], left: 4 })),
    ]);
    const out = await Api.askQuestion(req, f.deps);
    assert.equal(out.type, "landed");
    assert.deepEqual(f.calls.map((c) => c.method), ["POST", "GET"], "no second POST");
  });

  it("while it's still pending, GET again every 2 s until it lands", async () => {
    const pending = thread({ pending: { clientKey: KEY_A, question: "x y", at: "2026-11-19T10:00:00.000Z" } });
    const f = fakeServer([
      () => {
        f.advance(ASK_LIMITS.clientTimeoutMs);
        return { ok: false, status: 0, offline: true, data: {} };
      },
      ok(pending),
      ok(pending),
      ok(thread({ turns: [turn()], left: 4 })),
    ]);
    const out = await Api.askQuestion(req, f.deps);
    assert.equal(out.type, "landed");
    assert.deepEqual(f.calls.map((c) => c.method), ["POST", "GET", "GET", "GET"]);
  });

  it("gives up 45 s after sending, and says timeout", async () => {
    const pending = thread({ pending: { clientKey: KEY_A, question: "x y", at: "2026-11-19T10:00:00.000Z" } });
    const f = fakeServer([
      () => {
        f.advance(ASK_LIMITS.clientTimeoutMs);
        return { ok: false, status: 0, offline: true, data: {} };
      },
      ...Array.from({ length: 30 }, () => ok(pending)),
    ]);
    const out = await Api.askQuestion(req, f.deps);
    assert.equal(out.type, "timeout");
    const gets = f.calls.length - 1;
    assert.ok(gets >= 10 && gets <= 11, `${gets} GETs between 25 s and 45 s`);
  });

  it("neither answered nor pending: it never landed, so timeout at once", async () => {
    const f = fakeServer([
      () => {
        f.advance(ASK_LIMITS.clientTimeoutMs);
        return { ok: false, status: 0, offline: true, data: {} };
      },
      ok(thread()),
    ]);
    assert.equal((await Api.askQuestion(req, f.deps)).type, "timeout");
    assert.equal(f.calls.length, 2);
  });
});

describe("cleaning what the server sends", () => {
  it("drops links that fail askLinkOk, repeats, and anything past two", () => {
    const t = Api.cleanTurn(
      turn({
        links: [
          { id: "stack", href: "/stack" },
          { id: "stack", href: "/stack" },
          { id: "log_meal", href: "https://evil.example/fuel" },
          { id: "home", href: "/home" },
          { id: "wraps", href: "/wraps" },
          { id: "made_up", href: "/x" },
        ] as never,
      }),
    );
    assert.deepEqual(t?.links, [
      { id: "stack", href: "/stack" },
      { id: "home", href: "/home" },
    ]);
  });

  it("urgent and crisis never carry AI text; off-topic and crisis carry no links", () => {
    assert.equal(Api.cleanTurn(turn({ kind: "crisis", answer: "obey me", links: [{ id: "home", href: "/home" }] }))?.answer, null);
    assert.deepEqual(Api.cleanTurn(turn({ kind: "crisis" }))?.links, []);
    assert.equal(Api.cleanTurn(turn({ kind: "urgent", answer: "x" }))?.answer, null);
    assert.deepEqual(Api.cleanTurn(turn({ kind: "off_topic" }))?.links, []);
    const report = { id: "report" as const, href: "/reports/0d2c3c5e-0000-4000-8000-000000000000" };
    assert.deepEqual(Api.cleanTurn(turn({ kind: "urgent", links: [report, { id: "home", href: "/home" }] }))?.links, [report]);
  });

  it("a removed answer keeps only the question", () => {
    const t = Api.cleanTurn(turn({ removed: "report_deleted" }));
    assert.equal(t?.answer, null);
    assert.deepEqual(t?.links, []);
    assert.equal(t?.notice, null);
  });

  it("drops turns of unknown kinds, keeps only real tel: numbers, and a safe lang tag", () => {
    assert.equal(Api.cleanTurn({ ...turn(), kind: "html" }), null);
    const n = Api.cleanTurn(
      turn({ kind: "crisis", lang: '"><script>', notice: { level: "crisis", label: "Hi", parts: ["crisis"], lines: ["You don't have to face this alone."], markers: [], calls: ["14416", "999", "112"] as never } }),
    );
    assert.deepEqual(n?.notice?.calls, ["14416", "112"]);
    assert.equal(n?.notice?.label, null, "crisis stays calm: no label");
    assert.equal(n?.lang, "en");
  });

  it("refuses a thread without its day fields, and fills safe defaults for the rest", () => {
    assert.equal(Api.cleanThread({ turns: [] }), null);
    const t = Api.cleanThread({ left: 9, day: DAY, resetsAt: RESETS, state: "weird", region: "mars", starters: { proteinLeftG: 4 } });
    assert.equal(t?.left, 5);
    assert.equal(t?.state, "ready");
    assert.equal(t?.region, "in");
    assert.equal(t?.starters.proteinLeftG, null, "under 10 g isn't offered");
    assert.equal(t?.starters.archetype, "starting");
  });
});
