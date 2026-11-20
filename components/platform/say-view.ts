// What Fuel's Say card shows, worked out from three facts: the recogniser's session
// (listen-state.ts), the auto-log countdown (autolog.ts) and the words so far. Pure, so
// every row of the voice UX spec's state table (§3) can be tested without a browser.
import type { Spoken, SpokenId } from "@/lib/domain/speech";
import type { AutoLog } from "./autolog";
import type { Mic, MicProblem } from "./listen-state";
import { SAY_COPY as C, cantListenIn, languageLine, listenInstead, mayNotListen } from "./voice-copy";

export type SayButtonId = "type" | "edit" | "keep" | "retry" | "log" | "listen_en" | "listen_hi";
export type SayButton = { id: SayButtonId; primary?: boolean; disabled?: boolean };

/** What a tap on the big control does now. */
export type SquareAction = "none" | "finish" | "log" | "listen";

export type SayKind =
  | "starting"
  | "ready"
  | "hearing"
  | "counting"
  | "review"
  | "logging"
  | "nothing_heard"
  | "blocked"
  | "dictation_off"
  | "language"
  | "offline"
  | "no_mic"
  | "stopped";

/** The tick ring: faint while starting, the voice while live, a clock while counting, dim otherwise. */
export type RingMode = "faint" | "live" | "count" | "dim";

export type SayView = {
  kind: SayKind;
  headline: string;
  /** The "!" glyph before the headline: something went wrong. Limits (nothing heard, a language) don't get it. */
  mark: boolean;
  /** Filled means live: the square is white only while the recogniser really listens. */
  live: boolean;
  square: { label: string; action: SquareAction; number: number | null };
  /** Under the square: what a tap on it does. */
  hint: string | null;
  /** Keyboards: the hint adds ", or press Space". */
  keyHint: boolean;
  /** The extra line under the transcript area. */
  line: string | null;
  /** An error that came with words: its line, marked, above the transcript. */
  note: { text: string; mark: boolean } | null;
  /** The transcript area: the words, or the placeholder while waiting for them. */
  words: "show" | "placeholder" | "none";
  buttons: SayButton[];
  ring: RingMode;
  /** For the polite live region. The same text twice isn't read twice. */
  announce: string;
};

export type SayInput = {
  mic: Mic;
  auto: AutoLog;
  /** The whole box: words from before this card, then what it heard. */
  words: string;
  spoken: Spoken;
  /** The browser is online now (Try again waits for a connection). */
  online: boolean;
  /** Microphone permission will be asked for (permissions.query said "prompt"). */
  prompt: boolean;
  /** Languages this browser said it can't listen in, this visit. */
  off: readonly SpokenId[];
};

const listenButtons = (ids: SpokenId[]): SayButton[] => ids.map((id) => ({ id: id === "en" ? "listen_en" : "listen_hi" }));

function problemView(p: MicProblem, i: SayInput): SayView {
  const base = { live: false, keyHint: false, note: null, words: "none" as const, ring: "dim" as const };
  const inert = { label: C.squareOff, action: "none" as const, number: null };
  const retry = { label: C.squareRetry, action: "listen" as const, number: null };
  switch (p) {
    case "nothing_heard": {
      const may = mayNotListen(i.spoken);
      return {
        ...base,
        kind: "nothing_heard",
        headline: C.nothing,
        mark: false,
        square: retry,
        hint: C.retryHint,
        line: may ? `${C.nothingLine} ${may}` : C.nothingLine,
        buttons: [...(may ? listenButtons(listenInstead(i.spoken.id, i.off)) : []), { id: "type" }],
        announce: `${C.nothing}.`,
      };
    }
    case "language":
      return {
        ...base,
        kind: "language",
        headline: cantListenIn(i.spoken),
        mark: false,
        square: inert,
        hint: null,
        line: languageLine(i.spoken, i.off),
        buttons: [...listenButtons(listenInstead(i.spoken.id, i.off)), { id: "type" }],
        announce: `${cantListenIn(i.spoken)}.`,
      };
    case "blocked":
      return { ...base, kind: "blocked", headline: C.blocked, mark: true, square: inert, hint: null, line: C.blockedLine, buttons: [{ id: "type", primary: true }, { id: "retry" }], announce: `${C.blocked}.` };
    case "dictation_off":
      return {
        ...base,
        kind: "dictation_off",
        headline: C.dictationOff,
        mark: true,
        square: inert,
        hint: null,
        line: C.dictationLine,
        buttons: [{ id: "type", primary: true }, { id: "retry" }],
        announce: `${C.dictationOff}.`,
      };
    case "offline":
      return {
        ...base,
        kind: "offline",
        headline: C.offline,
        mark: true,
        square: inert,
        hint: null,
        line: C.offlineLine,
        buttons: [{ id: "type", primary: true }, { id: "retry", disabled: !i.online }],
        announce: `${C.offline}.`,
      };
    case "no_mic":
      return { ...base, kind: "no_mic", headline: C.noMic, mark: true, square: inert, hint: null, line: C.noMicLine, buttons: [{ id: "retry" }, { id: "type" }], announce: `${C.noMic}.` };
    case "stopped":
      return { ...base, kind: "stopped", headline: C.stopped, mark: true, square: retry, hint: C.retryHint, line: C.stoppedLine, buttons: [{ id: "type" }], announce: `${C.stopped}.` };
  }
}

