// One listening session with the browser's speech recogniser, as a pure state machine, so
// every engine's quirks can be tested in Node. useRecognizer.ts feeds it the recogniser's
// events and a clock tick, and does what each step asks of the engine.
//
// Why a machine at all: the screen must never say "Speak now" before the recogniser has
// really started (its `start` or `audiostart` event), and it must notice when one never
// does. Engines differ in how they fail, and the screen has to come back from all of them:
// - Chrome fires `error`, then `end`.
// - Safari and every iPhone browser (WebKit) fire `error` and never `end`. A language the
//   iPhone can't transcribe fails as `service-not-allowed`, in the permission step
//   (WebKit: SpeechRecognitionPermissionManager.cpp, "Speech recognition service is not
//   available"; SpeechRecognition.cpp's didError doesn't fire end).
// - Sometimes nothing comes back at all: no start, no error, no end. Then the session
//   says it's slow after START_SLOW_MS, and a fresh recogniser is the way out.
// An error is final: nothing waits for an `end` after it.

import { fitScript, spokenById, type Spoken, type SpokenId } from "@/lib/domain/speech";

/** "Still getting your mic…" after this long without the recogniser starting. */
export const START_SLOW_MS = 4000;
/** Live this long without a word: "Speak a little louder, or check the language". */
export const QUIET_MS = 5000;
/** Live this long without a word: stop, free the mic, and say nothing was heard. */
export const NOTHING_MS = 10_000;
/** A session ends by itself after this long, so a mic left open in a pocket shuts. */
export const SESSION_MAX_MS = 90_000;
/** A stop that the engine never confirms is given up after this long. */
export const STOP_GRACE_MS = 1500;
/** Taps on the big control this close to the last one are ignored (a nervous double tap). */
export const REPEAT_TAP_MS = 600;

/** Why listening stopped, when it wasn't the person's own choice. */
export type MicProblem =
  /** `not-allowed`: the mic is blocked for this site. */
  | "blocked"
  /** `service-not-allowed` for a language browsers usually listen in: on iPhone, Dictation is off. */
  | "dictation_off"
  /** This browser can't listen in the language picked. */
  | "language"
  /** No connection (`network`, or offline before starting). */
  | "offline"
  /** `audio-capture`: no microphone found. */
  | "no_mic"
  /** `no-speech`, or live for NOTHING_MS, or the recogniser ended, without a word. */
  | "nothing_heard"
  /** Anything else: the browser aborted, the recogniser ended before it started, a new error. */
  | "stopped";

export type Mic =
  | { kind: "off"; problem: MicProblem | null }
  /** `start()` called; the recogniser hasn't said it's listening yet. */
  | { kind: "starting"; since: number; slow: boolean }
  /** Between the recogniser's start and its end or error. `heardAt`: the last result with words. */
  | { kind: "live"; since: number; heardAt: number | null; quiet: boolean }
  /** Asked to stop; the last words can still land before `end`. */
  | { kind: "stopping"; since: number; problem: MicProblem | null };

export type MicEvent =
  | { type: "begin"; at: number }
  /** The recogniser's `start` or `audiostart`, whichever comes first. */
  | { type: "live"; at: number }
  /** A result with words in it (interim counts). */
  | { type: "heard"; at: number }
  /** Stop and keep the last words. `problem` says why, when it wasn't the person's tap. */
  | { type: "stop"; at: number; problem?: MicProblem | null }
  /** Drop it: nothing more from this recogniser counts. */
  | { type: "abort"; problem?: MicProblem | null }
  | { type: "error"; problem: MicProblem }
  | { type: "end" }
  | { type: "tick"; at: number };

export type MicOptions = {
  /** Stop by itself after this much silence once there are words (Ask). Fuel's pause is autolog's. */
  stopAfterSilenceMs?: number;
};

export const MIC_OFF: Mic = { kind: "off", problem: null };

/** Whether the recogniser is (or may soon be) holding the mic. */
export const micBusy = (m: Mic) => m.kind !== "off";

