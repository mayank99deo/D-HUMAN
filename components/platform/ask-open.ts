// How the app reaches the Ask sheet. The top-bar control, "Ask about this" links and the
// "/" key ask for it with a window event; the host in the app layout (AskHost.tsx) loads
// the sheet's code on first intent and opens it. The sheet's code is in no page's bundle:
// it's fetched on pointerdown, focus or hover, or at idle a few seconds after load (UX spec §13).
// Browser-only: import it from client components.
import type { Prefill } from "./ask-starters";

export const ASK_OPEN_EVENT = "dh:ask-open";

export type OpenRequest = {
  /** Different for every request, so the same prefill twice still applies twice. */
  nonce: number;
  prefill: Prefill | null;
  /** Where focus goes back to when the sheet closes. */
  opener: HTMLElement | null;
};

type SheetModule = typeof import("./AskSheet");
let sheet: Promise<SheetModule> | null = null;

/** Starts fetching the sheet's code once; a failed fetch can be tried again. */
export function loadAskSheet(): Promise<SheetModule> {
  sheet ??= import("./AskSheet").catch((e: unknown) => {
    sheet = null;
    throw e;
  });
  return sheet;
}

/** For intent handlers: start loading, never throw. */
export function preloadAsk() {
  void loadAskSheet().catch(() => {});
}

let nonce = 0;
export function openAsk(prefill: Prefill | null = null) {
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  window.dispatchEvent(new CustomEvent<OpenRequest>(ASK_OPEN_EVENT, { detail: { nonce: ++nonce, prefill, opener } }));
}

// Whether the sheet is closed, loading its code, or open: the control's pressed state and aria-expanded.
export type AskPhase = "closed" | "loading" | "open";
let phase: AskPhase = "closed";
const listeners = new Set<() => void>();

export const askPhase = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: (): AskPhase => phase,
  server: (): AskPhase => "closed",
  set(next: AskPhase) {
    if (phase === next) return;
    phase = next;
    for (const l of listeners) l();
  },
};

/** Typing in a field, or another dialog (the tour) open: "/" is just a character then. */
export function keyIsForPage(target: EventTarget | null) {
  if (document.querySelector("dialog[open]")) return false;
  if (!(target instanceof HTMLElement)) return true;
  return !(target.isContentEditable || target.closest("input, textarea, select, [contenteditable]"));
}
