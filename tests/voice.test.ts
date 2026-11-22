// Voice: one listening session (listen-state.ts), what Fuel's Say card shows (say-view.ts),
// Ask's mic line (ask-mic.ts) and their words (voice-copy.ts).
//
// The bug these guard (Mayank, 2026-11-20): pick বাংলা or தமிழ் on an iPhone, see "this browser
// can't listen", switch back to English, tap Say, and the mic doesn't respond until the page
// is reopened. The screen said "Listening…" as soon as start() was called and never noticed a
// recogniser that didn't start; Say did nothing while that flag was up. Now nothing says
// "Speak now" before the recogniser's own start, a start that never comes is noticed, and
// every failure has a way on.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const L = await import("../components/platform/listen-state.ts");
const { sayView } = await import("../components/platform/say-view.ts");
const { askMicLine } = await import("../components/platform/ask-mic.ts");
const V = await import("../components/platform/voice-copy.ts");
const { IDLE, COUNTDOWN_MS } = await import("../components/platform/autolog.ts");
const { spokenById } = await import("../lib/domain/speech.ts");
type Mic = import("../components/platform/listen-state.ts").Mic;
type MicEvent = import("../components/platform/listen-state.ts").MicEvent;
type AutoLog = import("../components/platform/autolog.ts").AutoLog;

const run = (events: MicEvent[], from: Mic = L.MIC_OFF, opts = {}) => events.reduce((m, e) => L.micStep(m, e, opts), from);
const ticks = (from: number, to: number, every = 250): MicEvent[] => {
  const out: MicEvent[] = [];
  for (let at = from; at <= to; at += every) out.push({ type: "tick", at });
  return out;
};
const en = spokenById("en");
const ta = spokenById("ta");
const hi = spokenById("hi");
const view = (mic: Mic, over: Partial<Parameters<typeof sayView>[0]> = {}) =>
  sayView({ mic, auto: IDLE, words: "", spoken: en, online: true, prompt: false, off: [], ...over });

describe("a listening session", () => {
  it("is live only once the recogniser says so", () => {
    const starting = run([{ type: "begin", at: 0 }]);
    assert.equal(starting.kind, "starting");
    assert.equal(run([{ type: "live", at: 300 }], starting).kind, "live");
    // Words before a start event still mean it's listening.
    assert.equal(run([{ type: "heard", at: 300 }], starting).kind, "live");
  });

  it("notices a recogniser that never starts", () => {
    const stuck = run([{ type: "begin", at: 0 }, ...ticks(250, L.START_SLOW_MS - 1)]);
    assert.deepEqual(stuck, { kind: "starting", since: 0, slow: false });
    assert.deepEqual(run(ticks(L.START_SLOW_MS, L.START_SLOW_MS), stuck), { kind: "starting", since: 0, slow: true });
  });

  it("treats an error as final, with or without an end after it (Safari sends none)", () => {
    const failed = run([{ type: "begin", at: 0 }, { type: "error", problem: "language" }]);
    assert.deepEqual(failed, { kind: "off", problem: "language" });
    assert.deepEqual(run([{ type: "end" }, ...ticks(0, 20_000)], failed), failed);
    assert.equal(L.micBusy(failed), false, "nothing is left holding the mic");
  });

  it("goes quiet, then stops and frees the mic, when nothing is heard", () => {
    const live = run([{ type: "begin", at: 0 }, { type: "live", at: 0 }]);
    const quiet = run(ticks(250, L.QUIET_MS), live);
    assert.equal(quiet.kind === "live" && quiet.quiet, true);
    const nothing = run(ticks(L.QUIET_MS, L.NOTHING_MS), quiet);
    assert.deepEqual(nothing, { kind: "off", problem: "nothing_heard" });
    assert.equal(L.micEffect(quiet, nothing), "abort");
  });

  it("stops by itself after 90 s, keeping the words, and gives up on a stop that's never confirmed", () => {
    const talking = run([{ type: "begin", at: 0 }, { type: "live", at: 0 }, { type: "heard", at: 1000 }]);
    const capped = run([{ type: "heard", at: 89_000 }, { type: "tick", at: L.SESSION_MAX_MS }], talking);
    assert.equal(capped.kind, "stopping");
    assert.equal(L.micEffect(talking, capped), "stop");
    const gaveUp = run([{ type: "tick", at: L.SESSION_MAX_MS + L.STOP_GRACE_MS }], capped);
    assert.deepEqual(gaveUp, { kind: "off", problem: null });
  });

  it("ends a stop cleanly when the last words and the end arrive", () => {
    const stopping = run([{ type: "begin", at: 0 }, { type: "live", at: 0 }, { type: "heard", at: 500 }, { type: "stop", at: 900 }]);
    assert.equal(run([{ type: "heard", at: 950 }], stopping).kind, "stopping", "late words don't reopen it");
    assert.deepEqual(run([{ type: "end" }], stopping), { kind: "off", problem: null });
    // An "aborted" or "no-speech" right after a stop changes nothing.
    assert.deepEqual(run([{ type: "error", problem: "stopped" }], stopping), { kind: "off", problem: null });
  });

  it("calls a session that ended without a word nothing heard, and one that ended before starting stopped", () => {
    assert.deepEqual(run([{ type: "begin", at: 0 }, { type: "live", at: 0 }, { type: "end" }]), { kind: "off", problem: "nothing_heard" });
    assert.deepEqual(run([{ type: "begin", at: 0 }, { type: "live", at: 0 }, { type: "heard", at: 300 }, { type: "end" }]), { kind: "off", problem: null });
    assert.deepEqual(run([{ type: "begin", at: 0 }, { type: "end" }]), { kind: "off", problem: "stopped" });
  });

  it("stops after a silence once there are words, when asked to (Ask)", () => {
    const opts = { stopAfterSilenceMs: 3000 };
    const talking = run([{ type: "begin", at: 0 }, { type: "live", at: 0 }, { type: "heard", at: 1000 }], L.MIC_OFF, opts);
    assert.equal(run(ticks(1250, 3999), talking, opts).kind, "live");
    assert.equal(run([{ type: "tick", at: 4000 }], talking, opts).kind, "stopping");
    // Fuel doesn't: autolog handles its pause and the mic stays on.
    assert.equal(run([{ type: "tick", at: 9000 }], talking).kind, "live");
  });
});

