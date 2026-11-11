"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand/Logo";

const TABS = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/fuel", label: "Fuel", icon: "fuel" },
  { href: "/upload", label: "Upload", icon: "upload" },
  { href: "/wraps", label: "Wraps", icon: "wraps" },
  { href: "/stack", label: "Stack", icon: "stack" },
] as const;

function Icon({ name }: { name: (typeof TABS)[number]["icon"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      {name === "home" && <path {...common} d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z" />}
      {name === "fuel" && (
        <g {...common}>
          {/* A bowl with steam: food, not a clock. */}
          <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" />
          <path d="M9 8c-.8-.9-.8-1.9 0-2.8M12.5 8c-.8-.9-.8-1.9 0-2.8M16 8c-.8-.9-.8-1.9 0-2.8" />
        </g>
      )}
      {name === "upload" && <path {...common} d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4.5 15v4.5h15V15" />}
      {name === "wraps" && (
        <g {...common}>
          <rect x="5" y="3.5" width="14" height="17" />
          <path d="M8.5 15.5 11 12l2 2 2.5-4" />
        </g>
      )}
      {name === "stack" && (
        <g {...common}>
          <rect x="4" y="9" width="16" height="6" rx="3" />
          <path d="M12 9v6" />
        </g>
      )}
    </svg>
  );
}

export function Nav({ initial }: { initial: string }) {
  return <NavView initial={initial} path={usePathname()} />;
}

// The same bar without reading the URL, for the loading state: on dynamic
// routes the path isn't known until the request streams in.
export function NavView({ initial, path }: { initial: string; path: string }) {
  const active = (href: string) => path === href || (href !== "/home" && path.startsWith(href)) || (href === "/home" && path.startsWith("/reports"));
  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-ink/90 px-4 backdrop-blur sm:px-6">
        <Link href="/home" className="flex h-11 items-center" aria-label="D-Human home">
          <Wordmark className="h-3.5 w-auto" />
        </Link>
        <Link
          href="/settings"
          aria-label="Profile and settings"
          className={`grid h-11 w-11 place-items-center text-sm font-bold ${path.startsWith("/settings") ? "text-paper" : "text-graphite"}`}
        >
          <span className="grid h-8 w-8 place-items-center border border-line-strong semiwide">{initial}</span>
        </Link>
      </header>

      {/* Rail on wide screens, tab bar on phones */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:inset-y-0 lg:left-0 lg:right-auto lg:w-24 lg:border-r lg:border-t-0 lg:pt-20"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5 lg:flex lg:max-w-none lg:flex-col lg:gap-2">
          {TABS.map((t) => {
            const on = active(t.href);
            const upload = t.icon === "upload";
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] transition-colors lg:min-h-18 ${
                    on ? "text-paper" : "text-graphite"
                  }`}
                >
                  {/* Every icon gets the same 36 px slot, so all five labels sit on one line. */}
                  <span className={`grid h-9 w-9 place-items-center ${upload ? (on ? "bg-paper text-ink" : "border border-line-strong") : ""}`}>
                    <Icon name={t.icon} />
                  </span>
                  <span className={on ? "font-semibold" : ""}>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