/** Problems after which the same tap can't simply listen again. */
const dead = (p: MicProblem | null, online: boolean) => p === "blocked" || p === "dictation_off" || p === "language" || (p === "offline" && !online);

function noteFor(p: MicProblem, i: SayInput): { text: string; mark: boolean } {
  const v = problemView(p, { ...i, words: "" });
  return { text: v.headline, mark: v.mark };
}

export function sayView(i: SayInput): SayView {
  const { mic, auto } = i;
  const hasWords = i.words.trim() !== "";
  const typeOrEdit: SayButton = { id: hasWords ? "edit" : "type" };

  if (auto.kind === "logging")
    return {
      kind: "logging",
      headline: C.counting,
      mark: false,
      live: false,
      square: { label: C.squareLog, action: "none", number: null },
      hint: null,
      keyHint: false,
      line: null,
      note: null,
      words: "show",
      buttons: [],
      ring: "dim",
      announce: "",
    };

  if (auto.kind === "counting") {
    const live = mic.kind === "live";
    return {
      kind: "counting",
      headline: C.counting,
      mark: false,
      live,
      square: { label: C.squareLog, action: "log", number: auto.left },
      hint: C.countHint,
      keyHint: false,
      line: auto.by === "pause" && live ? C.sayMore : null,
      note: null,
      words: "show",
      buttons: [{ id: "keep" }, { id: "edit" }],
      ring: "count",
      announce: C.sayCounting,
    };
  }

  if (mic.kind === "starting")
    return {
      kind: "starting",
      headline: mic.slow ? C.startingSlow : C.starting,
      mark: false,
      live: false,
      square: { label: C.squareStarting, action: "none", number: null },
      hint: null,
      keyHint: false,
      line: mic.slow ? C.slowLine : i.prompt ? C.promptLine : null,
      note: null,
      words: hasWords ? "show" : "none",
      buttons: mic.slow ? [{ id: "retry" }, typeOrEdit] : [typeOrEdit],
      ring: "faint",
      announce: C.sayStarting,
    };

  if (mic.kind === "live") {
    const heard = mic.heardAt != null;
    return {
      kind: heard ? "hearing" : "ready",
      headline: heard ? C.hearing : C.ready,
      mark: false,
      live: true,
      square: { label: C.squareDone, action: "finish", number: null },
      hint: C.readyHint,
      keyHint: true,
      line: !heard && mic.quiet ? C.quietLine : null,
      note: null,
      words: hasWords ? "show" : "placeholder",
      buttons: [typeOrEdit],
      ring: "live",
      announce: C.sayLive,
    };
  }

  // Off, or finishing: with words it's ready to log, whatever stopped it.
  const problem = mic.problem;
  if (hasWords) {
    const stuck = dead(problem, i.online);
    return {
      kind: "review",
      headline: C.review,
      mark: false,
      live: false,
      square: stuck ? { label: C.squareOff, action: "none", number: null } : { label: C.squareKeep, action: "listen", number: null },
      hint: stuck ? null : C.reviewHint,
      keyHint: false,
      line: null,
      note: problem ? noteFor(problem, i) : null,
      words: "show",
      buttons: [{ id: "log", primary: true }, { id: "edit" }, ...(problem === "language" ? listenButtons(listenInstead(i.spoken.id, i.off)) : [])],
      ring: "dim",
      announce: C.sayReview,
    };
  }
  return problemView(problem ?? "nothing_heard", i);
}