describe("what an error means", () => {
  const ctx = (lang: Parameters<typeof L.micProblemOf>[1]["lang"], workedIn: Parameters<typeof L.micProblemOf>[1]["workedIn"] = []) => ({ lang, workedIn });
  it("reads iPhone's service-not-allowed as the language when it can be, else Dictation off", () => {
    assert.equal(L.micProblemOf("service-not-allowed", ctx("ta")), "language", "iPhone can't transcribe Tamil");
    assert.equal(L.micProblemOf("service-not-allowed", ctx("bn", ["en"])), "language");
    assert.equal(L.micProblemOf("service-not-allowed", ctx("en")), "dictation_off");
    assert.equal(L.micProblemOf("service-not-allowed", ctx("hi", ["en"])), "language", "English listened, Hindi didn't");
    // Hinglish listens in hi-IN, like हिंदी (it was on en-IN for a few hours on 2026-11-22).
    assert.equal(L.micProblemOf("service-not-allowed", ctx("hinglish", ["hi"])), "dictation_off", "the same hi-IN engine");
    assert.equal(L.micProblemOf("service-not-allowed", ctx("hi", ["hinglish"])), "dictation_off", "the same hi-IN engine");
    assert.equal(L.micProblemOf("service-not-allowed", ctx("hinglish", ["en"])), "language", "English listened in en-IN, Hinglish didn't in hi-IN");
  });
  it("knows which picks share an engine", () => {
    assert.ok(L.sameEngine("hinglish", "hi"));
    assert.ok(L.sameEngine("ta", "ta"));
    assert.equal(L.sameEngine("hinglish", "en"), false);
    assert.equal(L.sameEngine("hi", "mr"), false);
  });
  it("a pick is ruled out when it, or a pick sharing its engine, couldn't listen (QA, 2026-11-22)", () => {
    assert.ok(L.ruledOut("hi", ["hinglish"]), "Hinglish failing rules out हिंदी: both hi-IN");
    assert.ok(L.ruledOut("hinglish", ["hi"]));
    assert.ok(L.ruledOut("ta", ["ta"]));
    assert.equal(L.ruledOut("en", ["hinglish"]), false, "English listens in en-IN");
    assert.equal(L.ruledOut("en", []), false);
  });
  it("maps every other code", () => {
    assert.equal(L.micProblemOf("language-not-supported", ctx("en")), "language");
    assert.equal(L.micProblemOf("not-allowed", ctx("en")), "blocked");
    assert.equal(L.micProblemOf("network", ctx("en")), "offline");
    assert.equal(L.micProblemOf("audio-capture", ctx("en")), "no_mic");
    assert.equal(L.micProblemOf("no-speech", ctx("en")), "nothing_heard");
    // Today's Fuel said nothing at all for these: the mic just "didn't respond".
    for (const code of ["aborted", "bad-grammar", "phrases-not-supported", "something-new"]) assert.equal(L.micProblemOf(code, ctx("en")), "stopped", code);
  });
});

