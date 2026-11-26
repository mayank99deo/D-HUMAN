import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { TOUR } from "@/components/platform/tour-stops";
import { appActor, isAppRequest } from "@/lib/api/actor";
import { privateJson } from "@/lib/api/respond";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { json, unauthorized } from "@/lib/platform/http";
import { allowRequest } from "@/lib/waitlist/rate-limit";

// How the tour ended, for the logs only; a missing or odd body still marks it done.
const bodySchema = z.object({ outcome: z.enum(["finished", "skipped"]), stop: z.number().int().min(1).max(TOUR.length) }).partial();

// The first-run tour shows once per person, on any device: finishing or skipping
// it lands here. Only the first time is kept; calling again changes nothing. The web's request is
// answered exactly as before; an app's is taken as its token and answered privately.
export async function POST(request: Request) {
  const app = isAppRequest(request);
  const user = app ? ((await appActor(request))?.user ?? null) : await apiUser();
  if (!user) return app ? privateJson({ error: "signed_out" }, 401) : unauthorized();
  const reply = app ? privateJson : json;
  if (!allowRequest(`tour:${user.id}`, 20, 60 * 60_000)) return reply({ error: "rate_limited" }, 429);
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));

  const d = await db();
  const first = await d
    .update(schema.profiles)
    .set({ tourDoneAt: new Date() })
    .where(and(eq(schema.profiles.userId, user.id), isNull(schema.profiles.tourDoneAt)))
    .returning({ userId: schema.profiles.userId });

  // One line per person, so the logs show how many finish and where the rest skip.
  if (first.length && parsed.success && parsed.data.outcome) {
    console.info(`[tour] ${parsed.data.outcome} at stop ${parsed.data.stop ?? "?"} of ${TOUR.length}`);
  }
  return reply({ status: "done" });
}
