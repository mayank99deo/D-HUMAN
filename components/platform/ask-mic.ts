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
  | { kind: "note"; text: string; mark: boolean; listen: SpokenId[] };

const PROBLEM_WORDS: Record<Exclude<MicProblem, "language">, string> = {
  nothing_heard: C.nothing,
  blocked: C.blocked,
  dictation_off: C.dictationOff,
  offline: C.offline,
  no_mic: C.noMic,
  stopped: C.stopped,
};

export function askMicLine(i: { mic: Mic; note: AskMicNote; spoken: Spoken; off: readonly SpokenId[]; limit: boolean }): AskMicLine {
  if (i.mic.kind === "starting") return { kind: "starting", text: i.mic.slow ? C.slow : C.starting };
  if (i.mic.kind === "live" || i.mic.kind === "stopping") return { kind: "live", text: C.live(i.spoken) };
  if (!i.note) return { kind: "none" };
  // At the limit there's no Ask button: the box finds screens, and Jump to says where.
  if (i.note === "check") return i.limit ? { kind: "none" } : { kind: "note", text: C.check, mark: false, listen: [] };
  if (i.note === "language") return { kind: "note", text: askCantListen(i.spoken), mark: false, listen: listenInstead(i.spoken.id, i.off) };
  return { kind: "note", text: PROBLEM_WORDS[i.note], mark: true, listen: [] };
}
