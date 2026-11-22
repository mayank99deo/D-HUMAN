// The browser's speech recogniser for one listening control (Fuel's Say card, Ask's mic),
// without React, so its lifetime can be tested in Node against stand-ins that behave like
// each browser (tests/voice-engine.test.ts). useRecognizer.ts wraps one per control.
//
// The rules:
// - Each start makes a fresh recogniser, and only the current one may write: one replaced,
//   stopped or dropped stays quiet.
// - A new recogniser waits for the last one that held the mic to let it go (its `end`), or
//   HANDOVER_MS. This holds after an abort too (Edit, Close, a log), when the screen has
//   already moved on. WebKit's server queues setInactive() for "the current recogniser"
//   when an old one ends (SpeechRecognitionServer.cpp, handleRequest). A new one started
//   before that runs receives it: it then ignores stop and abort, and keeps the mic on
//   until the next start.
// - What an error means is decided once (micProblemOf), from what this session knew: whether
//   it went live, whether the browser is online, and what listened this visit. Only a
//   lasting language problem is remembered for the visit.
import type { Spoken, SpokenId } from "@/lib/domain/speech";
import { MIC_OFF, heardOf, languageProblem, micEffect, micProblemOf, micStep, ruledOut, type Heard, type Mic, type MicEvent, type MicOptions, type MicProblem } from "./listen-state";

/** Minimal typing for the browser's speech recognition, which TypeScript doesn't ship. */
export type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
};
export type RecognitionCtor = new () => Recognition;

/**
 * Longest wait for the last recogniser to let go of the mic before a new one starts. Chrome
 * lets go in milliseconds; WebKit after its task is cancelled, which on a slow connection
 * can take a while. The screen says "Getting your mic…" meanwhile.
 */
export const HANDOVER_MS = 1000;

/** This visit's record of what listened and what can't (spoken-pick.ts). */
export type VoiceRecordStore = {
  read: () => { ok: readonly SpokenId[]; off: readonly SpokenId[] };
  listened: (id: SpokenId) => void;
  cantListen: (id: SpokenId) => void;
};

/** What the engine needs from the browser. Injected, so tests can stand in for it. */
export type VoiceEnv = {
  ctor: () => RecognitionCtor | null;
  online: () => boolean;
  now: () => number;
  after: (fn: () => void, ms: number) => void;
  record: VoiceRecordStore;
};

/** What the recogniser reports, for the meters (VoiceActivity in VoiceMeter.tsx). */
export type ActivitySink = {
  note: (kind: "audiostart" | "speechstart" | "speechend" | "result" | "end") => void;
  reset: () => void;
  captureFailed: () => void;
};

export type RecognizerEvents = {
  /** The recogniser started listening (its `start` or `audiostart`, or words before either). */
  onLive?: (at: number) => void;
  /** New words in this session. `final`: the newest result is settled. */
  onHeard?: (heard: Heard, e: { final: boolean; at: number }) => void;
  onSpeechEnd?: (at: number) => void;
  /** The recogniser ended (after a stop, or by itself). Not called after an error or abort. */
  onEnded?: (at: number) => void;
  /** Listening stopped for a reason that isn't the person's own choice. */
  onProblem?: (problem: MicProblem) => void;
  /** The session is over, however it ended; `problem` is null when nothing went wrong. */
  onOff?: (problem: MicProblem | null) => void;
};

export class VoiceEngine {
  /** The session now. */
  mic: Mic = MIC_OFF;
  /** The recogniser whose events count. */
  private current: Recognition | null = null;
  /** The last recogniser started that hasn't let go of the mic yet. */
  private holder: Recognition | null = null;
  /** The start waiting for `holder` to let go. A newer start replaces it. */
  private waiting: (() => void) | null = null;
  private events: RecognizerEvents = {};
  private options: MicOptions = {};
  private readonly env: VoiceEnv;
  private readonly activity: ActivitySink;
  private readonly changed: (mic: Mic) => void;

  /** `changed`: the session changed (for React state). */
  constructor(env: VoiceEnv, activity: ActivitySink, changed: (mic: Mic) => void = () => {}) {
    this.env = env;
    this.activity = activity;
    this.changed = changed;
  }

  /** The handlers and options to use from now on (the latest render's). */
  setHandlers(events: RecognizerEvents, options: MicOptions = {}) {
    this.events = events;
    this.options = options;
  }

