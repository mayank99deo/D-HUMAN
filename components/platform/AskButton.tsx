"use client";

import { useSyncExternalStore } from "react";
import { ASK_COPY } from "./ask-copy";
import { askPhase, openAsk, preloadAsk } from "./ask-open";

/**
 * Ask in the top bar, just left of the profile initial. A quiet outline with the logo's
 * cut corner: the word on phones, a field-shaped button from tablets up, with a "/" hint
 * where a keyboard and pointer can hover. Never a count, badge, dot or colour.
 */
export function AskButton() {
  const phase = useSyncExternalStore(askPhase.subscribe, askPhase.get, askPhase.server);
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={phase === "open"}
      aria-label={ASK_COPY.controlName}
      // Until the sheet's code arrives the control shows pressed; no spinner.
      aria-busy={phase === "loading" || undefined}
      onPointerDown={preloadAsk}
      onPointerEnter={preloadAsk}
      onFocus={preloadAsk}
      onClick={() => openAsk()}
      className="group/ctl flex h-11 shrink-0 items-center"
    >
      <span
        data-tour="ask"
        className="ask-notch flex h-8 items-center gap-3 border border-line-strong px-3 text-sm text-paper semiwide group-active/ctl:bg-lift group-aria-busy/ctl:bg-lift md:h-9 md:w-80 md:justify-between md:border-line md:text-graphite md:[--notch-line:var(--color-line)] xl:w-96"
      >
        <span className="md:hidden">{ASK_COPY.control}</span>
        <span className="hidden truncate md:inline">{ASK_COPY.controlWide}</span>
        <kbd aria-hidden className="hidden h-6 min-w-6 place-items-center border border-line px-1.5 font-sans text-xs text-graphite lg:[@media(hover:hover)]:grid">
          {ASK_COPY.keyHint}
        </kbd>
      </span>
    </button>
  );
}
