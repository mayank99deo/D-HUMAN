import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

// Every Claude call in the platform goes through here.
// - Models: each job gets the cheapest model that does it well (see MODELS).
//   CLAUDE_MODEL overrides all of them at once; CLAUDE_MODEL_<JOB> one job.
// - Refusals: on models that support it, server-side fallback ("default")
//   re-runs a policy decline on the recommended model inside the same call.
//   Haiku has no server-side fallback, so its calls don't ask for one.
// - Cost: every call logs its tokens, web searches and an estimated price.
// - Mock mode (local only): with no ANTHROPIC_API_KEY, `D_HUMAN_AI_MOCK=1`
//   returns illustrative results so the screens can be built and tested.

const pick = (job: string, fallback: string) => process.env[`CLAUDE_MODEL_${job}`] || process.env.CLAUDE_MODEL || fallback;

export const MODELS = {
  // Copying values off a lab report: transcription, so the fastest, cheapest model.
  extract: pick("EXTRACT", "claude-haiku-5-5"),
  // Writing the read: medical judgement, tone and the safety rules, so Sonnet.
  read: pick("READ", "claude-sonnet-5-5"),
  // Meals and the typical day: frequent and forgiving estimates.
  food: pick("FOOD", "claude-haiku-5-5"),
  // Wraps: short copy from numbers the app has already worked out.
  wrap: pick("WRAP", "claude-haiku-5-5"),
  // Web searches for events and brands need the newer search tool, which Haiku lacks.
  events: pick("EVENTS", "claude-sonnet-5-5"),
  stack: pick("STACK", "claude-sonnet-5-5"),
};
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Request fields for refusal fallback, where the model supports it.
export function fallbackFor(model: string): { betas?: string[]; fallbacks?: "default" } {
  return model.startsWith("claude-haiku") ? {} : { betas: [FALLBACK_BETA], fallbacks: "default" };
}

// USD per million tokens (input, output), for the cost estimate in logs. Haiku's
// rate is for prompts up to 100K tokens; web searches are $10 per thousand.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function logUsage(job: string, message: BetaMessage, startedAt?: number) {
  const u = message.usage;
  const [pin, pout] = PRICES[message.model] ?? [0, 0];
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const cost = (input * pin + u.output_tokens * pout) / 1e6 + searches * 0.01;
  const secs = startedAt ? ` ${((Date.now() - startedAt) / 1000).toFixed(1)}s` : "";
  console.info(`[ai] ${job} ${message.model} in=${input} out=${u.output_tokens}${searches ? ` searches=${searches}` : ""} ~$${cost.toFixed(4)}${secs}`);
}

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
  job: "events" | "stack";
  system: string;
  prompt: string;
  maxUses: number;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  /** Where the person is, so results lean local (Indian shops, Indian events). */
  where?: { city?: string | null; country?: string | null };
}) {
  const model = MODELS[params.job];
  const inIndia = !params.where?.country || /^india$/i.test(params.where.country);
  const userLocation = {
    type: "approximate" as const,
    city: params.where?.city || null,
    ...(inIndia ? { country: "IN", timezone: "Asia/Kolkata" } : {}),
  };
  const messages: BetaMessageParam[] = [{ role: "user", content: params.prompt }];
  for (let turn = 0; turn < 4; turn++) {
    const t0 = Date.now();
    const message = await anthropic()
      .beta.messages.stream({
        model,
        max_tokens: params.maxTokens ?? 32000,
        ...fallbackFor(model),
        output_config: { effort: params.effort },
        system: params.system,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: params.maxUses, user_location: userLocation }],
        messages,
      })
      .finalMessage();
    logUsage(params.job, message, t0);
    logSearches(params.job, message);
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    assertComplete(message);
    return { text: textOf(message.content), model: message.model };
  }
  throw new Error("Web search did not finish");
}

// What was searched and which sites came back, so thin results can be traced.
function logSearches(job: string, message: BetaMessage) {
  for (const block of message.content) {
    if (block.type === "server_tool_use" && block.name === "web_search") {
      const query = (block.input as { query?: string })?.query ?? "";
      const result = message.content.find((b) => b.type === "web_search_tool_result" && b.tool_use_id === block.id);
      const items = result && result.type === "web_search_tool_result" && Array.isArray(result.content) ? result.content : [];
      const sites = items.map((r) => ("url" in r ? new URL(r.url).hostname.replace(/^www\./, "") : "")).filter(Boolean);
      console.info(`[ai] ${job} searched "${query}": ${sites.length} results${sites.length ? ` (${sites.slice(0, 6).join(", ")})` : ""}`);
    }
  }
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
