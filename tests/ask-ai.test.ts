// Ask's call (lib/ai/ask.ts): the mock path and its tags, the lenient parse, one retry on
// bad output and on an answer in the wrong script, refusals and timeouts, the request's
// shape, and the eval set run through the pipeline with stub models (the live run is
// scripts/ask-eval.mts, opt-in).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APIConnectionTimeoutError, InternalServerError } from "@anthropic-ai/sdk";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { askParams, askPreCheck, answerAsk, parseAsk, runAsk } = await import("../lib/ai/ask.ts");
type Schema = (typeof import("../lib/ai/ask.ts"))["ASK_JSON_SCHEMA"];
const { ASK_LIMITS, ASK_LINK_IDS } = await import("../lib/ask/types.ts");
const { ARJUN, MEENA, PEOPLE, RIYA } = await import("./fixtures/ask-people.ts");
const { CASES, grade } = await import("./fixtures/ask-eval.ts");
const { packText } = await import("../lib/domain/ask-context.ts");
type Caller = Exclude<Parameters<typeof runAsk>[1]["call"], "mock">;
type Data = typeof RIYA;

// The [ai] cost lines are noise here.
console.info = () => {};

const input = (question: string, data: Data = RIYA) => ({ question, about: null, earlier: [], data });
const message = (text: string, stop = "end_turn") =>
  ({
    id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5", container: null, context_management: null,
    content: [{ type: "text", text, citations: null }], stop_reason: stop, stop_sequence: null, stop_details: null,
    usage: { input_tokens: 1200, output_tokens: 120, cache_read_input_tokens: 3400, cache_creation_input_tokens: 0 },
  }) as never;
const json = (o: Record<string, unknown> = {}) => JSON.stringify({ kind: "answer", topics: ["food"], markers: [], links: ["log_meal"], lang: "en", answer: "Add a katori of dal at dinner.", ...o });
/** A caller that answers from a queue, and records every request. */
function queue(...replies: (string | Error | [string, string])[]): Caller & { calls: unknown[] } {
  const calls: unknown[] = [];
  const call: Caller = async (params) => {
    calls.push(params);
    const next = replies.shift();
    if (next === undefined) throw new Error("no reply queued");
    if (next instanceof Error) throw next;
    return Array.isArray(next) ? message(next[0], next[1]) : message(next);
  };
  return Object.assign(call, { calls });
}
const signal = () => AbortSignal.timeout(15_000);

describe("ask: the lenient parse", () => {
  it("never throws on a stray value", () => {
    const out = parseAsk(JSON.stringify({ kind: "maybe", topics: ["diet", "food", "food"], markers: ["ferritin", 3], links: ["https://evil", "stack"], lang: "klingon", answer: "Eat dal." }), "hi")!;
    assert.deepEqual(out, { kind: "answer", topics: ["other", "food"], markers: ["ferritin"], links: ["stack"], lang: "hi", answer: "Eat dal." });
    assert.equal(parseAsk("not json", "en"), null);
    assert.equal(parseAsk("[1,2]", "en"), null);
    assert.equal(parseAsk(JSON.stringify({ kind: "answer" }), "en"), null);
  });
});

describe("ask: the request", () => {
  it("sends the hand-written schema with real enums, the cache mark, thinking off, and the facts after the user turn", () => {
    const p = askParams(input("How much protein do I still need today?"));
    assert.equal(p.model, "claude-haiku-5-5");
    assert.equal(p.max_tokens, 600);
    assert.deepEqual(p.thinking, { type: "disabled" });
    const format = p.output_config!.format as { type: string; schema: Schema };
    assert.equal(format.type, "json_schema");
    assert.equal(p.output_config!.effort, "low");
    const props = format.schema.properties;
    assert.deepEqual(props.kind.enum, ["answer", "off_topic", "doctor", "urgent", "crisis"]);
    assert.equal(props.links.items.enum.length, 13);
    assert.deepEqual(props.links.items.enum, [...ASK_LINK_IDS]);
    assert.ok(props.topics.items.enum.includes("symptom"));
    assert.ok(props.lang.enum.includes("hinglish"));
    assert.equal(format.schema.additionalProperties, false);
    // The schema isn't the SDK helper's: no enum hidden in a description.
    assert.ok(!JSON.stringify(format.schema).includes("{enum:"));
    const system = p.system as { type: string; text: string; cache_control: unknown }[];
    assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
    assert.equal(p.messages.length, 2);
    assert.equal(p.messages[0].role, "user");
    assert.equal(p.messages[1].role, "system");
    assert.ok(!String(p.messages[1].content).includes("protein do I still need"), "the question never rides in the facts");
    assert.match(String(p.messages[1].content), /^Safety facts from the D-Human app/);
  });
});

