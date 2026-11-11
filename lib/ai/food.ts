import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MODELS, VOICE, anthropic, assertComplete, fallbackFor, languageRule, logUsage } from "./client";
import type { MealWords } from "@/lib/domain/speech";
import { DaySchema, MealSchema, type Day, type Meal } from "./schemas";

const FOOD_RULES = `You estimate nutrition for Indian home and street food, and everything else people eat.
- Use Indian household measures: 1 katori ≈ 150 mL, 1 medium roti ≈ 35 g atta, 1 cup rice (cooked) ≈ 150 g, 1 tbsp oil or ghee ≈ 14 g.
- Base estimates on standard composition values (IFCT 2017 for Indian foods, USDA otherwise). Account for cooking oil and ghee, which people forget.
- Estimate micronutrients for the whole meal: iron (mg), calcium (mg), magnesium (mg), zinc (mg), B12 (µg), folate (µg), vitamin C (mg), vitamin D (IU). Use 0 when the meal has essentially none.
- Be honest about uncertainty with confidence: high when portions are clear, low when guessing.
- If what you're given isn't food or drink, set is_food false and return no items.`;

export type FoodContext = { language: string; diet: string | null; focus: string[] };

const contextLine = (c: FoodContext) =>
  `Their diet: ${c.diet ?? "not given"}. What their blood report says to watch: ${c.focus.join(", ") || "nothing specific yet"}.`;

// The food route stops at 120 s. Two tries of at most 50 s each end well before that,
// so a slow call fails cleanly and the meal's use is handed back.
const MEAL_DEADLINE = { timeout: 50_000, maxRetries: 1 };

// The person's words for the prompt. When the browser translated them, Claude gets
// both: the English to work from and their own words to check odd food names against.
function wordsLine(words: MealWords, voice: boolean): string {
  if (!words.said) return "";
  const heard = voice ? " (spoken, so speech recognition may have misheard a word)" : "";
  if (!words.english) return ` In my words${heard}: "${words.said}"`;
  return ` In my words, in ${words.saidIn.name}${heard}: "${words.said}"
My browser translated that into English: "${words.english}"
Browser translations can get Indian food names wrong; where the two differ, go by my words.`;
}

type MealRequest = { image?: { mime: string; bytes: Buffer }; words: MealWords; voice: boolean; context: FoodContext };

/** The text part of the meal request. Exported for tests. */
export function mealPrompt(input: MealRequest): string {
  return `${input.image ? "Here's a photo of what I ate." : ""}${wordsLine(input.words, input.voice)}

${contextLine(input.context)}
Title: a short name for the meal, as they'd say it. Tip: one short, specific nudge linked to what their report says to watch, or null if nothing useful. Write the title and the tip in ${input.words.reply.name}. ${languageRule(input.words.reply.id)} Keep food names as Indians say them (e.g. "rajma chawal").`;
}

export async function estimateMeal(input: MealRequest): Promise<{ data: Meal; model: string }> {
  const content: BetaContentBlockParam[] = [];
  if (input.image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: input.image.mime as "image/jpeg" | "image/png" | "image/webp",
        data: input.image.bytes.toString("base64"),
      },
    });
  }
  content.push({ type: "text", text: mealPrompt(input) });

  const t0 = Date.now();
  const message = await anthropic()
    .beta.messages.stream({
      model: MODELS.food,
      max_tokens: 16000,
      ...fallbackFor(MODELS.food),
      // A calorie estimate gains little from a long think; this keeps logging a meal quick.
      ...(MODELS.food.startsWith("claude-haiku") ? { thinking: { type: "disabled" as const } } : {}),
      output_config: { effort: "low", format: betaZodOutputFormat(MealSchema) },
      system: `${VOICE}\n\n${FOOD_RULES}`,
      messages: [{ role: "user", content }],
    }, MEAL_DEADLINE)
    .finalMessage();
  logUsage("meal", message, t0);
  assertComplete(message);
  if (!message.parsed_output) throw new Error("Could not read the meal");
  return { data: message.parsed_output, model: message.model };
}

export async function estimateTypicalDay(description: string, context: FoodContext): Promise<{ data: Day; model: string }> {
  const t0 = Date.now();
  const message = await anthropic()
    .beta.messages.stream({
      model: MODELS.food,
      max_tokens: 16000,
      ...fallbackFor(MODELS.food),
      output_config: { effort: "low", format: betaZodOutputFormat(DaySchema) },
      system: `${VOICE}\n\n${FOOD_RULES}`,
      messages: [
        {
          role: "user",
          content: `This is how I usually eat on a normal day: "${description}"

Break it into meals with estimates, then the day's micronutrients. ${contextLine(context)}
Patterns: 2–4 plain observations about how they eat (e.g. "Most of your protein comes at dinner"). ${languageRule(context.language)}`,
        },
      ],
    })
    .finalMessage();
  logUsage("typical_day", message, t0);
  assertComplete(message);
  if (!message.parsed_output) throw new Error("Could not read the description");
  return { data: message.parsed_output, model: message.model };
}
