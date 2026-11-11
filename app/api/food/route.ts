import { z } from "zod";
import { AiRefusalError, AiUnavailableError } from "@/lib/ai/client";
import { apiUser } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { logMeal } from "@/lib/platform/food";
import { json, sniffMime, unauthorized } from "@/lib/platform/http";
import { claimMeal, planLimit, releaseUse } from "@/lib/platform/plan";
import { getProfile, localDate } from "@/lib/platform/profile";
import { MEAL_ENGLISH_MAX, MEAL_WORDS_MAX, SPOKEN_IDS } from "@/lib/domain/speech";
import { allowRequest } from "@/lib/waitlist/rate-limit";

export const maxDuration = 120;

// `text` is what gets read: the browser's English translation when it made one (then
// `original` holds the person's own words), else their words. The reply language is
// worked out here from their words and, for voice, `spoken` (lib/domain/speech.ts).
const fields = z.object({
  text: z.string().trim().max(MEAL_ENGLISH_MAX).optional(),
  original: z.string().trim().max(MEAL_WORDS_MAX).optional(),
  // Ignored, not refused, when unknown: a tab left open may still offer a language we've dropped.
  spoken: z.enum(SPOKEN_IDS).optional().catch(undefined),
  source: z.enum(["photo", "voice", "text"]),
  meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
})
  // Their own words fit the box; only a translation may run longer.
  .refine((f) => f.original || (f.text?.length ?? 0) <= MEAL_WORDS_MAX);

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!allowRequest(`food:${user.id}`, 40, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const profile = await getProfile(user.id);
  if (!profile?.onboardedAt) return json({ error: "not_onboarded" }, 409);

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "invalid" }, 400);
  const parsed = fields.safeParse({
    text: form.get("text") || undefined,
    original: form.get("original") || undefined,
    spoken: form.get("spoken") || undefined,
    source: form.get("source"),
    meal: form.get("meal") || undefined,
  });
  if (!parsed.success) return json({ error: "invalid" }, 400);

  let image: { mime: string; bytes: Buffer } | undefined;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 3 * 1024 * 1024) return json({ error: "too_large" }, 413);
    const bytes = Buffer.from(await photo.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime || mime === "application/pdf") return json({ error: "unsupported_type" }, 415);
    image = { mime, bytes };
  }
  if (!image && !parsed.data.text && !parsed.data.original) return json({ error: "empty" }, 400);

  // Counts against the plan (lib/domain/plan.ts) under the meal's own id; handed back if the meal isn't logged.
  const use = newId();
  const refusal = await claimMeal(user.id, use, localDate(profile.timezone));
  if (refusal) return planLimit(refusal);
  let logged = false;
  try {
    const result = await logMeal(user.id, profile, { ...parsed.data, image, id: use });
    if ("notFood" in result) return json({ error: "not_food" }, 422);
    logged = true;
    return json({ log: result.log });
  } catch (error) {
    if (error instanceof AiUnavailableError) return json({ error: "ai_off" }, 503);
    // A decline isn't about photo quality: suggest the other way in.
    if (error instanceof AiRefusalError) {
      const message = image ? "We couldn't log this photo. Try telling us what you ate in a few words." : "We couldn't log that. Try describing the meal differently.";
      return json({ error: "refused", message }, 422);
    }
    console.error("[food]", error);
    return json({ error: "failed" }, 500);
  } finally {
    if (!logged) await releaseUse("meal", use).catch((e) => console.error("[food] Couldn't release the use", e));
  }
}
