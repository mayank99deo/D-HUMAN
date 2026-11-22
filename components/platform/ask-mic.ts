// What Ask's mic says, in the one line above the box (voice UX spec §7). Pure, so each
// state can be tested without a browser. The mic fills the box and never sends: a question
// counts against the day only when the person taps Ask.
import type { Spoken, SpokenId } from "@/lib/domain/speech";
import type { Mic, MicProblem } from "./listen-state";
import { ASK_MIC_COPY as C, askCantListen, listenInstead } from "./voice-copy";

/** Why the mic last stopped, shown until they type, send or tap the mic again. */
export type AskMicNote = "check" | MicProblem | null;

export type AskMicLine =
  | { kind: "none" }
  | { kind: "starting"; text: string }
  | { kind: "live"; text: string }
  | { kind: "idle"; text: string }
  | { kind: "note"; text: string; mark: boolean; listen: SpokenId[] };

const EVERYDAY: readonly SpokenId[] = ["en", "hinglish", "hi"];

/**
 * What a tap on the mic does now: "I'm done" while it listens; cancel a start that hasn't
 * come through yet; otherwise listen. That covers a start slow to come (a fresh recogniser,
 * like Fuel's Try again) and a stop still finishing, when they've more to say.
 */
export function askMicTap(mic: Mic): "stop" | "cancel" | "listen" {
  if (mic.kind === "live") return "stop";
  if (mic.kind === "starting" && !mic.slow) return "cancel";
  return "listen";
}

/** The mic button's name, for what a tap on it does. */
export function askMicLabel(mic: Mic): string {
  if (mic.kind === "live") return C.labelLive;
  if (mic.kind === "starting") return mic.slow ? C.labelRetry : C.labelStarting;
  return C.label;
}

const PROBLEM_WORDS: Record<Exclude<MicProblem, "language">, string> = {
  nothing_heard: C.nothing,
  blocked: C.blocked,
  dictation_off: C.dictationOff,
  offline: C.offline,
  no_mic: C.noMic,
  stopped: C.stopped,
};

export function askMicLine(i: { mic: Mic; note: AskMicNote; spoken: Spoken; off: readonly SpokenId[]; limit: boolean; prompt?: boolean }): AskMicLine {
  // While it starts: the browser's microphone question first, as Fuel's Say card does; after 4 s, a way out.
  if (i.mic.kind === "starting") return { kind: "starting", text: i.mic.slow ? C.slow : i.prompt ? C.prompt : C.starting };
  if (i.mic.kind === "live" || i.mic.kind === "stopping") return { kind: "live", text: C.live(i.spoken) };
  // A pick outside English, Hinglish and हिंदी (often left from one try in Fuel) decides
  // the answer's language, so the idle mic says which it is, with Change beside it.
  if (!i.note) return EVERYDAY.includes(i.spoken.id) ? { kind: "none" } : { kind: "idle", text: C.idle(i.spoken) };
  // At the limit there's no Ask button: the box finds screens, and Jump to says where.
  if (i.note === "check") return i.limit ? { kind: "none" } : { kind: "note", text: C.check, mark: false, listen: [] };
  if (i.note === "language") return { kind: "note", text: askCantListen(i.spoken), mark: false, listen: listenInstead(i.spoken.id, i.off) };
  return { kind: "note", text: PROBLEM_WORDS[i.note], mark: true, listen: [] };
}
