"use client";

import { openAsk, preloadAsk } from "./ask-open";
import type { Prefill } from "./ask-starters";

/**
 * "Ask about this": opens Ask with the box prefilled and an "About" chip above it. It
 * never sends; only the person's own tap on Ask does. Pages show it only when Ask is open
 * to the person (askGate), and only next to the things people wonder about.
 */
export function AskAbout({ prefill, label, className = "" }: { prefill: Prefill; label: string; className?: string }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onPointerDown={preloadAsk}
      onPointerEnter={preloadAsk}
      onFocus={preloadAsk}
      onClick={() => openAsk(prefill)}
      className={`link-quiet inline-flex min-h-11 items-center text-left text-sm ${className}`}
    >
      {label}
    </button>
  );
}
