import { createHash, timingSafeEqual } from "node:crypto";
import { runDaily } from "@/lib/email/jobs";
import { json } from "@/lib/platform/http";

// The daily email job (lib/email/jobs.ts). Vercel Cron calls it twice a day (vercel.json:
// "0 5 * * *" about 10:30 IST, "0 14 * * *" about 19:30 IST) with
// `Authorization: Bearer <CRON_SECRET>`. A run that finds another one going answers 200
// "busy". `?dry=1` runs everything dry and read-only and answers with the counts.
// Manual runs: Vercel's Cron Jobs tab, or curl with the same header.

export const maxDuration = 300;

/** Constant time, whatever the lengths: both sides are hashed first. */
function authorised(header: string | null, secret: string): boolean {
  const given = createHash("sha256").update(header ?? "").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "not_configured" }, 503);
  if (!authorised(auth, secret)) return json({ error: "unauthorized" }, 401);
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const schedule = request.headers.get("x-vercel-cron-schedule");
  if (schedule) console.info(`[email] daily run from cron "${schedule}"`);
  const result = await runDaily({ dry });
  return json(result, result.status === "error" ? 500 : 200);
}
