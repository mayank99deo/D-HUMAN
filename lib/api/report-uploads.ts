import "server-only";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { REPORT_UPLOAD } from "@/lib/domain/uploads";
import { READ_MESSAGES, claimReport, readLimitReached, runAnalysis } from "@/lib/platform/analyze";
import { MEAL_KEY } from "@/lib/platform/food";
import { sniffMime } from "@/lib/platform/http";
import { streamAnalysis } from "@/lib/platform/report-stream";
import { currentPlan } from "@/lib/platform/plan-state";
import { allowRequest, secondsUntilReset } from "@/lib/waitlist/rate-limit";
import type { appOnly } from "./actor";
import { withoutNul } from "./clean";
import { appPlanLimit, appRefusal } from "./errors";
import { privateJson } from "./respond";

// A blood report uploaded from an app (the mobile repo's docs/API.md §3.4 and §5; gap G10). The
// web's upload (app/api/reports/route.ts) is untouched; this is the same checks and the same read,
// answered for the apps:
// - `key`: one try's key. A resend with it returns the report it made and never claims a read.
// - `Prefer: respond-async`: 202 { reportId } with Location at once; the read runs on after the
//   answer, and the app polls GET /api/reports/{id} (or waits for its push). Without it, the
//   same NDJSON stream as the web.
// - `pagesSent` and `pagesOf`: the phone could send only some pages of a long report (the 4 MB
//   limit); they're kept, and the read says it was read from those pages.

type Member = Extract<Awaited<ReturnType<typeof appOnly>>, { ok: true }>;

const fields = z.object({
  key: z.string().regex(MEAL_KEY).optional(),
  pagesSent: z.coerce.number().int().min(1).max(500).optional(),
  pagesOf: z.coerce.number().int().min(1).max(500).optional(),
});

const UPLOAD_WORDS: Record<string, string> = {
  no_file: "Add the report's PDF, or photos of its pages.",
  too_many_files: `Send at most ${REPORT_UPLOAD.maxFiles} photos.`,
  too_large: "That's over 4 MB. Send the PDF as page photos, or fewer pages.",
  unsupported_type: "We can read a PDF, or JPEG, PNG and WebP photos.",
  one_pdf: "Send one PDF on its own, or photos without a PDF.",
  invalid: "We couldn't read that upload. Update the app, then try again.",
};
const refuse = (error: string, status: number) => appRefusal(error, status, { message: UPLOAD_WORDS[error] });

const accepted = (reportId: string, repeat = false) =>
  privateJson({ reportId, ...(repeat ? { repeat: true } : {}) }, 202, { location: `/api/reports/${reportId}` });

async function byKey(userId: string, key: string) {
  const d = await db();
  const [r] = await d.select({ id: schema.reports.id }).from(schema.reports).where(and(eq(schema.reports.userId, userId), eq(schema.reports.uploadKey, key))).limit(1);
  return r?.id ?? null;
}

export async function appUpload(request: Request, member: Member): Promise<Response> {
  const { user, profile } = member;
  const async = /\brespond-async\b/i.test(request.headers.get("prefer") ?? "");
  const form = await request.formData().catch(() => null);
  const parsed = fields.safeParse({ key: form?.get("key") || undefined, pagesSent: form?.get("pagesSent") || undefined, pagesOf: form?.get("pagesOf") || undefined });
  if (!form || !parsed.success) return refuse("invalid", 400);
  const { key, pagesSent, pagesOf } = parsed.data;
  // A resend of a try that already made its report: that report, with no second read.
  if (key) {
    const had = await byKey(user.id, key);
    if (had) return accepted(had, true);
  }
  if (await readLimitReached(user.id)) return appRefusal("daily_limit", 429, { message: READ_MESSAGES.daily_limit, retryAfter: 3600 });
  const { readBlock } = await currentPlan(user.id, profile.timezone);
  if (readBlock) return appPlanLimit(readBlock);

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return refuse("no_file", 400);
  if (files.length > REPORT_UPLOAD.maxFiles) return refuse("too_many_files", 400);
  const total = files.reduce((t, f) => t + f.size, 0);
  if (total > REPORT_UPLOAD.maxTotalBytes) return refuse("too_large", 413);
  const parts: { mime: string; bytes: Buffer }[] = [];
  for (const f of files) {
    const bytes = Buffer.from(await f.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime) return refuse("unsupported_type", 415);
    parts.push({ mime, bytes });
  }
  if (parts.some((p) => p.mime === "application/pdf") && parts.length > 1) return refuse("one_pdf", 400);

  const d = await db();
  const reportId = newId();
  const pages = pagesSent && pagesOf && pagesSent < pagesOf ? { sent: pagesSent, of: pagesOf } : null;
  const made = await d.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.reports)
      .values({ id: reportId, userId: user.id, fileName: withoutNul(files[0].name).slice(0, 200), fileCount: parts.length, totalBytes: total, uploadKey: key ?? null, pages })
      .onConflictDoNothing()
      .returning({ id: schema.reports.id });
    if (!row) return false;
    await tx.insert(schema.reportFiles).values(parts.map((p, i) => ({ id: newId(), reportId, position: i, mime: p.mime, bytes: p.bytes })));
    return true;
  });
  // The same try, sent twice at once: the other request made the report.
  if (!made) {
    const had = key ? await byKey(user.id, key) : null;
    return had ? accepted(had, true) : refuse("invalid", 400);
  }
  // The hour's 6 count new tries only. Checked once this request has made its report, so the same
  // try sent several times at once (each past the key lookup above before any had made it) is one
  // report, never a 429 (backend test engineer, hunt 1: 4 of 10 such sends were 429 on Postgres).
  if (!allowRequest(`report:${user.id}`, 6, 60 * 60_000)) {
    await d.delete(schema.reports).where(eq(schema.reports.id, reportId));
    return appRefusal("rate_limited", 429, { message: "That's a lot of uploads in an hour. Try again a bit later.", retryAfter: secondsUntilReset(`report:${user.id}`) });
  }
  const claim = await claimReport(reportId, user.id);
  if (!claim.ok) {
    await d.delete(schema.reports).where(eq(schema.reports.id, reportId));
    if (claim.reason === "plan_limit") return appPlanLimit(claim.refusal);
    return appRefusal(claim.reason, claim.reason === "busy" ? 409 : 429, { message: READ_MESSAGES[claim.reason as keyof typeof READ_MESSAGES] ?? "Try again in a moment.", retryAfter: 60 });
  }
  if (!async) return streamAnalysis(reportId, user.id, claim.startedAt);
  after(() => runAnalysis(reportId, user.id, claim.startedAt, () => {}));
  return accepted(reportId);
}
