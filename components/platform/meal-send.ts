// Logging a meal from Fuel: one try, sent as often as it takes, logged once.
//
// A try is what the person asked to log: their words (and the browser's English for them), the
// language they spoke, how they logged it, which meal, and the photo. It gets a key once
// (tryKey in net.ts). The key goes with every send of that try: net.ts resends once when the
// connection fails, Try again resends it, and so does Log this meal with nothing changed. The
// server turns the key into the meal's id (mealIdFor), so a send that did land comes back as
// that meal instead of a second one.
import { OFFLINE, triesLine, type Sent } from "./net";
import type { SpokenId } from "@/lib/domain/speech";

export type MealSource = "photo" | "voice" | "text";
export type MealKindPick = "" | "breakfast" | "lunch" | "dinner" | "snack";

export type MealTry = {
  key: string;
  /** When the try was made (ms): an old failed try isn't reused for the same words. */
  at: number;
  words: string;
  /** The browser's English for the words, when it made one. */
  english: string | null;
  speaking: SpokenId | null;
  source: MealSource;
  meal: MealKindPick;
  photo: File | null;
};

/** A failed try is sent again (same key) for the same meal within this long; after it, the same words are a new meal. */
export const TRY_KEEP_MS = 30 * 60_000;

/** The earlier try, when this one asks for the very same meal, so its key is reused. */
export function sameTry(prev: MealTry | null, next: Pick<MealTry, "words" | "speaking" | "source" | "meal" | "photo">, now: number): MealTry | null {
  if (!prev || now - prev.at > TRY_KEEP_MS) return null;
  const same = prev.words === next.words && prev.speaking === next.speaking && prev.source === next.source && prev.meal === next.meal && prev.photo === next.photo;
  return same ? prev : null;
}

/** The form for one send of a try. Made afresh for each send. */
export function mealForm(t: MealTry): FormData {
  const form = new FormData();
  form.append("source", t.source);
  if (t.english) {
    form.append("text", t.english);
    form.append("original", t.words);
  } else if (t.words) form.append("text", t.words);
  if (t.speaking) form.append("spoken", t.speaking);
  if (t.meal) form.append("meal", t.meal);
  if (t.source === "photo" && t.photo) form.append("photo", t.photo, "meal.jpg");
  form.append("key", t.key);
  return form;
}

export const MEAL_ERRORS: Record<string, string> = {
  not_food: "That doesn't look like food. Try another photo, or tell us what you ate.",
  ai_off: "Food reading isn't switched on yet on this server.",
  rate_limited: "That's a lot of meals in an hour. Try again a bit later.",
  too_large: "That photo is too big. Try again; we shrink photos before sending.",
  empty: "Add a photo or a few words first.",
  in_progress: "We're still reading this meal. Try again in a moment.",
};

export type Failure = { message: string; detail: string | null; retry: boolean };

/**
 * What a failed send shows. The words stay plain; `detail` is the grey line for support (what
 * each send did, and how long it took); `retry` offers Try again when sending the same try
 * again can help: a lost connection, a server failure, a meal still being read. Not for answers
 * that would come back the same (not food, too large, too many).
 */
export function sendFailure(sent: Sent, fallback = "We couldn't log that. Try again.", errors: Record<string, string> = MEAL_ERRORS): Failure {
  const { res, data, tries } = sent;
  if (!res) return { message: OFFLINE, detail: triesLine(tries), retry: true };
  const code = typeof data.error === "string" ? data.error : "";
  const given = typeof data.message === "string" && data.message ? data.message : null;
  const message = given ?? errors[code] ?? fallback;
  // A 200 that didn't carry what was asked for: the answer was garbled on the way.
  if (res.ok) return { message: fallback, detail: `Unreadable answer, HTTP ${res.status}`, retry: true };
  const retry = code === "in_progress" || (res.status >= 500 && code !== "ai_off");
  return { message, detail: retry ? triesLine(tries) : null, retry };
}
