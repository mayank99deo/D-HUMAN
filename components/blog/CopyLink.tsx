"use client";

import { useEffect, useState } from "react";

// "Copy link", then "Link copied" for a moment. The one bit of script a post needs. Where the
// clipboard is refused (an old browser, a locked-down webview) it says so instead.
export function CopyLink({ url, className = "" }: { url: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <button type="button" onClick={copy} className={className}>
      <span aria-live="polite">{state === "copied" ? "Link copied" : state === "failed" ? "Couldn't copy. Copy the address bar." : "Copy link"}</span>
    </button>
  );
}