describe("ask: the call", () => {
  it("answers, with usage summed for the route's ledger", async () => {
    const call = queue(json());
    const t = await runAsk(input("What can I eat for dinner?"), { signal: signal(), call });
    assert.equal(t.answer.ok, true);
    if (!t.answer.ok) return;
    assert.equal(t.answer.reply.kind, "answer");
    assert.deepEqual(t.answer.reply.links, ["log_meal"]);
    assert.equal(t.answer.usage.model, "claude-haiku-5-5");
    assert.equal(t.answer.usage.inputTokens, 4600);
    assert.equal(t.answer.usage.outputTokens, 120);
    assert.ok(t.answer.usage.costMicros > 0);
    assert.equal(call.calls.length, 1);
  });

  it("retries bad JSON once, then gives up as failed", async () => {
    const once = await runAsk(input("What can I eat?"), { signal: signal(), call: queue("{not json", json()) });
    assert.equal(once.answer.ok, true);
    assert.equal(once.retried, "output");
    const twice = queue("{not json", "still not json");
    const failed = await runAsk(input("What can I eat?"), { signal: signal(), call: twice });
    assert.deepEqual(failed.answer, { ok: false, error: "failed" });
    assert.equal(twice.calls.length, 2);
    // Out of room counts as bad output too.
    const room = await runAsk(input("What can I eat?"), { signal: signal(), call: queue([json(), "max_tokens"], json()) });
    assert.equal(room.answer.ok, true);
    assert.equal(room.retried, "output");
  });

  it("retries an answer in the wrong script once, and uses the retry only when it's right", async () => {
    const q = "జిమ్ తర్వాత ఏమి తినాలి?";
    const fixed = await runAsk(input(q, ARJUN), { signal: signal(), call: queue(json({ answer: "Eat dal and rice." }), json({ lang: "te", answer: "పప్పు అన్నం తినండి." })) });
    assert.equal(fixed.retried, "language");
    assert.ok(fixed.answer.ok && fixed.answer.reply.answer?.startsWith("పప్పు"));
    assert.ok(fixed.answer.ok && fixed.answer.reply.lang === "te");
    const still = await runAsk(input(q, ARJUN), { signal: signal(), call: queue(json({ answer: "Eat dal and rice." }), json({ answer: "Eat dal." })) });
    assert.ok(still.answer.ok && still.answer.reply.answer === "Eat dal and rice.");
    // Latin-letter questions never retry for script.
    const call = queue(json({ answer: "Dal chawal khao." }));
    await runAsk(input("Kya khaun?"), { signal: signal(), call });
    assert.equal(call.calls.length, 1);
  });

  it("maps a refusal to refused, a timeout to timeout, and an API error to failed, without throwing", async () => {
    const refusal = queue(["", "refusal"]);
    assert.deepEqual((await runAsk(input("x?"), { signal: signal(), call: refusal })).answer, { ok: false, error: "refused" });
    assert.equal(refusal.calls.length, 1, "a refusal isn't retried");
    const slow = queue(new APIConnectionTimeoutError({ message: "timed out" }));
    assert.deepEqual((await runAsk(input("x?"), { signal: signal(), call: slow })).answer, { ok: false, error: "timeout" });
    const server = queue(new InternalServerError(500, { type: "error" }, "boom", new Headers()));
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (line: string) => logged.push(line);
    assert.deepEqual((await runAsk(input("x?"), { signal: signal(), call: server })).answer, { ok: false, error: "failed" });
    console.warn = warn;
    assert.deepEqual(logged, ["[ask] model call failed: InternalServerError 500"]);
    const aborted = AbortSignal.abort();
    assert.deepEqual((await runAsk(input("x?"), { signal: aborted, call: queue(json()) })).answer, { ok: false, error: "timeout" });
  });

  it("answers ai_off with no key and no mock", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.D_HUMAN_AI_MOCK;
    assert.deepEqual(await answerAsk(input("x?"), { signal: signal() }), { ok: false, error: "ai_off" });
  });
});

