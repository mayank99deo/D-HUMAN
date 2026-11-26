import { privateJson } from "./respond";
import { CONSENT_VERSION } from "@/lib/domain/consent";
import { PLAN, REFUSAL_MESSAGES, type Refusal } from "@/lib/domain/plan";

// Refusals as the apps get them: always a `message` (the mobile repo's docs/API.md §3.4, "Error
// words"), private, and with Retry-After where waiting helps. The web's routes keep their own
// answers exactly as they were: its pages pick their own words, and prefer a server message
// when one is sent (components/platform/meal-send.ts), so these are sent to app tokens only.

/** Words for a meal's refusals; the same as the web's own table (MEAL_ERRORS) where it has one. */
export const APP_MEAL_ERRORS: Record<string, string> = {
  not_onboarded: "Finish setting up first.",
  invalid: "We couldn't read that meal. Update the app, then try again.",
  empty: "Add a photo or a few words first.",
  too_large: "That photo is too big. Try again; we shrink photos before sending.",
  unsupported_type: "We can read JPEG, PNG and WebP photos. Try another photo.",
  bad_time: "This meal was saved too long ago to log for that day.",
  rate_limited: "That's a lot of meals in an hour. Try again a bit later.",
  in_progress: "We're still reading this meal. Try again in a moment.",
  not_food: "That doesn't look like food. Try another photo, or tell us what you ate.",
  not_found: "That meal is gone, or it's too old to log again.",
  ai_off: "Food reading isn't switched on yet on this server.",
  failed: "Something went wrong on our side. Try again.",
};

/**
 * The plan's refusals with no price and no "free" in them (gap G3): the apps show their own
 * words keyed on `refusal` and the store's price, and ignore these, which are a second guard.
 */
export const APP_REFUSALS: Record<Refusal, string> = {
  free_reads_used: `You've used the ${PLAN.freeReads} report reads you started with.`,
  pass_reads_used: REFUSAL_MESSAGES.pass_reads_used,
  free_meals_used: `You've used the ${PLAN.freeMeals} meal logs you started with.`,
  meals_today_used: REFUSAL_MESSAGES.meals_today_used,
};

/** Seconds to wait before trying again: a 409 in_progress is worth asking about again soon. */
export const IN_PROGRESS_RETRY_S = 5;

/** A refusal for an app token, with its words from `words` unless given. */
export function appRefusal(error: string, status: number, o: { words?: Record<string, string>; message?: string; retryAfter?: number; extra?: Record<string, unknown> } = {}) {
  const headers: Record<string, string> = o.retryAfter ? { "retry-after": String(Math.max(1, Math.ceil(o.retryAfter))) } : {};
  const message = o.message ?? o.words?.[error] ?? APP_MEAL_ERRORS[error] ?? APP_MEAL_ERRORS.failed;
  return privateJson({ error, message, ...o.extra }, status, headers);
}

/** 402: the plan doesn't allow one more use, in price-free words. */
export const appPlanLimit = (refusal: Refusal) => appRefusal("plan_limit", 402, { message: APP_REFUSALS[refusal], extra: { refusal } });

/**
 * 409 consent_needed: an app write from someone whose agreement predates the current consent
 * wording (lib/domain/consent.ts). The app shows its consent step again; after Agree it sends
 * the same request once more, with the same key.
 */
export const consentNeeded = () =>
  appRefusal("consent_needed", 409, {
    message: "We've updated what we ask you to agree to. Read it and agree to carry on.",
    extra: { version: CONSENT_VERSION },
  });
