// When a spoken meal logs itself (components/platform/autolog.ts): after a pause
// that follows real words, a short countdown, then one log; never after typing,
// Edit or Stop, never without words, never twice.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COUNTDOWN_MS, IDLE, PAUSE_MS, sameWords, stepAutoLog, type AutoEvent, type AutoLog } from "../components/platform/autolog.ts";

const on = { allowed: true };
const run = (events: AutoEvent[], ctx = on, from: AutoLog = IDLE) => events.reduce((s, e) => stepAutoLog(s, e, ctx), from);
const ticks = (from: number, to: number, every = 100): AutoEvent[] => {
  const out: AutoEvent[] = [];
  for (let at = from; at <= to; at += every) out.push({ type: "tick", at });
  return out;
};
const heard = (at: number, words = "do roti aur dal"): AutoEvent[] => [
  { type: "start", at: 0, words: "" },
  { type: "result", at: at - 500, final: false, spoke: true, words: "do roti" },
  { type: "result", at, final: true, spoke: true, words },
];

describe("auto-log after a pause", () => {
  it("counts down after about 2 s with no new words, then logs once", () => {
    const listening = run(heard(1000));
    assert.equal(listening.kind, "listening");
    assert.equal(run(ticks(1100, 1000 + PAUSE_MS - 100), on, listening).kind, "listening");
    const counting = run(ticks(1100, 1000 + PAUSE_MS), on, listening);
    assert.deepEqual(counting, { kind: "counting", endsAt: 1000 + PAUSE_MS + COUNTDOWN_MS, left: 2, words: "do roti aur dal" });
    const oneLeft = run([{ type: "tick", at: 1000 + PAUSE_MS + 1100 }], on, counting);
    assert.equal(oneLeft.kind === "counting" && oneLeft.left, 1);
    assert.equal(run([{ type: "tick", at: 1000 + PAUSE_MS + COUNTDOWN_MS }], on, oneLeft).kind, "logging");
  });

  it("waits while they're still talking", () => {
    const events: AutoEvent[] = [...heard(1000)];
    // Interim words every second for 6 s: never a 2 s gap.
    for (let at = 2000; at <= 7000; at += 1000) events.push({ type: "result", at, final: false, spoke: true, words: `do roti aur dal ${at}` }, ...ticks(at + 100, at + 900));
    assert.equal(run(events).kind, "listening");
  });

  it("needs a final result with words", () => {
    const interimOnly = run([{ type: "start", at: 0, words: "" }, { type: "result", at: 500, final: false, spoke: true, words: "do roti" }, ...ticks(600, 6000)]);
    assert.equal(interimOnly.kind, "listening");
    const silence = run([{ type: "start", at: 0, words: "2 rotis" }, { type: "result", at: 500, final: true, spoke: false, words: "2 rotis" }, ...ticks(600, 6000)]);
    assert.equal(silence.kind, "listening", "words already in the box don't count as heard");
    assert.equal(run([{ type: "start", at: 0, words: "" }, { type: "ended", at: 3000 }]).kind, "idle");
  });

  it("never runs where a meal can't be logged", () => {
    const off = { allowed: false };
    assert.equal(run([...heard(1000), ...ticks(1100, 9000)], off).kind, "listening");
    assert.equal(run([...heard(1000), { type: "ended", at: 1500 }], off).kind, "idle");
  });

  it("starts the countdown straight away when speech ends or the browser stops listening", () => {
    assert.equal(run([...heard(1000), { type: "speechend", at: 1200 }]).kind, "counting");
    assert.equal(run([...heard(1000), { type: "ended", at: 1200 }]).kind, "counting");
    assert.equal(run([{ type: "start", at: 0, words: "" }, { type: "speechend", at: 1200 }]).kind, "listening");
  });

  it("keeps counting when the browser stops listening during the countdown", () => {
    const counting = run([...heard(1000), { type: "speechend", at: 1200 }]);
    const ended = run([{ type: "ended", at: 1500 }], on, counting);
    assert.equal(ended.kind, "counting");
    assert.equal(run([{ type: "tick", at: 1200 + COUNTDOWN_MS }], on, ended).kind, "logging");
  });

  it("goes back to listening when new words come during the countdown", () => {
    const counting = run([...heard(1000), { type: "speechend", at: 1200 }]);
    const more = run([{ type: "result", at: 1800, final: false, spoke: true, words: "do roti aur dal aur dahi" }], on, counting);
    assert.equal(more.kind, "listening");
    assert.equal(more.kind === "listening" && more.heard, true);
    assert.equal(run(ticks(1900, 1800 + PAUSE_MS), on, more).kind, "counting");
  });

  it("isn't put off by the browser tidying the last phrase", () => {
    const counting = run([...heard(1000), { type: "speechend", at: 1200 }]);
    assert.equal(run([{ type: "result", at: 1500, final: true, spoke: true, words: "Do roti aur dal." }], on, counting).kind, "counting");
  });

  it("stops for typing, Edit, Stop, Cancel, errors and a hidden page, until they talk again", () => {
    const counting = run([...heard(1000), { type: "speechend", at: 1200 }]);
    const held = run([{ type: "hold" }], on, counting);
    assert.equal(held.kind, "idle");
    assert.equal(run([{ type: "ended", at: 1500 }, ...ticks(1600, 9000)], on, held).kind, "idle");
    assert.equal(run([{ type: "hold" }, ...ticks(1100, 9000)], on, run(heard(1000))).kind, "idle");
    // Talking again arms it again.
    assert.equal(run([{ type: "start", at: 10_000, words: "do roti" }, { type: "result", at: 11_000, final: true, spoke: true, words: "do roti aur dal" }, ...ticks(11_100, 13_000)], on, held).kind, "counting");
  });

  it("logs only once, however the log starts", () => {
    const counting = run([...heard(1000), { type: "speechend", at: 1200 }]);
    // Tapped Log during the countdown: the clock, the browser and Stop can't start a second one.
    const tapped = run([{ type: "submit" }], on, counting);
    assert.equal(tapped.kind, "logging");
    const after = run([...ticks(1300, 9000), { type: "ended", at: 2000 }, { type: "hold" }, { type: "speechend", at: 2100 }, { type: "start", at: 2200, words: "" }], on, tapped);
    assert.equal(after.kind, "logging");
    assert.equal(run([{ type: "done" }], on, after).kind, "idle");
  });

  it("compares words without case or punctuation", () => {
    assert.equal(sameWords("  Do roti, aur DAL. "), "do roti aur dal");
    assert.equal(sameWords("दो रोटी और दाल।"), "दो रोटी और दाल");
  });
});
