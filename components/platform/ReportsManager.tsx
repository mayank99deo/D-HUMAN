"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { OFFLINE, send } from "./net";

export type ReportItem = {
  id: string;
  status: string;
  title: string;
  /** "Collected 3 Nov 2026" or "Uploaded 3 Nov 2026". */
  when: string;
  markers: number;
  /** The name printed on the report when it isn't the person's own. */
  printedFor: string | null;
};

const READING = new Set(["uploaded", "reading", "interpreting"]);

// Every report someone has uploaded, each with Delete, and "Start fresh" to delete them
// all. Deleting a friend's report tried on the app puts Home back on their own latest
// report, or back to clean when it was the only one.
export function ReportsManager({ reports }: { reports: ReportItem[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    const r = await send(id === "all" ? "/api/reports" : `/api/reports/${id}`, { method: "DELETE" });
    if (!r.ok) {
      setBusy(null);
      // Health data: never let a failed delete look like it worked.
      return setError(r.offline ? `Nothing was deleted. ${OFFLINE}` : "Nothing was deleted. Try again in a minute.");
    }
    setConfirming(null);
    setBusy(null);
    // A clean start shows on Home; one report gone just leaves the rest listed here.
    if (id === "all") router.push("/home?deleted=all");
    else startTransition(() => router.refresh());
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-8 sm:px-6 lg:pt-12">
      <Link href="/home" className="link-quiet inline-flex min-h-11 items-center text-sm">
        Back to home
      </Link>
      <h1 className="verdict-type mt-4 text-[clamp(2.25rem,6.5vw,3.5rem)]">Your reports</h1>
      <p className="mt-3 max-w-prose text-graphite">
        Delete a report you don&apos;t need, like a friend&apos;s you tried the app with. Its markers, read, stack and any wrap that counted it go
        with it, and Home moves to your latest report that&apos;s left.
      </p>

      {error && (
        <p role="alert" className="error-mark mt-6 text-sm">
          {error}
        </p>
      )}

      {reports.length === 0 ? (
        <section className="mt-10 border-t border-line pt-6">
          <p className="text-lg">No reports. Home is clean.</p>
          <p className="mt-2 text-graphite">Upload your own blood report whenever you have one, PDF or photos.</p>
          <Link href="/upload" className="button-primary mt-6 h-12">
            Upload a blood report
          </Link>
        </section>
      ) : (
        <>
          <ul className={`mt-8 border-b border-line ${refreshing ? "opacity-70" : ""}`}>
            {reports.map((r) => (
              <li key={r.id} className="border-t border-line py-5">
                <p className="text-lg font-bold semiwide">{r.title}</p>
                <p className="mt-1 text-sm text-graphite">
                  {r.when}
                  {r.status === "ready" ? `, ${r.markers} marker${r.markers === 1 ? "" : "s"}` : ""}
                </p>
                {READING.has(r.status) && <p className="mt-1 text-sm">Being read now</p>}
                {r.status === "failed" && <p className="mt-1 text-sm">Couldn&apos;t be read</p>}
                {r.printedFor && <p className="error-mark mt-2 text-sm">Printed for {r.printedFor}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {confirming === r.id ? (
                    <>
                      <span className="w-full text-sm">Delete this report with its markers, read and stack? The read it used still counts.</span>
                      <button type="button" disabled={!!busy} className="button-primary h-11" onClick={() => remove(r.id)}>
                        {busy === r.id ? "Deleting…" : "Delete report"}
                      </button>
                      <button type="button" disabled={!!busy} className="link-quiet min-h-11 text-sm" onClick={() => setConfirming(null)}>
                        Keep it
                      </button>
                    </>
                  ) : (
                    <>
                      {r.status === "ready" && (
                        <Link href={`/reports/${r.id}`} className="button-ghost h-11">
                          Open
                        </Link>
                      )}
                      {READING.has(r.status) && (
                        <Link href={`/upload?report=${r.id}`} className="button-ghost h-11">
                          Watch
                        </Link>
                      )}
                      <button type="button" disabled={!!busy} className="button-ghost h-11" onClick={() => setConfirming(r.id)} aria-label={`Delete ${r.title}, ${r.when}`}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* With one report, its own Delete does the same, so Start fresh waits for a second. */}
          {reports.length > 1 && (
            <section className="mt-14 border border-line-strong p-5" aria-labelledby="fresh">
              <h2 id="fresh" className="text-xl font-bold semiwide">
                Start fresh
              </h2>
              <p className="mt-2 text-sm text-graphite">
                Deletes {reports.length === 2 ? "both" : `all ${reports.length}`} reports with their markers, reads and stacks. Home goes back to how it looked before your first upload. Your
                meals, targets and profile stay.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {confirming === "all" ? (
                  <>
                    <span className="w-full text-sm">Delete {reports.length === 2 ? "both" : `all ${reports.length}`} for good? The reads they used still count.</span>
                    <button type="button" disabled={!!busy} className="button-primary h-12" onClick={() => remove("all")}>
                      {busy === "all" ? "Deleting…" : "Delete all reports"}
                    </button>
                    <button type="button" disabled={!!busy} className="link-quiet min-h-11 text-sm" onClick={() => setConfirming(null)}>
                      Keep them
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={!!busy} className="button-ghost h-12" onClick={() => setConfirming("all")}>
                    Delete all reports
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
