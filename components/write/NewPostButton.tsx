"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OFFLINE, send } from "@/components/platform/net";

export function NewPostButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        className="button-primary h-12"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await send<{ id: string }>("/api/write/posts", { body: {} });
          if (r.ok && r.data.id) return router.push(`/write/${r.data.id}`);
          setBusy(false);
          setError(r.offline ? OFFLINE : "Couldn't start a post. Try again.");
        }}
      >
        {busy ? "Starting…" : "New post"}
      </button>
      {error && (
        <p role="alert" className="error-mark mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
