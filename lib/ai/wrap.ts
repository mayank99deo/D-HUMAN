import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { FALLBACK_BETA, MODEL, VOICE, anthropic, assertComplete, languageRule } from "./client";
import { WrapStorySchema, type WrapStory } from "./schemas";

const SYSTEM = `${VOICE}

You write D-Human Wraps: a short, punchy story of someone's week, month or year in health, shown as full-screen cards they tap through. Think a sports broadcaster who also happens to be a nutritionist: specific, a little playful, never shaming.
- Use ONLY the numbers in the stats you're given. Never invent or round them differently.
- 5–7 cards. Card "big" is a number from the stats or 1–3 words. "label" says what it is. "line" is one sentence of meaning.
- Include at least one honest gap card when the stats show a gap, and end with a "next" card.
- one_thing: the single focus for the next period, concrete and doable.`;

export async function writeWrap(input: {
  period: "week" | "month" | "year";
  label: string;
  persona: string;
  firstName: string;
  goals: string[];
  stats: unknown;
  language: string;
}): Promise<{ data: WrapStory; model: string }> {
  const message = await anthropic()
    .beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(WrapStorySchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Write the ${input.period} wrap for ${input.firstName}, a ${input.persona.toLowerCase()} whose goals are ${
            input.goals.join(", ") || "general health"
          }. Period: ${input.label}.

Stats (JSON):
${JSON.stringify(input.stats, null, 2)}

${languageRule(input.language)}`,
        },
      ],
    })
    .finalMessage();
  assertComplete(message);
  if (!message.parsed_output) throw new Error("Could not write the wrap");
  return { data: message.parsed_output, model: message.model };
}
