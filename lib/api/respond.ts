import { createHash } from "node:crypto";

// Answers for the routes the apps use (the mobile repo's docs/API.md §2.6, §4.2).
//
// - Every answer is `private, no-store`, 4xx included (A8): no HTTP cache anywhere (the phone's
//   URL cache, a proxy, Vercel's CDN) may keep one person's data. The apps keep their own copy.
// - Screen reads add a weak ETag. The app sends it back in If-None-Match and gets 304 with no
//   body when nothing changed: it saves bytes on slow networks, not database work. A 304 can't
//   leak, because the tag is checked against the asker's own freshly built body.

export const PRIVATE = "private, no-store";

export const privateJson = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...headers, "cache-control": PRIVATE } });

/** W/"<first 16 bytes of the body's SHA-256, base64url>". */
export const etagOf = (text: string) => `W/"${createHash("sha256").update(text).digest().subarray(0, 16).toString("base64url")}"`;

/** Whether If-None-Match names this tag (weak comparison, RFC 9110 §13.1.2). */
export function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const want = etag.replace(/^W\//, "");
  return ifNoneMatch.split(",").some((t) => {
    const tag = t.trim();
    return tag === "*" || tag.replace(/^W\//, "") === want;
  });
}

/** A screen's JSON with its ETag, or 304 when the app already holds this exact body. */
export function viewResponse(request: Request, body: unknown): Response {
  const text = JSON.stringify(body);
  const etag = etagOf(text);
  const headers = { "cache-control": PRIVATE, etag };
  if (matches(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(text, { status: 200, headers: { ...headers, "content-type": "application/json" } });
}
