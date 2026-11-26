import { and, eq } from "drizzle-orm";
import { appActor, isAppRequest } from "@/lib/api/actor";
import { updateRequired } from "@/lib/api/version";
import { privateJson } from "@/lib/api/respond";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { json, unauthorized } from "@/lib/platform/http";
import { STACK_MESSAGES, isStaleBuild, settleStaleStack } from "@/lib/platform/stack";

// A stack build's progress, polled while it builds. The web's request is answered exactly as
// before; an app's is taken as its token and answered privately. When it's ready, the app
// fetches GET /api/stack, so the hold and the doses come from one builder.
export async function GET(request: Request, ctx: RouteContext<"/api/stack/[id]">) {
  const app = isAppRequest(request);
  const outdated = app ? updateRequired(request) : null; // 426 for an app below the oldest version served
  if (outdated) return outdated;
  const user = app ? ((await appActor(request))?.user ?? null) : await apiUser();
  if (!user) return app ? privateJson({ error: "signed_out" }, 401) : unauthorized();
  const reply = app ? privateJson : json;
  const { id } = await ctx.params;
  const d = await db();
  const [s] = await d
    .select({ status: schema.stacks.status, error: schema.stacks.error, createdAt: schema.stacks.createdAt })
    .from(schema.stacks)
    .where(and(eq(schema.stacks.id, id), eq(schema.stacks.userId, user.id)))
    .limit(1);
  if (!s) return reply({ error: "not_found" }, 404);
  // A stack that died while building ends as failed, so the screen stops waiting.
  if (s.status === "building" && isStaleBuild(s.createdAt) && (await settleStaleStack(id, user.id))) {
    return reply({ status: "failed", error: STACK_MESSAGES.stale });
  }
  return reply({ status: s.status, error: s.error });
}
