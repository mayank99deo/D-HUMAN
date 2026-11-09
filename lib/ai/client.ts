import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

// Every Claude call in the platform goes through here.
// - Model: CLAUDE_MODEL, default Claude Opus 5.5.
// - Refusals: server-side fallback ("default") re-runs a policy decline on the
//   model Anthropic recommends for that category, inside the same call.
// - Mock mode (local only): with no ANTHROPIC_API_KEY, `D_HUMAN_AI_MOCK=1`
//   returns illustrative results so the screens can be built and tested.

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type AiMode = "live" | "mock" | "off";

export function aiMode(): AiMode {
  if (process.env.ANTHROPIC_API_KEY) return "live";
  if (process.env.D_HUMAN_AI_MOCK === "1" && !process.env.VERCEL) return "mock";
  return "off";
}

export class AiUnavailableError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set");
  }
}

export class AiRefusalError extends Error {
  constructor(public category: string | null) {
    super(`Claude declined the request${category ? ` (${category})` : ""}`);
  }
}

let client: Anthropic | null = null;
export function anthropic() {
  if (aiMode() !== "live") throw new AiUnavailableError();
  client ??= new Anthropic({ maxRetries: 3 });
  return client;
}

export function assertComplete(message: BetaMessage) {
  if (message.stop_reason === "refusal") throw new AiRefusalError(message.stop_details?.category ?? null);
  if (message.stop_reason === "max_tokens") throw new Error("Claude ran out of room before finishing");
}

export const textOf = (content: BetaContentBlock[]) =>
  content
    .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

// Web search turns can pause on long server-side work; resend until finished.
export async function runWithWebSearch(params: {
  system: string;
  prompt: string;
  maxUses: number;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
}) {
  const messages: BetaMessageParam[] = [{ role: "user", content: params.prompt }];
  for (let turn = 0; turn < 4; turn++) {
    const message = await anthropic()
      .beta.messages.stream({
        model: MODEL,
        max_tokens: params.maxTokens ?? 32000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: params.effort },
        system: params.system,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: params.maxUses }],
        messages,
      })
      .finalMessage();
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    assertComplete(message);
    return { text: textOf(message.content), model: message.model };
  }
  throw new Error("Web search did not finish");
}

export { extractJson } from "./json";

export function languageRule(language?: string | null) {
  if (language === "hi")
    return "Write every sentence meant for the person in simple, everyday Hindi (Devanagari). Keep marker names, units, numbers and brand names in English.";
  if (language === "hinglish")
    return "Write every sentence meant for the person in Hinglish: Hindi in Latin script mixed with English, the way people text in India. Keep it simple.";
  return "Write in plain, simple English that someone in a small Indian town would follow easily. Short sentences, no jargon.";
}

export const VOICE = `You write for D-Human, an Indian preventive-health platform: test first, supplement only where markers point, retest.
Voice: warm, direct, specific, never preachy. Short sentences. Talk to the person as "you".
Rules you never break:
- You read lab markers; you do not diagnose. Never say someone "has" a disease. Use "markers", "range", "risk", "worth showing a doctor".
- Never invent numbers. Use only the values given to you.
- When something needs a doctor, say so plainly and kindly, without alarm.
- Food first: suggest common Indian foods before any supplement.`;