describe("words heard", () => {
  const results = (...r: [string, boolean][]) => r.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal }));
  it("splits what's settled from the tail still being guessed", () => {
    assert.deepEqual(L.heardOf(results(["two rotis", true], [" and dal", false])), { final: "two rotis", interim: " and dal" });
  });
  it("drops one leading 'speak now' a screen reader put in the mic", () => {
    assert.deepEqual(L.heardOf(results(["Speak now. Two rotis", true])), { final: "Two rotis", interim: "" });
    assert.deepEqual(L.heardOf(results(["speak now", false])), { final: "", interim: "" });
    assert.equal(L.heardOf(results(["I speak now and then", true])).final, "I speak now and then");
  });
  it("adds after the words already there and stops at the cap, without splitting a letter", () => {
    assert.deepEqual(L.joinWords("2 rotis", " and dal ", 1000), { text: "2 rotis and dal", full: false });
    assert.deepEqual(L.joinWords("", "dal", 1000), { text: "dal", full: false });
    const hindi = L.joinWords("", "दो रोटी और दाल", 5);
    assert.equal(hindi.full, true);
    assert.equal([...hindi.text].length, 5);
  });
  // Mayank, 2026-11-22: Hinglish picked, "do roti aur chane ki sabzi" said, Devanagari shown.
  it("shows Latin letters for English and Hinglish, even when the browser wrote Devanagari", () => {
    const devanagari = { final: "दो रोटी और", interim: " चने की सब्जी" };
    assert.deepEqual(L.heardInScript(devanagari, spokenById("hinglish")), { final: "do roti aur", interim: " chane ki sabji" });
    assert.deepEqual(L.heardInScript(devanagari, en), { final: "do roti aur", interim: " chane ki sabji" });
    assert.equal(L.heardInScript(devanagari, hi), devanagari, "हिंदी keeps Devanagari");
    const latin = { final: "do roti aur", interim: " dal" };
    assert.equal(L.heardInScript(latin, spokenById("hinglish")), latin, "Latin letters stay as they are");
  });
});

