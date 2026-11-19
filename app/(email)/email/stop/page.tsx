import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Wordmark } from "@/components/brand/Logo";
import { stopLinkState } from "@/lib/email/prefs";
import { StopPanel } from "./StopPanel";

// The page behind "Stop weekly wraps" (and "Stop questions") in an email's footer. No
// sign-in: the signed link names the person and the kind of email. Rendering it only
// reads; the email stops only when the person taps the button (a POST). The address is
// never shown, so a forwarded email reveals nothing about whose it was.

export const metadata: Metadata = {
  title: "Email settings | D-Human",
  robots: { index: false, follow: false },
  // The link's token never leaves in a Referer header.
  referrer: "no-referrer",
};

async function Stop({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The link and the settings are read against the clock, so wait for the request (as /feedback does).
  await connection();
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";
  const state = await stopLinkState(token);

  if (state.status === "invalid") {
    return (
      <>
        <h1 className="headline text-[clamp(2rem,7vw,2.75rem)]">This link doesn&apos;t work.</h1>
        <p className="mt-4 text-graphite">It may have been cut short when it was copied. Sign in to change your emails in Settings.</p>
        <Link href="/settings#emails" className="button-primary mt-8 h-13 w-full">
          Email settings
        </Link>
      </>
    );
  }
  if (state.status === "gone") {
    return (
      <>
        <h1 className="headline text-[clamp(2rem,7vw,2.75rem)]">Nothing more to stop.</h1>
        <p className="mt-4 text-graphite">This account has been deleted, so it gets no emails from us.</p>
      </>
    );
  }
  const { prefs } = state;
  return <StopPanel token={token} category={state.token.k} initial={{ weekly: prefs.weekly, questions: prefs.questions, weeklyPaused: Boolean(prefs.weeklyPausedAt) }} />;
}

export default function StopPage({ searchParams }: PageProps<"/email/stop">) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-8">
      <Link href="/" className="flex h-11 items-center self-start" aria-label="D-Human home">
        <Wordmark className="h-3.5 w-auto" />
      </Link>
      <div className="mt-auto pt-16">
        <Suspense fallback={<p className="text-graphite">Loading your email settings…</p>}>
          <Stop searchParams={searchParams} />
        </Suspense>
      </div>
      <p className="mt-10 text-sm text-graphite">D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.</p>
    </main>
  );
}
