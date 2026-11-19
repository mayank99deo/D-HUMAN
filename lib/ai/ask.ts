import "server-only";
import type { AskAboutResolved, AskAnswer, AskData, AskInput, AskReply } from "@/lib/ask/types";

// Ask's AI side. Lane B owns this file and replaces these bodies; the signatures are the
// contract Lane A's route calls (docs/team/specs/2026-11-19-ask-build.md §16). This stub
// exists only so the route compiles before Lane B lands. It throws if called, and Ask is
// never shown to anyone while it's here (the route isn't built yet either).

/**
 * Code-only replies, decided before any model call, from the question and the person's
 * data: the crisis word list, the emergency word list, and an urgent-flagged marker named
 * in the question or the "Ask about this" context. Pure and synchronous. Null means
 * "ask the model". The route saves a non-null reply as a free turn (not counted).
 */
export function askPreCheck(input: { question: string; about: AskAboutResolved | null; data: AskData }): AskReply | null {
  void input;
  throw new Error("Ask: Lane B hasn't built askPreCheck yet");
}

/**
 * Everything after the claim: the pack, the call (live or mock), the lenient parse, the
 * language retry, the safety floor, the output filters and the link ids. Honours
 * `signal` (the route's 20 s deadline) and returns { ok: false, error: "timeout" } when
 * it fires. Never throws for refusals, bad output or Anthropic errors.
 */
export async function answerAsk(input: AskInput, opts: { signal: AbortSignal }): Promise<AskAnswer> {
  void input;
  void opts;
  throw new Error("Ask: Lane B hasn't built answerAsk yet");
}
