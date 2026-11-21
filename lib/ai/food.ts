import "server-only";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MODELS, VOICE, anthropic, assertComplete, fallbackFor, languageRule, logUsage } from "./client";
import { strictOutputFormat } from "./output-format";
import { USUAL_DAY_RUNS, settledRuns } from "@/lib/domain/food-sums";
import { foodListText, portionsText } from "@/lib/domain/food-table";
import { averageUsualDay } from "@/lib/domain/meal-minerals";
import type { MealWords, Spoken } from "@/lib/domain/speech";
import { DaySchema, MealSchema, type Day, type Meal, type SavedDay } from "./schemas";

// Minerals are worked out in code (lib/domain/meal-minerals.ts): the model names each ingredient's
// code from the food list and its raw weight, and the app multiplies by USDA values. The model still
// gives energy and macros, the vitamins, and the minerals of foods off the list.
// Reference values per 100 g were tried in this prompt on 2026-11-17 and taken out again: the model
// applied raw-food values to cooked rice and dal (rice minerals at about 3 times the reference). So the
// prompt carries portions as raw grams to copy, never values to multiply.
// The portions are the textbook ones (lib/domain/food-table.ts, PORTIONS); until 2026-11-18 this prompt
// said 35 g atta a roti, against the textbooks' 20 g.
const FOOD_RULES = `You estimate nutrition for Indian home and street food, and everything else people eat.
- One item per dish or food the person names: "2 rotis, dal and curd" is three items.
- For each item, first list its ingredients:
  - food: its code from the food list below. Break dishes into the listed foods they're made of (atta for roti, maida for bread, curd for raita, chana for chole, toor_dal for sambar). A food that isn't on the list is "other", never the nearest listed food: rohu is not tilapia, ragi is not rice.
  - raw_g: its edible weight before cooking or soaking: dry dal, raw rice, atta, raw meat without bone. Never the cooked weight. Copy it from the portions below; when the person gives a raw amount, use it as given. Write each weight once; don't convert it again.
  - kcal: the energy of that ingredient alone.
  - minerals: null for foods on the list; the app looks up their iron, calcium, magnesium, zinc and B12. For "other" only, give those five for raw_g: iron (mg), calcium (mg), magnesium (mg), zinc (mg), B12 (µg).
  - Cooking oil, ghee and butter are their own ingredients. Leave out water, salt and spices.
- Then estimate the item's own totals for the whole portion as eaten (each meal's, when asked for meals): kcal, protein, carbs, fat and fibre, counting cooking oil and ghee, which people forget; and its vitamins: folate (µg), vitamin C (mg), vitamin D (IU). These are always yours to estimate: kcal and macros are never 0 for real food, and a vitamin is 0 only when the food has essentially none. Base them on standard composition values (IFCT 2017 for Indian foods, USDA otherwise).
- Be honest about uncertainty with confidence: high when portions are clear, low when guessing.
- If what you're given isn't food or drink, set is_food false and return no items.

Portions, as raw weight (1 katori ≈ 150 mL):
${portionsText()}

Food list (code and what it covers):
${foodListText()}`;

const SYSTEM = `${VOICE}\n\n${FOOD_RULES}`;

export type FoodContext = { language: string; diet: string | null; focus: string[] };

const contextLine = (c: FoodContext) =>
  `Their diet: ${c.diet ?? "not given"}. What their blood report says to watch: ${c.focus.join(", ") || "nothing specific yet"}.`;

// The food route stops at 120 s. Two tries of at most 50 s each end well before that,
// so a slow call fails cleanly and the meal's use is handed back.
const MEAL_DEADLINE = { timeout: 50_000, maxRetries: 1 };
// The usual-day route also stops at 120 s, and its estimates run side by side.
const DAY_DEADLINE = { timeout: 50_000, maxRetries: 1 };

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

