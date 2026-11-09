"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteReport({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
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
          await fetch(`/api/reports/${id}`, { method: "DELETE" });
          router.push("/home");
          router.refresh();
        }}
      >
        Delete report
      </button>
      <button type="button" className="link-quiet min-h-11" onClick={() => setConfirming(false)}>
        Keep it
      </button>
    </div>
  );
}
