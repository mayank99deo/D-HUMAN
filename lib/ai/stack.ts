import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODELS, VOICE, anthropic, assertComplete, extractJson, fallbackFor, languageRule, logUsage, runWithWebSearch } from "./client";
import type { StackPlan } from "./schemas";

// Since 2026-11-11 the stack itself is worked out in code (lib/domain/supplements.ts).
// Claude does two small jobs here: find brands for a nutrient (shared by everyone,
// cached monthly in brand_picks) and translate a plan for Hindi and Hinglish readers.

export type Brand = { brand: string; product: string; url: string | null; note: string | null };

const BRAND_SYSTEM = `${VOICE}

You find supplement brands sold in India, on merit. D-Human has no brand partners.
Search the web, then name 2–3 well-regarded brands for the product you're given, each with a product page you found: the brand's own site, or a major Indian pharmacy or marketplace page. Prefer makers with third-party testing or GMP certification and clean labels (no artificial colours, minimal fillers). In "note", say in one short sentence what makes it a good pick. Never invent a product or a URL. Never describe your searching.
Finish with one JSON object in a \`\`\`json block: {"brands":[{"brand","product","url","note"}]}. If nothing suitable turns up, return {"brands":[]}.`;

const BrandSchema = z.object({
  brand: z.string().min(1),
  product: z.string().default(""),
  url: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
});

export async function findBrands(input: { nutrient: string; form: string }): Promise<{ brands: Brand[]; model: string }> {
  const { text, model } = await runWithWebSearch({
    job: "stack",
    system: BRAND_SYSTEM,
    prompt: `Find brands sold in India for: ${input.nutrient}, as ${input.form}. Two searches at most.`,
    maxUses: 2,
    effort: "low",
    where: { country: "India" },
  });
  const raw = extractJson(text) as { brands?: unknown[] } | null;
  // Keep each good entry; one malformed brand doesn't sink the rest.
  const brands = (Array.isArray(raw?.brands) ? raw.brands : [])
    .map((b) => BrandSchema.safeParse(b))
    .filter((r) => r.success)
    .map((r) => r.data)
    .map((b) => ({ ...b, url: b.url && /^https?:\/\//.test(b.url) ? b.url : null }))
    .slice(0, 3);
  return { brands, model };
}

// The words of a plan, for translation. Markers, brands and order stay as they are.
const TranslatedSchema = z.object({
  items: z.array(
    z.object({
      nutrient: z.string(),
      why: z.string(),
      form: z.string(),
      dose: z.string(),
      timing: z.string(),
      duration: z.string(),
      cautions: z.string().nullable(),
      diet_gap: z.string().nullable(),
    }),
  ),
  skip: z.array(z.object({ name: z.string(), why: z.string() })),
  food_first: z.array(z.string()),
  see_doctor: z.array(z.string()),
});

/**
 * The same plan in the person's language, or the English plan when the
 * translation doesn't keep exactly the same items, in the same order.
 */
export async function translatePlan(plan: StackPlan, language: string): Promise<{ plan: StackPlan; model: string | null }> {
  if (language === "en" || (!plan.items.length && !plan.skip.length && !plan.see_doctor.length)) return { plan, model: null };
  const words = {
    items: plan.items.map(({ nutrient, why, form, dose, timing, duration, cautions, diet_gap }) => ({ nutrient, why, form, dose, timing, duration, cautions, diet_gap })),
    skip: plan.skip,
    food_first: plan.food_first,
    see_doctor: plan.see_doctor,
  };
  const t0 = Date.now();
  const message = await anthropic()
    .beta.messages.stream({
      model: MODELS.wrap,
      max_tokens: 8000,
      ...fallbackFor(MODELS.wrap),
      ...(MODELS.wrap.startsWith("claude-haiku") ? { thinking: { type: "disabled" as const } } : {}),
      output_config: { effort: "low", format: betaZodOutputFormat(TranslatedSchema) },
      system: `You translate a supplement plan for an Indian health app. Keep the meaning exactly, including every caution and every "see a doctor" line. Keep nutrient names, doses, numbers, units and brand names in English. Keep the same number of entries in the same order. ${languageRule(language)}`,
      messages: [{ role: "user", content: JSON.stringify(words) }],
    })
    .finalMessage();
  logUsage("translate", message, t0);
  assertComplete(message);
  const out = message.parsed_output;
  const same =
    !!out &&
    out.items.length === plan.items.length &&
    out.skip.length === plan.skip.length &&
    out.food_first.length === plan.food_first.length &&
    out.see_doctor.length === plan.see_doctor.length;
  if (!out || !same) {
    console.warn("[stack] Translation changed the plan's shape; showing it in English.");
    return { plan, model: null };
  }
  return {
    plan: {
      items: plan.items.map((item, i) => ({ ...item, ...out.items[i], markers: item.markers, brands: item.brands })),
      skip: out.skip,
      food_first: out.food_first,
      see_doctor: out.see_doctor,
    },
    model: message.model,
  };
}
