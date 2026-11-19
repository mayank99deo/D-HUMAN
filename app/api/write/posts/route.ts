import { writeGuard } from "@/lib/auth/author";
import { createPost } from "@/lib/blog/store";
import { allowRequest } from "@/lib/waitlist/rate-limit";
import { fail, readJson, reply } from "../http";

// A new post: empty ({}), or from the import screen ({ draft }).
export async function POST(request: Request) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  if (!allowRequest(`write:create:${guard.author.id}`, 60, 60 * 60_000)) return fail({ error: "rate_limited" });
  const body = await readJson(request);
  if (!body || typeof body !== "object") return reply({ error: "invalid" }, 400);
  const result = await createPost(guard.author, (body as { draft?: unknown }).draft);
  return result.ok ? reply({ id: result.id }, 201) : fail(result);
}
