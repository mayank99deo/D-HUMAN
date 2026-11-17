"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OFFLINE, send } from "./net";

// `stay`: on Home itself, refresh it in place (it shows the next report, or a clean start).
export function DeleteReport({ id, stay = false, label = "Delete this report" }: { id: string; stay?: boolean; label?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirming)
    return (
      <button type="button" className="button-ghost h-12" onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-full text-sm">Delete this report with its markers, read and stack? The read it used still counts.</span>
      <button
        type="button"
        disabled={busy}
        className="button-primary h-12"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await send(`/api/reports/${id}`, { method: "DELETE" });
          if (!r.ok) {
            setBusy(false);
            // Health data: never let a failed delete look like it worked.
            return setError(r.offline ? `Nothing was deleted. ${OFFLINE}` : "Nothing was deleted. Try again in a minute.");
          }
          // Home is dynamic, so either fetches it fresh; a refresh on top of a push would render it twice.
          if (stay) {
            // Back to the top first, so the note and the cleared bib are what they see. On touch
            // screens the app scrolls inside #app-shell; on laptops the page itself scrolls.
            document.getElementById("app-shell")?.scrollTo({ top: 0 });
            window.scrollTo({ top: 0 });
            router.replace("/home?deleted=report");
          } else router.push("/home?deleted=report");
        }}
      >
        {busy ? "Deleting…" : "Delete report"}
      </button>
      <button type="button" className="link-quiet min-h-11" onClick={() => setConfirming(false)}>
        Keep it
      </button>
      {error && (
        <p role="alert" className="error-mark w-full text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
