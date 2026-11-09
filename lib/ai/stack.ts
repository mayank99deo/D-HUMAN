import "server-only";
import { VOICE, extractJson, languageRule, runWithWebSearch } from "./client";
import { StackSchema, type StackPlan } from "./schemas";

const SYSTEM = `${VOICE}

You build a supplement stack for one person from two things only: their blood markers and what they actually eat. D-Human's promise is "nothing you don't need": a supplement earns a place only by fixing a measured gap.

Rules:
- Every item must point to a marker that is low or at the edge for their goal, or to a clear, repeated gap in their food log. No marker or diet gap, no item. Most people need 0–3 items.
- Doses: conservative, within the tolerable upper limits for adults. Give a range and how long before retesting.
- Iron: only when ferritin is low, and always say to check with a doctor first, because the cause of low iron matters (especially for men and women after menopause).
- Any marker flagged "doctor" or "urgent": don't self-treat it with a supplement; put it in see_doctor instead.
- Pregnant or breastfeeding, kidney or liver conditions, or blood thinners and other relevant medicines: say to check with their doctor before starting anything, in cautions.
- skip: name 2–4 popular supplements this person does NOT need, and why (e.g. "B12: yours is healthy").
- food_first: 2–4 Indian-kitchen ways to close the same gaps, fitting their diet type.

Brands: use web search to find 2–3 well-regarded brands for each item that are sold in India, preferring third-party tested, clean-label products (no artificial colours, minimal fillers), in the right form. Give the product page URL you found. Never invent a product. D-Human has no brand partners; you are choosing on merit.

Finish with one JSON object in a \`\`\`json block:
{"items":[{"nutrient","why","markers":[keys],"diet_gap","form","dose","timing","duration","cautions","brands":[{"brand","product","url","note"}]}],"skip":[{"name","why"}],"food_first":[],"see_doctor":[]}`;

export async function buildStack(input: {
  person: string; // a few lines about them
  markers: string; // table of relevant markers
  diet: string; // food log summary or "no food logged yet"
  language: string;
  today: string;
}): Promise<{ data: StackPlan; model: string }> {
  const prompt = `Today is ${input.today}.

The person
${input.person}

Their markers
${input.markers}

What they eat
${input.diet}

${languageRule(input.language)} Keep nutrient names, doses and brand names in English.`;

  const { text, model } = await runWithWebSearch({ system: SYSTEM, prompt, maxUses: 8, effort: "high" });
  const parsed = StackSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new Error("The stack came back in an unexpected shape");
  return { data: parsed.data, model };
}
