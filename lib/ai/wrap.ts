import "server-only";
import { MODELS, VOICE, anthropic, assertComplete, fallbackFor, languageRule, logUsage } from "./client";
import { strictOutputFormat } from "./output-format";
import { WrapStorySchema, type WrapStory } from "./schemas";

// The meal-slot rule fixes a wrap that called a peanut-butter toast, logged as a snack at
// 18:10 every day, "your go-to breakfast" (2026-11-13): the stats now carry each top
// food's logged slot and usual time (wrapStatsFrom in lib/platform/wraps.ts), and the
// model may name a slot only from them.
export const SYSTEM = `${VOICE}

You write D-Human Wraps: a short, punchy story of someone's week, month or year in health, shown as full-screen cards they tap through. Think a sports broadcaster who also happens to be a nutritionist: specific, a little playful, never shaming.
- Use ONLY the numbers in the stats you're given. Never invent or round them differently.
- 5–7 cards. Card "big" is a number from the stats or 1–3 words. "label" says what it is. "line" is one sentence of meaning.
- Include at least one honest gap card when the stats show a gap, and end with a "next" card.
- one_thing: the single focus for the next period, concrete and doable.
- Meal slots: each top food has "meal" (breakfast, lunch, dinner or snack: the slot the person logged it as) and "usualTime" (when they usually log it, 24-hour clock, their own time zone). Call a food a breakfast, lunch, dinner or snack only as its "meal" says. Never guess the slot from what the food is or from the time. If "meal" is missing, don't name a slot.`;

export type WrapInput = {
  period: "week" | "month" | "year";
  label: string;
  persona: string;
  firstName: string;
  goals: string[];
  stats: unknown;
  language: string;
};

/** The user turn: who it's for, the period, and the stats as JSON. */
export function wrapMessage(input: WrapInput): string {
  return `Write the ${input.period} wrap for ${input.firstName}, a ${input.persona.toLowerCase()} whose goals are ${
    input.goals.join(", ") || "general health"
  }. Period: ${input.label}.

Stats (JSON):
${JSON.stringify(input.stats, null, 2)}

${languageRule(input.language)}`;
}

export async function writeWrap(input: WrapInput): Promise<{ data: WrapStory; model: string }> {
  const t0 = Date.now();
  const message = await anthropic()
    .beta.messages.stream({
      model: MODELS.wrap,
      max_tokens: 16000,
      ...fallbackFor(MODELS.wrap),
      // Card kinds are an enum the API enforces (lib/ai/output-format.ts).
      output_config: { effort: "low", format: strictOutputFormat(WrapStorySchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: wrapMessage(input) }],
    })
    .finalMessage();
  logUsage("wrap", message, t0);
  assertComplete(message);
  if (!message.parsed_output) throw new Error("Could not write the wrap");
  return { data: message.parsed_output, model: message.model };
}
