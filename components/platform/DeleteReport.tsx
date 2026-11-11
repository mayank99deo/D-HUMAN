"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OFFLINE, send } from "./net";

export function DeleteReport({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirming)
    return (
      <button type="button" className="button-ghost h-12" onClick={() => setConfirming(true)}>
        Delete this report
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm">Delete the file, its markers and its read?</span>
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
          router.push("/home");
          router.refresh();
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
