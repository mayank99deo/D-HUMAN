// Fuel's side of a meal sent twice, in plain Node: one automatic resend when the connection
// fails (never after an HTTP answer, never after a whole wait), the same key on every send of a
// try, the grey support line, and the orbit's Try again beside Back to Fuel.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { allowAppImports } from "./support/app.ts";
import { allowTsx } from "./support/tsx.ts";

allowAppImports();
allowTsx();
const { postResending, triesLine, tryKey, RESEND_AFTER_MS } = await import("../components/platform/net.ts");
const { mealForm, sameTry, sendFailure, TRY_KEEP_MS } = await import("../components/platform/meal-send.ts");
const { MealOrbit } = await import("../components/platform/MealOrbit.tsx");
type MealTry = import("../components/platform/meal-send.ts").MealTry;
type SendDeps = import("../components/platform/net.ts").SendDeps;

/** A fake network: each send takes `ms` of fake time, then answers or fails as scripted. */
function network(script: ({ fail: string; ms: number } | { status: number; body?: string; ms: number; cut?: boolean } | { hang: true })[]) {
  let now = 1_000;
  const sleeps: number[] = [];
  const bodies: unknown[] = [];
  const deps: SendDeps = {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    fetch: (async (_url: unknown, init?: RequestInit) => {
      bodies.push(init?.body);
      const step = script.shift();
      if (!step) throw new Error("no more scripted sends");
      if ("hang" in step) {
        return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError"))));
      }
      now += step.ms;
      if ("fail" in step) throw new TypeError(step.fail);
      const text = step.body ?? "{}";
      return {
        ok: step.status >= 200 && step.status < 300,
        status: step.status,
        text: async () => {
          if (step.cut) throw new TypeError("Load failed");
          return text;
        },
      } as Response;
    }) as typeof fetch,
  };
  return { deps, sleeps, bodies };
}
const body = () => "x";

describe("postResending", () => {
  it("resends once when the connection fails, after a short wait, with a fresh body", async () => {
    const net = network([{ fail: "Load failed", ms: 9_700 }, { status: 200, body: '{"log":{"id":"m1"}}', ms: 1_300 }]);
    let made = 0;
    const sent = await postResending("/api/food", () => `body ${++made}`, { deps: net.deps });
    assert.equal(sent.res?.status, 200);
    assert.deepEqual(sent.data, { log: { id: "m1" } });
    assert.deepEqual(sent.tries, [{ what: "Load failed", ms: 9_700 }]);
    assert.deepEqual(net.sleeps, [RESEND_AFTER_MS]);
    assert.deepEqual(net.bodies, ["body 1", "body 2"]);
  });

  it("never resends after an HTTP answer, even a failure", async () => {
    for (const status of [500, 502, 409, 422, 429]) {
      const net = network([{ status, body: '{"error":"failed"}', ms: 400 }]);
      const sent = await postResending("/api/food", body, { deps: net.deps });
      assert.equal(sent.res?.status, status);
      assert.equal(net.bodies.length, 1, `one send for ${status}`);
      assert.deepEqual(sent.tries, [{ what: `HTTP ${status}`, ms: 400 }]);
    }
  });

  it("stops after the second failure and says what both did", async () => {
    const net = network([{ fail: "Load failed", ms: 9_700 }, { fail: "The network connection was lost.", ms: 300 }]);
    const sent = await postResending("/api/food", body, { deps: net.deps });
    assert.equal(sent.res, null);
    assert.equal(net.bodies.length, 2);
    assert.equal(triesLine(sent.tries), "Load failed after 9.7 s, then The network connection was lost. after 0.3 s");
  });

  it("resends when the answer is cut off half way (the meal may have landed: the key makes that safe)", async () => {
    const net = network([{ status: 200, ms: 1_200, cut: true }, { status: 200, body: '{"log":{"id":"m1"},"repeat":true}', ms: 200 }]);
    const sent = await postResending("/api/food", body, { deps: net.deps });
    assert.equal(sent.res?.status, 200);
    assert.equal(sent.data.repeat, true);
    assert.deepEqual(sent.tries, [{ what: "Load failed", ms: 1_200 }]);
  });

  it("keeps a gateway's page that isn't JSON as an answer, without resending", async () => {
    const net = network([{ status: 504, body: "<html>Gateway Timeout</html>", ms: 60_000 }]);
    const sent = await postResending("/api/food", body, { deps: net.deps });
    assert.equal(sent.res?.status, 504);
    assert.deepEqual(sent.data, {});
    assert.equal(net.bodies.length, 1);
  });

  it("gives up without resending when nothing comes back for the whole wait", async () => {
    const net = network([{ hang: true }]);
    const sent = await postResending("/api/food", body, { deps: { ...net.deps, now: Date.now }, giveUpMs: 30 });
    assert.equal(sent.res, null);
    assert.equal(net.bodies.length, 1);
    assert.equal(sent.tries[0].what, "No answer");
  });

  it("has nothing to say when every send was fine", () => {
    assert.equal(triesLine([]), null);
  });
});