// Which language to answer in.
// - Spoken with हिंदी or Hinglish picked: the pick decides, script and all, whatever
//   script speech recognition used (Mayank, 2026-11-22). settleReply holds the reply to it.
// - Otherwise the expected one (picked for speaking, or read from the script) is only a
//   hint: people pick English and speak Hindi, which the browser then writes in Latin
//   letters. The reply follows the words actually used, in a script the person used, and
//   says which language it is (reply_language).
function languageLine(words: MealWords, voice: boolean): string {
  const hint = words.reply;
  if (!words.said) return `Write the title and the tip in ${hint.name}. ${languageRule(hint.id)} Set reply_language to "${hint.id}".`;
  if (words.byPick) return pickedLine(hint);
  const source = voice ? `They chose to speak ${hint.name}.` : `Their words look like ${hint.name}.`;
  const judge = words.english ? " Judge this from their own words, not the browser's translation." : "";
  return `${source} Write the title and the tip in the language their words are actually in: ${hint.name} if they're in ${hint.name}; if they're clearly in another language, that one; if unsure, ${hint.name}.${judge}
Match their script: words in an Indian script get a reply in that script; words in Latin letters get a reply in Latin letters (English, or Hindi or another Indian language written in Latin letters the way people text it, like Hinglish).
Keep it simple and short. Keep marker names, units and brand names in English, and numbers as digits. Set reply_language to the language you write in: "hinglish" for Hindi in Latin letters, "en" for English, otherwise that language's code.
When you write in ${hint.name}: ${languageRule(hint.id)}`;
}

// Hindi or Hinglish picked for speaking: one language and one script for every word the
// person reads, the title, the items and the tip.
function pickedLine(pick: Spoken): string {
  const how =
    pick.id === "hinglish"
      ? `in Hinglish: Hindi written in Latin letters, mixed with English the way people text in India (like "2 roti aur chane ki sabzi"). Use no Devanagari at all, even where speech recognition wrote their words in it.`
      : `in simple, everyday Hindi in Devanagari script, even where speech recognition wrote their words in Latin letters.`;
  return `They chose ${pick.name} for speaking, so write the title, each item's name and portion, and the tip ${how}
Keep it simple and short. Keep marker names, units and brand names in English, and numbers as digits. Set reply_language to "${pick.id}".`;
}

type MealRequest = { image?: { mime: string; bytes: Buffer }; words: MealWords; voice: boolean; context: FoodContext };

/** The text part of the meal request. Exported for tests. */
export function mealPrompt(input: MealRequest): string {
  return `${input.image ? "Here's a photo of what I ate." : ""}${wordsLine(input.words, input.voice)}

${contextLine(input.context)}
Title: a short name for the meal, as they'd say it. Tip: one short, specific nudge linked to what their report says to watch, or null if nothing useful. Keep food names as Indians say them (e.g. "rajma chawal").
${languageLine(input.words, input.voice)}`;
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
      // Enums enforced by the API (lib/ai/output-format.ts): reply_language, each ingredient's food code, meal_guess, confidence.
      output_config: { effort: "low", format: strictOutputFormat(MealSchema) },
      system: SYSTEM,
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
      output_config: { effort: "low", format: strictOutputFormat(DaySchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `This is how I usually eat on a normal day: "${description}"

Break it into meals, each with its estimates, ingredients and vitamins. ${contextLine(context)}
Patterns: 2–4 plain observations about how they eat (e.g. "Most of your protein comes at dinner"). ${languageRule(context.language)}`,
        },
      ],
    }, DAY_DEADLINE)
    .finalMessage();
  logUsage("typical_day", message, t0);
  assertComplete(message);
  if (!message.parsed_output) throw new Error("Could not read the description");
  return { data: message.parsed_output, model: message.model };
}

/**
 * A usual day, estimated USUAL_DAY_RUNS times at once and averaged, each estimate's minerals worked
 * out in code first (averageUsualDay). Estimates that fail are left out; only when all of them fail
 * does the first error come back.
 */
export async function estimateUsualDay(description: string, context: FoodContext): Promise<{ data: SavedDay; model: string }> {
  const runs = await settledRuns(USUAL_DAY_RUNS, () => estimateTypicalDay(description, context));
  if (runs.length < USUAL_DAY_RUNS) console.warn(`[food] usual day from ${runs.length} of ${USUAL_DAY_RUNS} estimates`);
  return { data: averageUsualDay(runs.map((r) => r.data)), model: runs[0].model };
}