export function micStep(m: Mic, e: MicEvent, opts: MicOptions = {}): Mic {
  switch (e.type) {
    case "begin":
      return { kind: "starting", since: e.at, slow: false };
    case "live":
      return m.kind === "starting" ? { kind: "live", since: e.at, heardAt: null, quiet: false } : m;
    case "heard":
      if (m.kind === "live") return { ...m, heardAt: e.at, quiet: false };
      // Words before the start event: it's listening, whatever it said.
      if (m.kind === "starting") return { kind: "live", since: e.at, heardAt: e.at, quiet: false };
      return m;
    case "stop":
      return m.kind === "starting" || m.kind === "live" ? { kind: "stopping", since: e.at, problem: e.problem ?? null } : m;
    case "abort":
      return m.kind === "off" ? m : { kind: "off", problem: e.problem ?? null };
    case "error":
      if (m.kind === "off") return m;
      // Stopping: the words are in, and an error now (aborted, no-speech) changes nothing.
      if (m.kind === "stopping") return { kind: "off", problem: m.problem };
      return { kind: "off", problem: e.problem };
    case "end":
      if (m.kind === "starting") return { kind: "off", problem: "stopped" };
      if (m.kind === "live") return { kind: "off", problem: m.heardAt == null ? "nothing_heard" : null };
      if (m.kind === "stopping") return { kind: "off", problem: m.problem };
      return m;
    case "tick":
      return tick(m, e.at, opts);
  }
}

function tick(m: Mic, at: number, opts: MicOptions): Mic {
  if (m.kind === "starting") return !m.slow && at - m.since >= START_SLOW_MS ? { ...m, slow: true } : m;
  if (m.kind === "stopping") return at - m.since >= STOP_GRACE_MS ? { kind: "off", problem: m.problem } : m;
  if (m.kind !== "live") return m;
  if (at - m.since >= SESSION_MAX_MS) return { kind: "stopping", since: at, problem: null };
  if (m.heardAt == null) {
    if (at - m.since >= NOTHING_MS) return { kind: "off", problem: "nothing_heard" };
    if (!m.quiet && at - m.since >= QUIET_MS) return { ...m, quiet: true };
    return m;
  }
  if (opts.stopAfterSilenceMs != null && at - m.heardAt >= opts.stopAfterSilenceMs) return { kind: "stopping", since: at, problem: null };
  return m;
}

/** What a step asks of the engine: `stop` (keep late words) or `abort` (drop it). */
export function micEffect(before: Mic, after: Mic): "stop" | "abort" | null {
  if (after.kind === "stopping" && before.kind !== "stopping") return "stop";
  if (after.kind === "off" && before.kind !== "off") return "abort";
  return null;
}

/** Languages nearly every browser that listens at all can listen in. */
export const LISTENS_WIDELY: readonly SpokenId[] = ["en", "hinglish", "hi"];

/** What a session knew when its recogniser failed. */
export type ErrorContext = {
  lang: SpokenId;
  /** Picks that started listening in this browser this visit. */
  workedIn: readonly SpokenId[];
  /** This recogniser had started listening (its start, audiostart or words) before the error. */
  live?: boolean;
  /** navigator.onLine when it failed. */
  online?: boolean;
};

/** What a recogniser's error code means here. Only "language" is remembered for the visit. */
export function micProblemOf(error: string, ctx: ErrorContext): MicProblem {
  switch (error) {
    case "not-allowed":
      return "blocked";
    case "language-not-supported":
      return "language";
    case "service-not-allowed":
      return serviceNotAllowed(ctx);
    case "network":
      return "offline";
    case "audio-capture":
      return "no_mic";
    case "no-speech":
      return "nothing_heard";
    default:
      return "stopped";
  }
}

/**
 * iPhone sends `service-not-allowed` for three things (WebKit: SpeechRecognitionPermissionManager.cpp,
 * SpeechRecognizer.cpp, WebSpeechRecognizerTask.mm), and only one of them lasts:
 * - The phone can't transcribe the language. Before the start, for a language outside
 *   English, Hinglish and हिंदी, which every iPhone can transcribe.
 * - Dictation is off. Before the start, while nothing has listened this visit (it's off
 *   for the whole device, so anything that listened says it's on).
 * - The speech service can't be reached right now (a weak signal; Hindi needs Apple's
 *   servers). Before the start ("not available", "failed to start") or during it
 *   ("becomes unavailable"). This one passes, so it must never rule a language out.
 * Before 2026-11-22 the last read as the language whenever another language had listened,
 * and the language stayed unusable until the tab was closed.
 */
