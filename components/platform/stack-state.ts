// What the Stack screen follows while a stack builds (components/platform/Stack.tsx).
// Pure, so it can be tested in Node.
//
// The screen learns about a build two ways: the page's own data (a stack the server says
// is building) and the id the Build tap got back. It keeps following that id until the
// page's data shows that stack finished, so a refresh that comes back late, stale or not
// at all never drops the screen back to the Build button while a stack is still on its
// way. That happened on Mayank's iPhone on 2026-11-17: the refresh after a build stalled
// on the loading screen, then the screen showed the data it had before the tap.

/** How often the screen asks how a build is going. */
export const POLL_EVERY_MS = 3000;
/** How many times it asks (about 6 minutes) before saying it's taking longer than usual. */
export const POLL_LIMIT = 120;
/** Refreshes after the stack is done that bring the page no closer, before saying so. */
export const STALL_AFTER_DONE = 5;
/** A refresh that hasn't brought new page data after this long is taken as lost. */
export const REFRESH_LOST_AFTER_MS = 10_000;

/**
 * What to do when a status check finds the stack done but the page doesn't show it yet.
 * A refresh still loading is left alone ("wait", not counted): starting another would make
 * Next drop it, so on a slow connection none would ever land. Otherwise the check counts,
 * and it's "refresh" again, or "stall" (say it's taking longer, with Reload) once the page
 * has failed to catch up enough times.
 * `refreshStartedAt` is when the last refresh started, or null once new page data arrived.
 */
export function onDone(checks: number, refreshStartedAt: number | null, now: number): { next: "wait" | "refresh" | "stall"; checks: number } {
  if (refreshStartedAt !== null && now - refreshStartedAt < REFRESH_LOST_AFTER_MS) return { next: "wait", checks };
  const counted = checks + 1;
  return { next: counted >= STALL_AFTER_DONE ? "stall" : "refresh", checks: counted };
}

/** The page's stack, as far as building goes. */
type Shown = { id: string; status: string } | null;

/**
 * The build to follow, or null for none.
 * - The page says a stack is building: follow it (even if this screen didn't start it).
 * - This screen started one (`pending`) and the page doesn't show it finished yet: follow
 *   it. The page may show no stack, or an older one, because its data is from before the tap.
 * - The page shows the pending stack ready or failed: done; the page says how it went.
 * `gone` is a build the server no longer has (deleted with its report): never followed.
 */
export function watchedBuild(stack: Shown, pending: string | null, gone: string | null = null): string | null {
  const id = stack?.status === "building" ? stack.id : pending !== null && stack?.id !== pending ? pending : null;
  return id !== null && id === gone ? null : id;
}

export type PollAnswer = "building" | "done" | "gone" | "unknown";

/**
 * What one status check (GET /api/stack/[id]) says. A dropped connection, a server error,
 * a signed-out answer or a body without a status is "unknown": ask again.
 */
export function pollAnswer(httpStatus: number | null, body: unknown): PollAnswer {
  if (httpStatus === 404) return "gone";
  if (httpStatus === null || httpStatus < 200 || httpStatus >= 300) return "unknown";
  const status = body && typeof body === "object" ? (body as { status?: unknown }).status : undefined;
  if (status === "building") return "building";
  return typeof status === "string" ? "done" : "unknown";
}

/** Notes longer than this show their first sentence, with the rest behind "More". */
export const NOTE_SHORT = 140;

/**
 * A food-gap note's first sentence, and the rest (null when the note is short or a single
 * sentence). Splits on ". ", "? ", "! " or "। ", so saved English, Hindi and Hinglish notes
 * all work (Mayank, 2026-11-20: vitamin D's full paragraph crowded the Stack screen).
 */
export function splitNote(note: string): [string, string | null] {
  if (note.length <= NOTE_SHORT) return [note, null];
  const m = note.match(/^([\s\S]{20,}?[.!?।])\s+(\S[\s\S]*)$/u);
  return m ? [m[1], m[2]] : [note, null];
}