  /**
   * Start listening in `spoken`, in a fresh recogniser. Call it inside the tap that asks for
   * it, so the first permission prompt can show.
   */
  start(spoken: Spoken) {
    // The old one goes quiet: its late events fail the `mine` check.
    const old = this.current;
    this.current = null;
    this.waiting = null;
    old?.abort();
    this.step({ type: "begin", at: this.env.now() });
    // Known not to work here this visit, or no connection: say so without asking the engine.
    if (ruledOut(spoken.id, this.env.record.read().off)) return void this.step({ type: "error", problem: "language" });
    if (!this.env.online()) return void this.step({ type: "error", problem: "offline" });
    const Ctor = this.env.ctor();
    if (!Ctor) return void this.step({ type: "error", problem: "stopped" });

    const r = this.wire(new Ctor(), spoken);
    this.current = r;
    if (!this.holder) return this.launch(r);
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      if (this.waiting === go) this.waiting = null;
      this.launch(r);
    };
    this.waiting = go;
    this.env.after(go, HANDOVER_MS);
  }

  /** Stop listening and keep the last words, which can arrive just after. */
  stop(problem: MicProblem | null = null) {
    const r = this.current;
    this.step({ type: "stop", at: this.env.now(), problem });
    r?.stop();
  }

  /** Stop listening and drop anything still on its way. */
  abort(problem: MicProblem | null = null) {
    const r = this.current;
    this.current = null;
    this.waiting = null;
    r?.abort();
    this.activity.note("end");
    this.step({ type: "abort", problem });
  }

  /** The clock, while the session can change by itself: slow start, quiet, nothing heard, the cap. */
  tick() {
    const before = this.mic;
    const after = this.step({ type: "tick", at: this.env.now() });
    const effect = micEffect(before, after);
    if (effect === "stop") this.current?.stop();
    if (effect === "abort") {
      const r = this.current;
      this.current = null;
      r?.abort();
    }
  }

  /** Leaving for good: drop the recogniser, without telling anyone. */
  dispose() {
    const r = this.current;
    this.current = null;
    this.waiting = null;
    r?.abort();
  }

  private launch(r: Recognition) {
    if (this.current !== r) return;
    try {
      r.start();
      this.holder = r;
    } catch {
      // An engine that throws (a recogniser already running elsewhere): a clear "stopped", never a silent one.
      this.current = null;
      this.step({ type: "error", problem: "stopped" });
    }
  }

  /** `r` has let go of the mic: a start waiting on it can go. */
  private letGo(r: Recognition) {
    if (this.holder !== r) return;
    this.holder = null;
    this.waiting?.();
  }

  private wire(r: Recognition, spoken: Spoken): Recognition {
    r.lang = spoken.speech;
    r.interimResults = true;
    r.continuous = true;
    const mine = () => this.current === r;
    /** It started listening: the language was accepted, so a later error is about the moment. */
    let alive = false;
    const ev = () => this.events;
    this.activity.reset();

    const live = () => {
      alive = true;
      if (!mine()) return;
      this.activity.note("audiostart");
      this.cameAlive(this.mic, this.step({ type: "live", at: this.env.now() }), spoken.id);
    };
    r.onstart = live;
    r.onaudiostart = live;
    r.onsoundstart = r.onspeechstart = () => {
      if (mine()) this.activity.note("speechstart");
    };
    r.onspeechend = () => {
      if (!mine()) return;
      this.activity.note("speechend");
      ev().onSpeechEnd?.(this.env.now());
    };
    r.onresult = (e) => {
      alive = true;
      if (!mine()) return;
      const heard = heardOf(e.results);
      const at = this.env.now();
      this.activity.note("result");
      const latest = e.results[e.results.length - 1];
      if ((heard.final + heard.interim).trim()) this.cameAlive(this.mic, this.step({ type: "heard", at }), spoken.id);
      ev().onHeard?.(heard, { final: !!latest?.isFinal, at });
    };
    r.onerror = (e) => {
      // Before it started there's nothing to let go of; after, WebKit still has to cancel its task, and says so with an `end`.
      if (!alive) this.letGo(r);
      if (!mine()) return;
      const problem = micProblemOf(e.error, { lang: spoken.id, workedIn: this.env.record.read().ok, live: alive, online: this.env.online() });
      if (languageProblem(problem)) this.env.record.cantListen(spoken.id);
      if (e.error === "audio-capture") this.activity.captureFailed();
      this.activity.note("end");
      // Final: WebKit sends no `end` after an error before the start, so nothing waits for one.
      this.current = null;
      this.step({ type: "error", problem });
    };
    r.onend = () => {
      this.letGo(r);
      if (!mine()) return;
      this.activity.note("end");
      this.current = null;
      const after = this.step({ type: "end" });
      if (after.kind === "off" && !after.problem) ev().onEnded?.(this.env.now());
    };
    return r;
  }

  /** The session just went live: this language listens here, and the screen may buzz. */
  private cameAlive(before: Mic, after: Mic, id: SpokenId) {
    if (before.kind !== "starting" || after.kind !== "live") return;
    this.env.record.listened(id);
    this.events.onLive?.(this.env.now());
  }

  /** One step of the session. */
  private step(e: MicEvent): Mic {
    const before = this.mic;
    const after = micStep(before, e, this.options);
    if (after === before) return after;
    this.mic = after;
    this.changed(after);
    if (after.kind === "off" && before.kind !== "off") {
      const ev = this.events;
      if (after.problem) ev.onProblem?.(after.problem);
      ev.onOff?.(after.problem);
    }
    return after;
  }
}