describe("a try's key", () => {
  it("is random and passes the server's check", async () => {
    const { MEAL_KEY } = await import("../lib/platform/food.ts");
    const a = tryKey();
    assert.notEqual(a, tryKey());
    assert.ok(MEAL_KEY.test(a));
  });

  it("goes with every send of the try, beside the same words", () => {
    const t: MealTry = { key: tryKey(), at: 0, words: "दो रोटी और दाल", english: "two rotis and dal", speaking: "hi", source: "voice", meal: "lunch", photo: null };
    const a = mealForm(t);
    const b = mealForm(t);
    for (const f of [a, b]) {
      assert.equal(f.get("key"), t.key);
      assert.equal(f.get("text"), "two rotis and dal");
      assert.equal(f.get("original"), "दो रोटी और दाल");
      assert.equal(f.get("spoken"), "hi");
      assert.equal(f.get("source"), "voice");
      assert.equal(f.get("meal"), "lunch");
      assert.equal(f.get("photo"), null);
    }
  });

  it("sends the photo for a photo try, and the words alone when there's no translation", () => {
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "x.jpg", { type: "image/jpeg" });
    const f = mealForm({ key: tryKey(), at: 0, words: "cooked in ghee", english: null, speaking: null, source: "photo", meal: "", photo });
    assert.equal(f.get("text"), "cooked in ghee");
    assert.equal(f.get("original"), null);
    assert.equal(f.get("meal"), null);
    assert.ok(f.get("photo") instanceof File);
  });

  it("is reused only for the very same meal, and not after TRY_KEEP_MS", () => {
    const photo = new File(["a"], "a.jpg");
    const prev: MealTry = { key: "k-1234567890abcdef", at: 1_000, words: "poha", english: null, speaking: null, source: "text", meal: "", photo: null };
    const same = { words: "poha", speaking: null, source: "text" as const, meal: "" as const, photo: null };
    assert.equal(sameTry(prev, same, 2_000), prev);
    assert.equal(sameTry(prev, { ...same, words: "poha and chai" }, 2_000), null, "changed words are a new meal");
    assert.equal(sameTry(prev, { ...same, meal: "breakfast" }, 2_000), null);
    assert.equal(sameTry(prev, { ...same, speaking: "hinglish" }, 2_000), null);
    assert.equal(sameTry(prev, { ...same, source: "voice" }, 2_000), null);
    assert.equal(sameTry({ ...prev, source: "photo", photo }, { ...same, source: "photo", photo: new File(["a"], "a.jpg") }, 2_000), null, "another photo");
    assert.equal(sameTry(prev, same, 1_000 + TRY_KEEP_MS + 1), null, "an old failed try isn't reused");
    assert.equal(sameTry(null, same, 2_000), null);
  });
});

describe("what a failed send shows", () => {
  const res = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;

  it("keeps the plain words for a lost connection, offers Try again, and adds the grey line", () => {
    const f = sendFailure({ res: null, data: {}, tries: [{ what: "Load failed", ms: 9_700 }, { what: "Load failed", ms: 300 }] });
    assert.equal(f.message, "No connection. Check your signal and try again.");
    assert.equal(f.retry, true);
    assert.equal(f.detail, "Load failed after 9.7 s, then Load failed after 0.3 s");
  });

  it("offers Try again for server failures and a meal still being read, not for answers that would repeat", () => {
    assert.equal(sendFailure({ res: res(500), data: { error: "failed" }, tries: [{ what: "HTTP 500", ms: 800 }] }).retry, true);
    assert.equal(sendFailure({ res: res(504), data: {}, tries: [{ what: "HTTP 504", ms: 60_000 }] }).detail, "HTTP 504 after 60.0 s");
    const busy = sendFailure({ res: res(409), data: { error: "in_progress", message: "We're still reading this meal. Try again in a moment." }, tries: [] });
    assert.deepEqual([busy.retry, busy.message], [true, "We're still reading this meal. Try again in a moment."]);
    for (const [status, error] of [[422, "not_food"], [429, "rate_limited"], [413, "too_large"], [503, "ai_off"], [400, "invalid"]] as const) {
      const f = sendFailure({ res: res(status), data: { error }, tries: [{ what: `HTTP ${status}`, ms: 300 }] });
      assert.equal(f.retry, false, error);
      assert.equal(f.detail, null, error);
    }
    assert.equal(sendFailure({ res: res(422), data: { error: "not_food" }, tries: [] }).message, "That doesn't look like food. Try another photo, or tell us what you ate.");
  });

  it("treats a 200 without a meal as garbled, and safe to try again", () => {
    const f = sendFailure({ res: res(200), data: {}, tries: [] });
    assert.deepEqual([f.retry, f.message], [true, "We couldn't log that. Try again."]);
  });
});

describe("the orbit after a failed send", () => {
  const html = (run: Parameters<typeof MealOrbit>[0]["run"], onRetry?: () => void) =>
    renderToStaticMarkup(createElement(MealOrbit, { run, facts: [], categories: [], onClose: () => {}, onRetry })).replace(/&#x27;/g, "'");

  it("offers Try again beside Back to Fuel, with the grey line", () => {
    const out = html({ kind: "meal", startedAt: 0, state: "error", error: "No connection. Check your signal and try again.", detail: "Load failed after 9.7 s, then Load failed after 0.3 s", retry: true }, () => {});
    assert.match(out, />Try again</);
    assert.match(out, />Back to Fuel</);
    assert.match(out, /No connection\. Check your signal and try again\./);
    assert.match(out, /text-xs text-graphite">Load failed after 9\.7 s, then Load failed after 0\.3 s</);
    assert.ok(out.indexOf(">Try again<") < out.indexOf(">Back to Fuel<"), "Try again comes first");
  });

  it("offers only Back to Fuel when trying again wouldn't help", () => {
    const out = html({ kind: "meal", startedAt: 0, state: "error", error: "That doesn't look like food.", detail: null, retry: false }, () => {});
    assert.doesNotMatch(out, /Try again</);
    assert.match(out, />Back to Fuel</);
  });

  it("shows no grey line while reading or when done", () => {
    const out = html({ kind: "meal", startedAt: 0, state: "running", detail: "Load failed after 9.7 s" });
    assert.doesNotMatch(out, /Load failed/);
  });
});