function serviceNotAllowed({ lang, workedIn, live = false, online = true }: ErrorContext): MicProblem {
  if (!online) return "offline";
  // It listened in this language (this session, or with this engine earlier): the language is fine.
  if (live || workedIn.some((id) => sameEngine(id, lang))) return "stopped";
  if (!LISTENS_WIDELY.includes(lang)) return "language";
  return workedIn.length ? "stopped" : "dictation_off";
}

/**
 * Two picks that listen with the same tag share the browser's engine: one working says nothing
 * about the other's language, and one failing for its language rules out both. Hinglish and
 * हिंदी both listen in hi-IN (Hinglish was on en-IN for a few hours on 2026-11-22).
 */
export const sameEngine = (a: SpokenId, b: SpokenId) => a === b || spokenById(a).speech === spokenById(b).speech;

/** Whether this browser already said it can't listen the way `id` does: it, or a pick sharing its engine, is on the "can't" list. */
export const ruledOut = (id: SpokenId, off: readonly SpokenId[]) => off.some((o) => sameEngine(o, id));

/** A problem that says something about the language rather than the device or the moment. */
export const languageProblem = (p: MicProblem | null) => p === "language";

/** One recogniser result list as words: what's settled, and the tail still being guessed. */
export type Heard = { final: string; interim: string };

/**
 * One phrase after another. Chrome starts each later phrase with a space. An engine that doesn't
 * (QA's WebKit-like stand-in; whether iPhone does is unconfirmed) ran "two rotis and dal" and
 * "and curd" together as "daland curd" in the box and the meal, while the card showed a space.
 */
const nextPhrase = (so: string, more: string) => (so && more && !/\s$/.test(so) && !/^\s/.test(more) ? `${so} ${more}` : so + more);

export function heardOf(results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>): Heard {
  let final = "";
  let interim = "";
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.isFinal) final = nextPhrase(final, r[0]?.transcript ?? "");
    else interim = nextPhrase(interim, r[0]?.transcript ?? "");
  }
  return dropEcho({ final, interim });
}

// A screen reader saying "Speak now" can be heard by the mic. One leading "speak now" goes.
const ECHO = /^\s*speak now\b[\s,.!]*/i;
function dropEcho(h: Heard): Heard {
  if (ECHO.test(h.final)) return { ...h, final: h.final.replace(ECHO, "") };
  if (!h.final.trim() && ECHO.test(h.interim)) return { ...h, interim: h.interim.replace(ECHO, "") };
  return h;
}

/**
 * What a session heard, in the script of the language it listened in. Hinglish listens in
 * hi-IN, which writes Devanagari, and a browser that ignores en-IN can too; English and
 * Hinglish then show and send it in Latin letters ("do roti aur chane ki sabji"), as people
 * picking them expect.
 */
export function heardInScript(h: Heard, spoken: Spoken): Heard {
  const final = fitScript(h.final, spoken);
  const interim = fitScript(h.interim, spoken);
  return final === h.final && interim === h.interim ? h : { final, interim };
}

/** The words a session heard, in one string. */
export const heardText = (h: Heard) => nextPhrase(h.final, h.interim).replace(/\s+/g, " ").trim();

/**
 * What goes in the box: the words already there, a space, then what this session heard,
 * cut to `max` characters (code points, so no letter is split). `full` says the cap was met.
 */
export function joinWords(before: string, heard: string, max: number): { text: string; full: boolean } {
  const b = before.trim();
  const h = heard.trim();
  const joined = b && h ? `${b} ${h}` : b || h;
  const chars = [...joined];
  return chars.length >= max ? { text: chars.slice(0, max).join(""), full: true } : { text: joined, full: false };
}
