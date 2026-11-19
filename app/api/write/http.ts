import "server-only";

// Shared by the /api/write routes (not a route itself). Every answer is no-store: these
// are one author's working copies, never something a cache should keep.

export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** JSON bodies only: a cross-site form can't send application/json without asking first. */
export async function readJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return undefined;
  return request.json().catch(() => undefined);
}

const STATUS: Record<string, number> = {
  not_found: 404,
  conflict: 409,
  slug_taken: 409,
  taken_down: 409,
  wrong_state: 409,
  changed: 409,
  invalid: 422,
  checks: 422,
  checklist: 422,
  review_needed: 422,
  no_reviewer: 422,
  sign_in_again: 403,
  not_reviewer: 403,
  rate_limited: 429,
};

/** A store result's error as its HTTP status, with the whole result as the body. */
export const fail = (result: { error: string }) => reply(result, STATUS[result.error] ?? 400);
