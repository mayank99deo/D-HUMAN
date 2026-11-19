import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Wordmark } from "@/components/brand/Logo";
import { feedbackPageState } from "@/lib/email/feedback";
import { FeedbackFlow } from "./FeedbackFlow";

// The page behind the feedback email's answer buttons. No sign-in: the signed link names
// one person and one survey. Rendering it only reads, so a mail scanner opening every
// option records nothing; the tapped answer shows as chosen and is saved when the person
// confirms it. Only that person's own answers are shown, and never the words of a typed
// note, so a forwarded email reveals little.

export const metadata: Metadata = {
  title: "Tell us what to build | D-Human",
  robots: { index: false, follow: false },
  // The link's token never leaves in a Referer header.
  referrer: "no-referrer",
};

const SEND_ID = /^[A-Za-z0-9-]{1,64}$/;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

async function Survey({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The link's expiry is checked against the clock, so wait for the request.
  await connection();
  const params = await searchParams;
  const token = one(params.t) ?? "";
  const state = await feedbackPageState(token, { q: one(params.q), a: one(params.a), at: one(params.at) });

  if (state.status === "invalid") {
    return (
      <>
        <h1 className="headline text-[clamp(2rem,7vw,2.75rem)]">This link has closed.</h1>
        <p className="mt-4 text-graphite">
          Questions stay open for 30 days after the email, and the link may have been cut short when it was copied. You can still tell us what to build from Settings.
        </p>
        <Link href="/settings" className="button-primary mt-8 h-13 w-full">
          Settings
        </Link>
      </>
    );
  }
  if (state.status === "gone") {
    return (
      <>
        <h1 className="headline text-[clamp(2rem,7vw,2.75rem)]">Nothing to answer.</h1>
        <p className="mt-4 text-graphite">This account has been deleted, and its answers with it.</p>
      </>
    );
  }
  const sendId = one(params.e);
  return (
    <FeedbackFlow
      token={token}
      sendId={sendId && SEND_ID.test(sendId) ? sendId : null}
      path={state.path}
      firstName={state.firstName}
      saved={state.saved}
      hasNote={state.hasNote}
      start={state.start}
      pending={state.pending}
    />
  );
}

export default function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pb-10 pt-8">
      <Link href="/" className="flex h-11 items-center self-start" aria-label="D-Human home">
        <Wordmark className="h-3.5 w-auto" />
      </Link>
      <div className="flex flex-1 flex-col pt-8">
        <Suspense fallback={<p className="text-graphite">Loading your questions…</p>}>
          <Survey searchParams={searchParams} />
        </Suspense>
      </div>
      <p className="mt-12 text-sm text-graphite">D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.</p>
    </main>
  );
}
