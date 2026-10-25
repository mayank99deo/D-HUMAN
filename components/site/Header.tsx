"use client";

import { useSyncExternalStore } from "react";
import { Wordmark } from "@/components/brand/Logo";

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

// Transparent over the hero; a solid black band once content scrolls beneath it.
export function Header() {
  const scrolled = useSyncExternalStore(
    subscribe,
    () => window.scrollY > 24,
    () => false,
  );

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 text-paper transition-colors duration-200 ${
        scrolled ? "border-b border-paper/15 bg-ink" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 sm:h-20 sm:px-8">
        <a href="#top" className="-mx-2 flex h-11 items-center px-2">
          <Wordmark className="h-3.5 w-auto sm:h-4" title="D-Human home" />
        </a>
        <a
          href="#join"
          className="inline-flex min-h-11 items-center border border-paper px-4 text-sm font-semibold whitespace-nowrap transition-colors hover:bg-paper hover:text-ink active:bg-paper active:text-ink"
        >
          Join the waitlist
        </a>
      </div>
    </header>
  );
}
