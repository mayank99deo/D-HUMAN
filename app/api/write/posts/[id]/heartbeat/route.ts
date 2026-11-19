import { writeGuard } from "@/lib/auth/author";
import { heartbeat } from "@/lib/blog/store";
import { fail, reply } from "../../../http";

// Sent every minute while an editor is open, so the other writer sees "{Name} is editing".
export async function POST(request: Request, ctx: RouteContext<"/api/write/posts/[id]/heartbeat">) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  return (await heartbeat(guard.author, (await ctx.params).id)) ? reply({ ok: true }) : fail({ error: "not_found" });
}
