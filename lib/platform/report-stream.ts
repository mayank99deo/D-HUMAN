import "server-only";
import { after } from "next/server";
import { READ_MESSAGES, runAnalysis, type Claim, type Progress } from "./analyze";
import { json, ndjsonStream } from "./http";
import { planLimit } from "./plan";

// What the browser gets when a report can't be claimed for a read.
export function claimRefused(claim: Extract<Claim, { ok: false }>): Response {
  if (claim.reason === "not_found") return json({ error: "not_found" }, 404);
  if (claim.reason === "plan_limit") return planLimit(claim.refusal);
  if (claim.reason === "already_read") return json({ error: "already_read", message: "This report has already been read." }, 409);
  const reason = claim.reason;
  return json({ error: reason, message: READ_MESSAGES[reason] }, reason === "busy" ? 409 : 429);
}

// Streams the progress of a read the caller has claimed (see claimReport).
export function streamAnalysis(reportId: string, userId: string, startedAt: Date) {
  return ndjsonStream(async (send) => {
    send({ type: "created", reportId });
    // The work outlives the connection: if the phone locks mid-read, it still finishes.
    const job = runAnalysis(reportId, userId, startedAt, (p: Progress) => send(p));
    after(() => job);
    await job;
  });
}