describe("the Say card", () => {
  const starting: Mic = { kind: "starting", since: 0, slow: false };
  const live: Mic = { kind: "live", since: 0, heardAt: null, quiet: false };
  const hearing: Mic = { kind: "live", since: 0, heardAt: 500, quiet: false };
  const counting = (by: "pause" | "tap"): AutoLog => ({ kind: "counting", by, endsAt: COUNTDOWN_MS, left: 3, words: "two rotis" });

  it("fills the control only while the recogniser is live, and never says Speak now before that", () => {
    const mics: Mic[] = [L.MIC_OFF, starting, { ...starting, slow: true }, live, hearing, { kind: "stopping", since: 0, problem: null }, { kind: "off", problem: "language" }];
    for (const m of mics) {
      for (const words of ["", "two rotis"]) {
        const v = view(m, { words });
        assert.equal(v.live, m.kind === "live", `${m.kind} ${words}`);
        if (m.kind !== "live") assert.notEqual(v.headline, V.SAY_COPY.ready);
      }
    }
  });

  it("starts at Getting your mic, with the prompt line when the browser will ask", () => {
    const v = view(starting, { prompt: true });
    assert.equal(v.headline, "Getting your mic…");
    assert.equal(v.line, "Your browser will ask to use the microphone. Choose Allow.");
    assert.equal(v.square.action, "none");
    assert.deepEqual(v.buttons, [{ id: "type" }]);
    assert.equal(v.announce, "Getting your mic.");
  });

  it("says when the mic is slow to start, and offers a fresh start or typing", () => {
    const v = view({ ...starting, slow: true });
    assert.equal(v.headline, "Still getting your mic…");
    assert.equal(v.line, "If nothing happens, try again or type it.");
    assert.deepEqual(v.buttons.map((b) => b.id), ["retry", "type"]);
  });

  it("Mayank's case: a failed language, then English that never starts, still has a way on", () => {
    // বাংলা failed (Safari: service-not-allowed, no end). English is picked; its start never comes.
    const failed = view({ kind: "off", problem: "language" }, { spoken: spokenById("bn") });
    assert.equal(failed.headline, "This browser can't listen in বাংলা");
    assert.deepEqual(failed.buttons.map((b) => b.id), ["listen_en", "listen_hi", "type"]);
    const stuck = run([{ type: "begin", at: 0 }, ...ticks(250, 5000)]);
    const v = view(stuck);
    assert.equal(v.live, false);
    assert.equal(v.headline, "Still getting your mic…");
    assert.deepEqual(v.buttons.map((b) => b.id), ["retry", "type"]);
  });

  it("is Speak now when live, with the placeholder, then Listening once words come", () => {
    const ready = view(live);
    assert.deepEqual([ready.kind, ready.headline, ready.hint, ready.words, ready.square.action], ["ready", "Speak now", "Tap when you're done", "placeholder", "finish"]);
    assert.equal(ready.announce, "Listening. Speak now.");
    assert.equal(view({ ...live, quiet: true }).line, "Still listening. Speak a little louder, or check the language at the top.");
    const h = view(hearing, { words: "two rotis" });
    assert.deepEqual([h.kind, h.headline, h.words, h.buttons[0].id], ["hearing", "Listening", "show", "edit"]);
  });

  it("counts down the same way after a pause or a tap; only a pause keeps the mic on", () => {
    const pause = view(hearing, { auto: counting("pause"), words: "two rotis" });
    assert.deepEqual([pause.headline, pause.live, pause.square.number, pause.square.action, pause.hint, pause.line], ["Logging this meal", true, 3, "log", "Tap to log now", "Say more to add to it."]);
    assert.deepEqual(pause.buttons.map((b) => b.id), ["keep", "edit"]);
    const tap = view({ kind: "stopping", since: 0, problem: null }, { auto: counting("tap"), words: "two rotis" });
    assert.deepEqual([tap.headline, tap.live, tap.line], ["Logging this meal", false, null]);
    assert.equal(tap.announce, "Logging this meal in 3 seconds. Choose Keep talking or Edit to stop it.");
  });

  it("keeps the words at Ready to log whatever stopped it, with an error's line above them", () => {
    const r = view(L.MIC_OFF, { words: "two rotis" });
    assert.deepEqual([r.kind, r.headline, r.square.action, r.hint], ["review", "Ready to log", "listen", "Tap to keep talking"]);
    assert.deepEqual(r.buttons, [{ id: "log", primary: true }, { id: "edit" }]);
    const net = view({ kind: "off", problem: "offline" }, { words: "two rotis", online: false });
    assert.deepEqual(net.note, { text: "You're offline", mark: true });
    assert.equal(net.square.action, "none", "listening again can't work offline");
    const lang = view({ kind: "off", problem: "language" }, { words: "two rotis", spoken: ta });
    assert.deepEqual(lang.note, { text: "This browser can't listen in தமிழ்", mark: false });
    assert.deepEqual(lang.buttons.map((b) => b.id), ["log", "edit", "listen_en", "listen_hi"]);
  });

  it("has a way on from every failure", () => {
    const cases: [import("../components/platform/listen-state.ts").MicProblem, string, boolean, string[]][] = [
      ["nothing_heard", "We didn't hear anything", false, ["type"]],
      ["blocked", "Your mic is blocked", true, ["type", "retry"]],
      ["dictation_off", "Listening is off on this device", true, ["type", "retry"]],
      ["offline", "You're offline", true, ["type", "retry"]],
      ["no_mic", "We couldn't find a microphone", true, ["retry", "type"]],
      ["stopped", "Listening stopped", true, ["type"]],
    ];
    for (const [problem, headline, mark, buttons] of cases) {
      const v = view({ kind: "off", problem });
      assert.deepEqual([v.headline, v.mark, v.buttons.map((b) => b.id)], [headline, mark, buttons], problem);
      assert.ok(v.buttons.some((b) => b.id === "type"), `${problem} offers typing`);
    }
    assert.equal(view({ kind: "off", problem: "blocked" }).buttons[0].primary, true);
    assert.equal(view({ kind: "off", problem: "offline" }, { online: false }).buttons[1].disabled, true, "Try again waits for a connection");
  });

  it("offers English and Hindi for a language this browser can't do, never the one that failed", () => {
    assert.deepEqual(view({ kind: "off", problem: "language" }, { spoken: ta }).buttons.map((b) => b.id), ["listen_en", "listen_hi", "type"]);
    assert.deepEqual(view({ kind: "off", problem: "language" }, { spoken: hi }).buttons.map((b) => b.id), ["listen_en", "type"]);
    // Hinglish and हिंदी listen the same way (hi-IN), so a Hinglish failure rules out हिंदी.
    assert.deepEqual(view({ kind: "off", problem: "language" }, { spoken: spokenById("hinglish") }).buttons.map((b) => b.id), ["listen_en", "type"]);
    assert.deepEqual(view({ kind: "off", problem: "language" }, { spoken: ta, off: ["hinglish"] }).buttons.map((b) => b.id), ["listen_en", "type"]);
    assert.deepEqual(view({ kind: "off", problem: "language" }, { spoken: en }).buttons.map((b) => b.id), ["listen_hi", "type"]);
    assert.deepEqual(view({ kind: "off", problem: "language" }, { spoken: ta, off: ["hi"] }).buttons.map((b) => b.id), ["listen_en", "type"]);
    const nothing = view({ kind: "off", problem: "nothing_heard" }, { spoken: ta });
    assert.match(nothing.line ?? "", /If you were speaking தமிழ், this browser may not listen in it\./);
    assert.deepEqual(nothing.buttons.map((b) => b.id), ["listen_en", "listen_hi", "type"]);
  });
});