describe("ask: the local mock and its tags", () => {
  const mock = async (question: string, data: Data = RIYA, s = signal()) => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.D_HUMAN_AI_MOCK = "1";
    delete process.env.VERCEL;
    return answerAsk(input(question, data), { signal: s });
  };

  it("answers by keyword, as a demo", async () => {
    const r = await mock("How much protein do I still need today?");
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.usage.model, "mock");
    assert.equal(r.usage.costMicros, 0);
    assert.match(r.reply.answer!, /^Demo answer: you've had 30 g of your 73 g protein/);
    assert.equal((await mock("Where are my past meals?")).ok && (await mock("Where are my past meals?")).ok, true);
  });

  it("shows every state from a tag", async () => {
    const kinds = await Promise.all(["#off", "#doctor", "#urgent", "#evil"].map((t) => mock(`Test ${t}`)));
    assert.deepEqual(kinds.map((r) => r.ok && r.reply.kind), ["off_topic", "doctor", "urgent", "doctor"]);
    const evil = kinds[3];
    assert.ok(evil.ok && evil.reply.answer === null && evil.reply.filter);
    assert.deepEqual(await mock("Test #fail"), { ok: false, error: "failed" });
    assert.deepEqual(await mock("Test #refuse"), { ok: false, error: "refused" });
    // #slow honours the signal, so the route's 20 s deadline answers timeout.
    const t0 = Date.now();
    assert.deepEqual(await mock("Test #slow", RIYA, AbortSignal.timeout(200)), { ok: false, error: "timeout" });
    assert.ok(Date.now() - t0 < 2_000);
  });

  it("goes through the same floor as a live answer", async () => {
    const r = await mock("What does ferritin mean?");
    assert.ok(r.ok && r.reply.kind === "doctor" && r.reply.notice!.parts.includes("doctor_marker"));
    const held = await mock("What should I eat?", MEENA);
    assert.ok(held.ok && held.reply.kind === "urgent");
  });
});

describe("ask eval set, run with stub models", () => {
  it("is well formed: unique ids, known people, kinds, languages and links", () => {
    assert.equal(CASES.length, 58);
    assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
    for (const c of CASES) {
      assert.ok(c.person in PEOPLE, c.id);
      for (const l of c.links ?? []) assert.ok((ASK_LINK_IDS as readonly string[]).includes(l), `${c.id}: ${l}`);
      assert.ok(c.kinds.length && c.lang.length, c.id);
    }
  });

  it("answers the crisis-list and emergency cases in code, before any model", () => {
    const pre = CASES.filter((c) => askPreCheck({ question: c.q, about: c.about ?? null, data: PEOPLE[c.person] }));
    assert.deepEqual(pre.map((c) => c.id).sort(), ["inj-fake-data", "safe-breathless", "safe-chest-pain", "safe-crisis-hinglish", "safe-crisis-list", "safe-hinglish-chest"]);
  });

  it("never throws, and holds the caps and rules for every case, even with an obedient model", async () => {
    for (const c of CASES) {
      const data = PEOPLE[c.person];
      const inp = { question: c.q, about: c.about ?? null, earlier: c.earlier ?? [], data };
      if (askPreCheck(inp)) continue;
      const t = await runAsk(inp, { signal: signal(), call: queue(json({ kind: c.kinds[0], answer: "Take 60000 IU and see https://x.in " + "word ".repeat(200) })) });
      assert.ok(t.answer.ok, c.id);
      if (!t.answer.ok) continue;
      const r = t.answer.reply;
      if (r.kind === "urgent" || r.kind === "crisis") assert.equal(r.answer, null, c.id);
      if (r.kind === "off_topic") assert.deepEqual(r.links, [], c.id);
      assert.ok(!r.answer || r.answer.split(/\s+/).length <= ASK_LIMITS.answerMaxWords, c.id);
      assert.ok(!r.answer?.includes("60000") && !r.answer?.includes("x.in"), c.id);
      assert.ok(r.links.length <= 2, c.id);
    }
  });

  it("grades: a good reply passes; a brand, a diagnosis, a wrong script or a missed kind fail", async () => {
    const c = CASES.find((x) => x.id === "food-protein-left")!;
    const good = await runAsk(input(c.q), { signal: signal(), call: queue(json({ answer: "About 43 g to go today: add dal and curd." })) });
    assert.ok(good.answer.ok);
    if (!good.answer.ok) return;
    assert.deepEqual(grade(c, good.answer.reply, good.used, packText(RIYA)), { fails: [], minor: [] });
    const bad = { ...good.used!, answer: "You have diabetes; take MuscleBlaze." };
    const g = grade(c, good.answer.reply, bad, packText(RIYA));
    assert.ok(g.fails.includes("brand name") && g.fails.includes("diagnosis wording"));
    const te = CASES.find((x) => x.id === "food-te-postgym")!;
    assert.ok(grade(te, good.answer.reply, { ...good.used!, lang: "te", answer: "Eat dal." }, "").fails.some((f) => f.startsWith("script")));
    const doctorCase = CASES.find((x) => x.id === "health-diabetes")!;
    assert.ok(grade(doctorCase, good.answer.reply, good.used, "").fails.some((f) => f.startsWith("kind answer")));
  });
});
