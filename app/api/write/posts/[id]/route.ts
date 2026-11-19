import { z } from "zod";
import { writeGuard } from "@/lib/auth/author";
import { deletePost, getEditorPost, saveDraft } from "@/lib/blog/store";
import { allowRequest } from "@/lib/waitlist/rate-limit";
import { fail, readJson, reply } from "../../http";

// One post for the editor: read it ("Load theirs" after a conflict), autosave it, delete it.

export async function GET(request: Request, ctx: RouteContext<"/api/write/posts/[id]">) {
  const guard = await writeGuard(request, { mutation: false });
  if (!guard.ok) return guard.response;
  const post = await getEditorPost(guard.author, (await ctx.params).id);
  return post ? reply(post) : fail({ error: "not_found" });
}

const saveBody = z.object({ baseVersion: z.number().int().min(1), draft: z.unknown() });

export async function PUT(request: Request, ctx: RouteContext<"/api/write/posts/[id]">) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  // Autosave runs every couple of seconds while someone types; this is only a speed bump.
  if (!allowRequest(`write:save:${guard.author.id}`, 1_200, 10 * 60_000)) return fail({ error: "rate_limited" });
  const body = saveBody.safeParse(await readJson(request));
  if (!body.success) return reply({ error: "invalid", issues: ["body"] }, 400);
  const result = await saveDraft(guard.author, (await ctx.params).id, body.data.baseVersion, body.data.draft);
  return result.ok ? reply(result) : fail(result);
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/write/posts/[id]">) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  const result = await deletePost(guard.author, (await ctx.params).id);
  return result.ok ? reply({ status: "deleted" }) : fail(result);
}
