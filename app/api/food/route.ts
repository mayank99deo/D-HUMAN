import { z } from "zod";
import { appPlanLimit, appRefusal, consentNeeded, IN_PROGRESS_RETRY_S } from "@/lib/api/errors";
import { privateJson } from "@/lib/api/respond";
import { EATEN_AT_MAX_AHEAD_MS, eatenAtInReach } from "@/lib/api/meal-writes";
import { mealJson } from "@/lib/api/views/parts";
import { AiRefusalError, AiUnavailableError } from "@/lib/ai/client";
import { appActor, isAppRequest } from "@/lib/api/actor";
import { apiUser } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import type { FoodLog } from "@/lib/db/schema";
import { consentCurrent } from "@/lib/domain/consent";
import type { Refusal } from "@/lib/domain/plan";
import { MEAL_KEY, logMeal, mealDay, mealIdFor, waitForMeal, type MealInput } from "@/lib/platform/food";
import { json, sniffMime, unauthorized } from "@/lib/platform/http";
import { claimMealTry, planLimit, releaseUse } from "@/lib/platform/plan";
import { getProfile, localDate } from "@/lib/platform/profile";
import { MEAL_ENGLISH_MAX, MEAL_WORDS_MAX, SPOKEN_IDS, fitScript, spokenById } from "@/lib/domain/speech";
import { allowRequest, secondsUntilReset } from "@/lib/waitlist/rate-limit";

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

// What only the apps send (the mobile repo's docs/API.md §3.4). The web's sends never carry
// these, and from a web request they're ignored, so the web's meals are logged as before.
const appFields = z.object({
  // A meal queued offline: when it was eaten (the capture time). It sets the day it counts on.
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  // A gallery photo: when it was taken. Taken today, its clock sets the slot (Mayank, 2026-11-26).
  photoAt: z.iso.datetime({ offset: true }).optional().catch(undefined),
  // How a spoken meal was ended (the voice spec §10): for the log line only, never stored.
  voiceEnd: z.enum(["pause", "tap", "log_now", "edited"]).optional().catch(undefined),
});


const STILL_READING = "We're still reading this meal. Try again in a moment.";

type Taken = { own: true } | { log: FoodLog } | { refusal: Refusal } | { busy: true };

/**
 * Owns the try, or answers for it. A repeated key whose try already logged its meal gets that
 * meal; one still being read waits for it; one whose first send failed tries again itself.
 */
async function takeTry(userId: string, id: string, day: string): Promise<Taken> {
  const started = Date.now();
  // Two rounds at most: a try that fails hands its use back, and this request claims it afresh.
  for (let round = 0; round < 2; round++) {
    const claim = await claimMealTry(userId, id, day);
    if (claim.status === "refused") return { refusal: claim.refusal };
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
      return { busy: true };
    }
    console.info(`[food] resend: the first send failed and handed its use back, after ${waited} ms`);
  }
  return { busy: true };
}

