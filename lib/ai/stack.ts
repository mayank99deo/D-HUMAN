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

Brands: decide the items, doses and cautions from your own knowledge first; spend your web searches only on brands, one search per item (for example "third-party tested vitamin D3 cholecalciferol supplement India"); never repeat a search you have already run. Every item must list 2–3 well-regarded brands sold in India, each with a product page you found: the brand's own site, or a major Indian pharmacy or marketplace page. Prefer makers with third-party testing or GMP certification and clean labels (no artificial colours, minimal fillers) in the right form, and say in the note what makes each a good pick. Never invent a product. If a search finds nothing suitable, say so in that item's cautions rather than leaving brands empty without a word. D-Human has no brand partners; you are choosing on merit.

Finish with one JSON object in a \`\`\`json block:
{"items":[{"nutrient","why","markers":[keys],"diet_gap","form","dose","timing","duration","cautions","brands":[{"brand","product","url","note"}]}],"skip":[{"name","why"}],"food_first":[],"see_doctor":[]}`;

export async function buildStack(input: {
  where?: { city?: string | null; country?: string | null };
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

  const { text, model } = await runWithWebSearch({ job: "stack", system: SYSTEM, prompt, maxUses: 4, effort: "medium", where: input.where });
  const parsed = StackSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new Error("The stack came back in an unexpected shape");
  return { data: parsed.data, model };
}
