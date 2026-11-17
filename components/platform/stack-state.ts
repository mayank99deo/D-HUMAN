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
/** Asks after the stack is done but the page still doesn't show it, before saying so. */
export const STALL_AFTER_DONE = 5;

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
