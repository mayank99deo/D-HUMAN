"use client";

import { useState } from "react";
import { OFFLINE, send } from "@/components/platform/net";
import type { ReviewView } from "@/lib/blog/store";

// On the preview, for the founder asked to read it: Looks good, or Needs changes with a
// note. The answer is for this exact version; if the post changes, it's asked again.

export function ReviewDecision({ review, draftVersion }: { review: ReviewView; draftVersion: number }) {
  const [current, setCurrent] = useState(review);
  const [note, setNote] = useState(review.note ?? "");
  const [changes, setChanges] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: "looks_good" | "needs_changes") {
    setBusy(true);
    setError(null);
    const r = await send<{ review: ReviewView; error: string }>(`/api/write/reviews/${current.id}`, { body: { status, note: status === "needs_changes" ? note : null, draftVersion } });
    setBusy(false);
    if (r.ok && r.data.review) {
      setCurrent(r.data.review);
      setChanges(false);
      return;
    }
    setError(r.offline ? OFFLINE : r.data.error === "changed" ? "The post changed since you opened it. Reload the page and read it again." : "Couldn't send your answer. Try again.");
  }

  const answered = current.draftVersion === draftVersion && current.status !== "requested";
  return (
    <div className="border border-line-strong p-4">
      <p>
        {current.requestedBy.name} asked for your read.{" "}
        {answered ? (current.status === "looks_good" ? "You said Looks good to this version." : "You asked for changes.") : "Your answer applies to this version only."}
      </p>
      {!answered && (
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => decide("looks_good")} className="button-primary h-12">
            Looks good
          </button>
          <button type="button" disabled={busy} onClick={() => setChanges(true)} className="button-ghost h-12">
            Needs changes
          </button>
        </div>
      )}
      {changes && (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm text-graphite">What should change?</span>
            <textarea className="textarea" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="button" disabled={busy} onClick={() => decide("needs_changes")} className="button-primary h-12">
            Send
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error-mark mt-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
