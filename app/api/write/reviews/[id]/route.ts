import { z } from "zod";
import { writeGuard } from "@/lib/auth/author";
import { decideReview } from "@/lib/blog/store";
import { fail, readJson, reply } from "../../http";

// The reviewer's answer from the preview: Looks good, or Needs changes with a note.
const body = z
  .object({
    status: z.enum(["looks_good", "needs_changes"]),
    note: z
      .string()
      .max(1_000)
      .transform((v) => v.trim() || null)
      .nullable(),
    draftVersion: z.number().int().min(1),
  })
  .strict();

export async function POST(request: Request, ctx: RouteContext<"/api/write/reviews/[id]">) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return reply({ error: "invalid" }, 400);
  const result = await decideReview(guard.author, (await ctx.params).id, { ...parsed.data, note: parsed.data.note ?? null });
  return result.ok ? reply(result) : fail(result);
}
