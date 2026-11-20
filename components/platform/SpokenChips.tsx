"use client";

import { useEffect, useRef } from "react";
import { SPOKEN, type Spoken, type SpokenId } from "@/lib/domain/speech";

/**
 * The 12 "Speaking in" chips, one row that scrolls sideways on phones inside its own box
 * and wraps on wider screens. The picked chip is scrolled into view when the row opens.
 */
export function SpokenChips({ name, spoken, onPick, className = "" }: { name: string; spoken: Spoken; onPick: (id: SpokenId) => void; className?: string }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = row.current;
    const chip = r?.querySelector<HTMLElement>("[data-picked]");
    if (r && chip) r.scrollLeft += chip.getBoundingClientRect().left - r.getBoundingClientRect().left - 16;
  }, []);
  return (
    // min-w-0: a fieldset otherwise grows to fit its widest row, which would widen the page.
    <fieldset className={`min-w-0 ${className}`}>
      <legend className="sr-only">Speaking in</legend>
      {/* relative: the hidden radios are absolutely placed, and would otherwise widen the page. */}
      <div ref={row} className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
        <div className="flex w-max gap-2 pb-1 sm:w-auto sm:flex-wrap">
          {SPOKEN.map((s) => (
            <label key={s.id} className="choice shrink-0" lang={s.translateFrom ?? "en"} dir={s.id === "ur" ? "rtl" : undefined} data-picked={spoken.id === s.id ? "" : undefined}>
              <input type="radio" name={name} className="sr-only" checked={spoken.id === s.id} onChange={() => onPick(s.id)} />
              {s.label}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
