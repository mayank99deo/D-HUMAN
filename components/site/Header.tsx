"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Wordmark } from "@/components/brand/Logo";
import { isWaitlist } from "@/lib/site-mode";

const BUTTON =
  "inline-flex min-h-11 items-center border border-paper px-4 text-sm font-semibold whitespace-nowrap transition-colors hover:bg-paper hover:text-ink active:bg-paper active:text-ink";

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

// Transparent over the hero; a solid black band once content scrolls beneath it.
// `subpage`: on the guides, the wordmark goes home and the waitlist button to the
// form on the landing page. The landing page renders exactly as before.
export function Header({ subpage = false }: { subpage?: boolean }) {
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
        {subpage ? (
          <Link href="/" className="-mx-2 flex h-11 items-center px-2">
            <Wordmark className="h-3.5 w-auto sm:h-4" title="D-Human home" />
          </Link>
        ) : (
          <a href="#top" className="-mx-2 flex h-11 items-center px-2">
            <Wordmark className="h-3.5 w-auto sm:h-4" title="D-Human home" />
          </a>
        )}
        {isWaitlist ? (
          <a href={subpage ? "/#join" : "#join"} className={BUTTON}>
            Join the waitlist
          </a>
        ) : (
          // New people start here too: the sign-in form makes the account.
          <Link href="/signin" className={BUTTON}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
