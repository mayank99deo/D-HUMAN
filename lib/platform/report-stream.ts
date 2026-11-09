import "server-only";
import { after } from "next/server";
import { runAnalysis, type Progress } from "./analyze";
import { ndjsonStream } from "./http";

export function streamAnalysis(reportId: string, userId: string) {
  return ndjsonStream(async (send) => {
    send({ type: "created", reportId });
    // The work outlives the connection: if the phone locks mid-read, it still finishes.
    const job = runAnalysis(reportId, userId, (p: Progress) => send(p));
    after(() => job);
    await job;
  });
}