describe("Ask's mic line", () => {
  const line = (mic: Mic, note: import("../components/platform/ask-mic.ts").AskMicNote = null, limit = false, spoken = en) => askMicLine({ mic, note, spoken, off: [], limit });
  it("says when it's getting the mic, when it's slow and when it listens", () => {
    assert.deepEqual(line({ kind: "starting", since: 0, slow: false }), { kind: "starting", text: "Getting your mic…" });
    assert.equal(line({ kind: "starting", since: 0, slow: true }).kind, "starting");
    assert.deepEqual(line({ kind: "live", since: 0, heardAt: null, quiet: false }), { kind: "live", text: "Listening in English. Tap the mic when you're done." });
  });
  it("asks them to check the words, never sends, and says nothing at the limit (Jump to does)", () => {
    assert.deepEqual(line(L.MIC_OFF, "check"), { kind: "note", text: "Check your question, then tap Ask.", mark: false, listen: [] });
    assert.deepEqual(line(L.MIC_OFF, "check", true), { kind: "none" });
  });
  it("names each failure, and offers other languages when it's the language", () => {
    assert.deepEqual(line(L.MIC_OFF, "language", false, ta), { kind: "note", text: "This browser can't listen in தமிழ்.", mark: false, listen: ["en", "hi"] });
    assert.deepEqual(line(L.MIC_OFF, "blocked"), { kind: "note", text: "Your mic is blocked for this site. Type your question instead.", mark: true, listen: [] });
    assert.deepEqual(line(L.MIC_OFF, "nothing_heard"), { kind: "note", text: "Didn't hear anything. Try again, or type it.", mark: true, listen: [] });
    assert.equal(line(L.MIC_OFF, "offline").kind, "note");
  });
  it("names a pick outside English, Hinglish and हिंदी while idle, since it decides the answer's language", () => {
    assert.deepEqual(line(L.MIC_OFF, null, false, ta), { kind: "idle", text: "The mic listens in தமிழ்." });
    assert.deepEqual(line(L.MIC_OFF, null, true, ta), { kind: "idle", text: "The mic listens in தமிழ்." });
    for (const s of [en, hi, spokenById("hinglish")]) assert.deepEqual(line(L.MIC_OFF, null, false, s), { kind: "none" });
    assert.equal(line(L.MIC_OFF, "check", false, ta).kind, "note");
  });
});

describe("voice words", () => {
  it("say which languages to try instead", () => {
    assert.equal(V.languageLine(ta), "Speak in English or Hindi instead, or type in Tamil. Replies come back in the language you type.");
    assert.equal(V.languageLine(hi), "Speak in English instead, or type in Hindi. Replies come back in the language you type.");
    assert.equal(V.languageLine(ta, ["en", "hi"]), "Type in Tamil instead. Replies come back in the language you type.");
    // Hinglish couldn't listen earlier this visit, so Hindi (the same hi-IN engine) isn't offered.
    assert.equal(V.languageLine(ta, ["hinglish"]), "Speak in English instead, or type in Tamil. Replies come back in the language you type.");
    assert.equal(V.languageLine(spokenById("hinglish")), "Speak in English instead, or type in Hinglish. Replies come back in the language you type.");
    assert.equal(V.mayNotListen(en), null);
  });
  it("never claim accuracy, and keep the voice privacy line", () => {
    const all = JSON.stringify(V.SAY_COPY) + JSON.stringify(V.ASK_MIC_COPY);
    assert.doesNotMatch(all, /accura/i);
    assert.match(V.SAY_COPY.privacy, /We only receive the words\./);
  });
});
