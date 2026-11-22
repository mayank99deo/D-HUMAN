import { z } from "zod";
import { AiRefusalError, AiUnavailableError } from "@/lib/ai/client";
import { apiUser } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import type { FoodLog } from "@/lib/db/schema";
import { MEAL_KEY, logMeal, mealIdFor, waitForMeal } from "@/lib/platform/food";
import { json, sniffMime, unauthorized } from "@/lib/platform/http";
import { claimMealTry, planLimit, releaseUse } from "@/lib/platform/plan";
import { getProfile, localDate } from "@/lib/platform/profile";
import { MEAL_ENGLISH_MAX, MEAL_WORDS_MAX, SPOKEN_IDS } from "@/lib/domain/speech";
import { allowRequest } from "@/lib/waitlist/rate-limit";

export const maxDuration = 120;

// `text` is what gets read: the browser's English translation when it made one (then
// `original` holds the person's own words), else their words. The reply language is
// worked out here from their words and, for voice, `spoken` (lib/domain/speech.ts).
// `key` names the try: the browser sends the same key when it sends the same meal again
// (a dropped connection, or Try again), and gets the meal that try logged (mealIdFor).
const fields = z.object({
  text: z.string().trim().max(MEAL_ENGLISH_MAX).optional(),
  original: z.string().trim().max(MEAL_WORDS_MAX).optional(),
  // Ignored, not refused, when unknown: a tab left open may still offer a language we've dropped.
  spoken: z.enum(SPOKEN_IDS).optional().catch(undefined),
  source: z.enum(["photo", "voice", "text"]),
  meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  // Optional: a tab opened before keys existed sends none, and each of its sends is a new try.
  key: z.string().regex(MEAL_KEY).optional(),
})
  // Their own words fit the box; only a translation may run longer.
  .refine((f) => f.original || (f.text?.length ?? 0) <= MEAL_WORDS_MAX);

const STILL_READING = "We're still reading this meal. Try again in a moment.";

/**
 * Owns the try, or answers for it. A repeated key whose try already logged its meal gets that
 * meal; one still being read waits for it; one whose first send failed tries again itself.
 */
async function takeTry(userId: string, id: string, today: string): Promise<{ own: true } | { log: FoodLog } | Response> {
  const started = Date.now();
  // Two rounds at most: a try that fails hands its use back, and this request claims it afresh.
  for (let round = 0; round < 2; round++) {
    const claim = await claimMealTry(userId, id, today);
    if (claim.status === "refused") return planLimit(claim.refusal);
    if (claim.status === "fresh") return { own: true };
    const seen = await waitForMeal(userId, id);
    const waited = Date.now() - started;
    if ("log" in seen) {
      console.info(`[food] resend: meal already logged, after ${waited} ms`);
      return { log: seen.log };
    }
    if (seen.state === "stale") {
      // Its first request died without logging or handing back (a killed function): the use
      // already counts once, so this request finishes the try under the same id.
      console.info(`[food] resend: took over a try with no live request, after ${waited} ms`);
      return { own: true };
    }
    if (seen.state === "busy") {
      console.info(`[food] resend: the first send is still reading after ${waited} ms`);
      return json({ error: "in_progress", message: STILL_READING }, 409);
    }
    console.info(`[food] resend: the first send failed and handed its use back, after ${waited} ms`);
  }
  return json({ error: "in_progress", message: STILL_READING }, 409);
}

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
    key: form.get("key") || undefined,
  });
  if (!parsed.success) return json({ error: "invalid" }, 400);
  const { key, ...input } = parsed.data;

  let image: { mime: string; bytes: Buffer } | undefined;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 3 * 1024 * 1024) return json({ error: "too_large" }, 413);
    const bytes = Buffer.from(await photo.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime || mime === "application/pdf") return json({ error: "unsupported_type" }, 415);
    image = { mime, bytes };
  }
  if (!image && !input.text && !input.original) return json({ error: "empty" }, 400);

  // Counts against the plan (lib/domain/plan.ts) under the meal's own id; handed back if the meal isn't logged.
  const use = key ? mealIdFor(user.id, key) : newId();
  const taken = await takeTry(user.id, use, localDate(profile.timezone));
  if (taken instanceof Response) return taken;
  if ("log" in taken) return json({ log: taken.log, repeat: true });
  let logged = false;
  try {
    const result = await logMeal(user.id, profile, { ...input, image, id: use });
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
