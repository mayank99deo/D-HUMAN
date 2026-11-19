import { z } from "zod";
import { writeGuard } from "@/lib/auth/author";
import { changeStatus } from "@/lib/blog/store";
import { fail, readJson, reply } from "../../../http";

// Take down, restore, or discard the draft's changes back to what's live.
const body = z.object({ action: z.enum(["take_down", "restore", "discard"]) }).strict();

export async function POST(request: Request, ctx: RouteContext<"/api/write/posts/[id]/status">) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return reply({ error: "invalid" }, 400);
  const result = await changeStatus(guard.author, (await ctx.params).id, parsed.data.action);
  return result.ok ? reply(result) : fail(result);
}
