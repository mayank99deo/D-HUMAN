import { eq } from "drizzle-orm";
import { apiUser } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { READ_MESSAGES, claimReport, readLimitReached } from "@/lib/platform/analyze";
import { json, sniffMime, unauthorized } from "@/lib/platform/http";
import { claimRefused, streamAnalysis } from "@/lib/platform/report-stream";
import { planLimit } from "@/lib/platform/plan";
import { currentPlan } from "@/lib/platform/plan-state";
import { getProfile } from "@/lib/platform/profile";
import { allowRequest } from "@/lib/waitlist/rate-limit";

export const maxDuration = 300;

// Hosts cap request bodies around 4.5 MB, so the browser shrinks photos first.
const MAX_TOTAL = 4 * 1024 * 1024;
const MAX_FILES = 6;

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const profile = await getProfile(user.id);
  if (!profile?.onboardedAt) return json({ error: "not_onboarded" }, 409);
  if (await readLimitReached(user.id)) return json({ error: "daily_limit", message: READ_MESSAGES.daily_limit }, 429);
  // A quick check before the upload is stored; claimReport checks again, atomically.
  const { readBlock } = await currentPlan(user.id, profile.timezone);
  if (readBlock) return planLimit(readBlock);

  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return json({ error: "no_file" }, 400);
  if (files.length > MAX_FILES) return json({ error: "too_many_files" }, 400);
  const total = files.reduce((t, f) => t + f.size, 0);
  if (total > MAX_TOTAL) return json({ error: "too_large" }, 413);

  const parts: { mime: string; bytes: Buffer }[] = [];
  for (const f of files) {
    const bytes = Buffer.from(await f.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime) return json({ error: "unsupported_type" }, 415);
    parts.push({ mime, bytes });
  }
  if (parts.some((p) => p.mime === "application/pdf") && parts.length > 1) return json({ error: "one_pdf" }, 400);
  // A first speed bump per server, counted only for uploads that would be read; the daily cap is in the database.
  if (!allowRequest(`report:${user.id}`, 6, 60 * 60_000)) return json({ error: "rate_limited" }, 429);

  const d = await db();
  const reportId = newId();
  // The report and its files are saved together, or not at all.
  await d.transaction(async (tx) => {
    await tx.insert(schema.reports).values({
      id: reportId,
      userId: user.id,
      fileName: files[0].name.slice(0, 200),
      fileCount: parts.length,
      totalBytes: total,
    });
    await tx.insert(schema.reportFiles).values(parts.map((p, i) => ({ id: newId(), reportId, position: i, mime: p.mime, bytes: p.bytes })));
  });

  const claim = await claimReport(reportId, user.id);
  if (!claim.ok) {
    // Only a parallel upload reaching the daily cap first gets here; don't keep a file we won't read.
    await d.delete(schema.reports).where(eq(schema.reports.id, reportId));
    return claimRefused(claim);
  }
  return streamAnalysis(reportId, user.id, claim.startedAt);
}