export async function POST(request: Request) {
  // A request carrying Authorization is an app's: it gets the apps' answers (private, always
  // with words, Retry-After). Every other request is the web's, answered exactly as before.
  const app = isAppRequest(request);
  const actor = app ? await appActor(request) : null;
  const user = app ? (actor?.user ?? null) : await apiUser();
  if (!user) return app ? privateJson({ error: "signed_out" }, 401) : unauthorized();
  if (!allowRequest(`food:${user.id}`, 40, 60 * 60_000))
    return app ? appRefusal("rate_limited", 429, { retryAfter: secondsUntilReset(`food:${user.id}`) }) : json({ error: "rate_limited" }, 429);
  const profile = actor ? actor.session.profile : await getProfile(user.id);
  if (!profile?.onboardedAt) return app ? appRefusal("not_onboarded", 409) : json({ error: "not_onboarded" }, 409);
  // The apps ask again when the consent wording has changed since the person agreed.
  if (app && !consentCurrent(profile.consentAt)) return consentNeeded();
  const refuse = (error: string, status: number) => (app ? appRefusal(error, status) : json({ error }, status));

  const form = await request.formData().catch(() => null);
  if (!form) return refuse("invalid", 400);
  const parsed = fields.safeParse({
    text: form.get("text") || undefined,
    original: form.get("original") || undefined,
    spoken: form.get("spoken") || undefined,
    source: form.get("source"),
    meal: form.get("meal") || undefined,
    key: form.get("key") || undefined,
  });
  if (!parsed.success) return refuse("invalid", 400);
  const { key, ...input } = parsed.data;
  const meal: MealInput = { ...input };

  if (app) {
    const extra = appFields.safeParse({ eatenAt: form.get("eatenAt") || undefined, photoAt: form.get("photoAt") || undefined, voiceEnd: form.get("voiceEnd") || undefined });
    if (!extra.success) return appRefusal("bad_time", 400);
    const now = Date.now();
    if (extra.data.eatenAt) {
      const eatenAt = new Date(extra.data.eatenAt);
      if (!eatenAtInReach(eatenAt, now)) return appRefusal("bad_time", 400);
      meal.eatenAt = eatenAt;
    }
    // A gallery photo taken on the day the meal counts sets its slot; an older one doesn't (the app asks which meal).
    if (extra.data.photoAt && input.source === "photo" && !input.meal) {
      const photoAt = new Date(extra.data.photoAt);
      if (photoAt.getTime() - now <= EATEN_AT_MAX_AHEAD_MS && localDate(profile.timezone, photoAt) === mealDay(profile.timezone, meal)) meal.photoAt = photoAt;
    }
    // Romanized on arrival: a Hinglish or English pick that heard Devanagari is read in Latin
    // letters, as the web's browser does before sending (heardInScript); the raw words are kept.
    const pick = input.spoken ? spokenById(input.spoken) : null;
    if (input.source === "voice" && pick?.script === "Latin") {
      const raw = input.original || input.text || "";
      const text = input.text && fitScript(input.text, pick);
      const original = input.original && fitScript(input.original, pick);
      if (text !== input.text || original !== input.original) Object.assign(meal, { text, original, inputRaw: raw });
    }
    if (extra.data.voiceEnd) console.info(`[food] voice ended by ${extra.data.voiceEnd}`);
  }

  let image: { mime: string; bytes: Buffer } | undefined;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 3 * 1024 * 1024) return refuse("too_large", 413);
    const bytes = Buffer.from(await photo.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime || mime === "application/pdf") return refuse("unsupported_type", 415);
    image = { mime, bytes };
  }
  if (!image && !input.text && !input.original) return refuse("empty", 400);

  // Counts against the plan (lib/domain/plan.ts) under the meal's own id, on the day it was
  // eaten; handed back if the meal isn't logged.
  const use = key ? mealIdFor(user.id, key) : newId();
  const taken = await takeTry(user.id, use, mealDay(profile.timezone, meal));
  if ("refusal" in taken) return app ? appPlanLimit(taken.refusal) : planLimit(taken.refusal);
  if ("busy" in taken)
    return app ? appRefusal("in_progress", 409, { retryAfter: IN_PROGRESS_RETRY_S }) : json({ error: "in_progress", message: STILL_READING }, 409);
  if ("log" in taken) return app ? privateJson({ meal: mealJson(taken.log, profile.timezone), repeat: true }) : json({ log: taken.log, repeat: true });
  let logged = false;
  try {
    const result = await logMeal(user.id, profile, { ...meal, image, id: use });
    if ("notFood" in result) return refuse("not_food", 422);
    logged = true;
    return app ? privateJson({ meal: mealJson(result.log, profile.timezone) }) : json({ log: result.log });
  } catch (error) {
    if (error instanceof AiUnavailableError) return refuse("ai_off", 503);
    // A decline isn't about photo quality: suggest the other way in.
    if (error instanceof AiRefusalError) {
      const message = image ? "We couldn't log this photo. Try telling us what you ate in a few words." : "We couldn't log that. Try describing the meal differently.";
      return app ? appRefusal("refused", 422, { message }) : json({ error: "refused", message }, 422);
    }
    console.error("[food]", error);
    return refuse("failed", 500);
  } finally {
    if (!logged) await releaseUse("meal", use).catch((e) => console.error("[food] Couldn't release the use", e));
  }
}
