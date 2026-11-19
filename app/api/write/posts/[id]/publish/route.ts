import { z } from "zod";
import { writeGuard } from "@/lib/auth/author";
import { publishPost } from "@/lib/blog/store";
import { CHECKLIST_ITEMS } from "@/lib/blog/types";
import { allowRequest } from "@/lib/waitlist/rate-limit";
import { fail, readJson, reply } from "../../../http";

// Publish now, or Update post. The store re-checks everything in one transaction; this
// route only checks the request's shape. Needs a sign-in from the last 7 days.

const body = z
  .object({
    draftVersion: z.number().int().min(1),
    checklist: z.partialRecord(z.enum(CHECKLIST_ITEMS), z.string().max(40)),
    meaningful: z.boolean(),
    featured: z.boolean(),
    shareImageId: z.string().max(40).nullable(),
  })
  .strict();

export async function POST(request: Request, ctx: RouteContext<"/api/write/posts/[id]/publish">) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  if (!allowRequest(`write:publish:${guard.author.id}`, 60, 60 * 60_000)) return fail({ error: "rate_limited" });
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return reply({ error: "invalid", issues: parsed.error.issues.map((i) => i.path.join(".")) }, 400);
  const result = await publishPost(guard.author, (await ctx.params).id, parsed.data);
  return result.ok ? reply(result) : fail(result);
}
