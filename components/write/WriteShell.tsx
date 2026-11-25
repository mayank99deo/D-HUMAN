import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/Logo";
import { Stall } from "@/components/platform/Stall";

// The frame of every /write screen: the wordmark, "Write", and the places a writer goes
// (Status is the founders' email status page). Black, like the app. Not the app's tab
// bar: writers needn't be app users.

const LINKS = [
  { href: "/write", label: "Posts", key: "posts" },
  { href: "/write/import", label: "Import", key: "import" },
  { href: "/write/profile", label: "Your profile", key: "profile" },
  { href: "/write/status", label: "Status", key: "status" },
] as const;

type ShellProps = { children: ReactNode; active?: (typeof LINKS)[number]["key"]; nav?: boolean; wide?: boolean };

export function WriteShell({ children, active, nav = true, wide = false }: ShellProps) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        {/* Phones: the links wrap to a second row under the wordmark, so nothing scrolls sideways at 320 px. */}
        <div className={`mx-auto flex min-h-14 flex-wrap items-center gap-x-3 px-4 sm:flex-nowrap sm:px-6 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
          <Link href="/" className="flex h-11 items-center" aria-label="D-Human home">
            <Wordmark className="h-3 w-auto" />
          </Link>
          <span className="text-sm font-semibold semiwide">Write</span>
          {nav && (
            <nav aria-label="Writing" className="-ml-2 flex w-full sm:ml-auto sm:w-auto">
              {LINKS.map((l) => (
                <Link
                  key={l.key}
                  href={l.href}
                  aria-current={active === l.key ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center px-2 text-sm sm:px-3 ${active === l.key ? "text-paper underline underline-offset-4" : "text-graphite active:text-paper"}`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}

/** Signed out, or signed in but not a writer. Never says which emails are listed. */
export function Gate({ kind, next = "/write" }: { kind: "signed_out" | "not_author"; next?: string }) {
  return (
    <WriteShell nav={false}>
      <main className="mx-auto max-w-xl px-4 pt-16 pb-20 sm:px-6">
        {kind === "signed_out" ? (
          <>
            <h1 className="verdict-type text-[clamp(2rem,6vw,3rem)]">Sign in to write</h1>
            <p className="mt-4 text-graphite">Use the email you write with. We send a 6-digit code, then bring you back to your posts.</p>
            <Link href={`/signin?next=${encodeURIComponent(next)}`} className="button-primary mt-8 h-12">
              Sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="verdict-type text-[clamp(2rem,6vw,3rem)]">This area is for D-Human&apos;s writers.</h1>
            <Link href="/home" className="button-ghost mt-8 h-12">
              Go to your home screen
            </Link>
          </>
        )}
      </main>
    </WriteShell>
  );
}

/** While a /write screen streams in. After 6 s it says so and offers Reload, like the app's screens, so a stuck load is never a dead end. */
export function WriteLoading({ title, wide = false }: { title: string; wide?: boolean }) {
  return (
    <WriteShell wide={wide}>
      <main className={`mx-auto px-4 pt-10 sm:px-6 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
        <h1 className="verdict-type text-[clamp(2rem,6vw,3rem)]">{title}</h1>
        <p className="mt-4 text-graphite" role="status" aria-live="polite">
          Loading…
        </p>
        <Stall />
      </main>
    </WriteShell>
  );
}
