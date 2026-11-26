import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StackClient } from "@/components/platform/Stack";
import { requireMember } from "@/lib/platform/member";
import { stackData, stackView } from "@/lib/platform/views/stack";
import { PageLoading } from "@/components/platform/PageLoading";

export const metadata: Metadata = { title: "Stack" };

// No report and nothing to go on in their food yet: the two ways to start. A usual day too
// light to count says so, and asks for the rest of the day.
function StartWithFood({ fullDays, usualDayShort }: { fullDays: number; usualDayShort: boolean }) {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Your stack starts with your food.</h1>
      <p className="mt-4 max-w-prose text-lg text-graphite">
        {usualDayShort ? "We build it from three logged days, or from a usual day that covers everything you eat." : "Log what you eat on three days, or describe a normal day once."}{" "}
        We&apos;ll suggest only what your food runs short of, measured against your body and training. A blood report adds what food can&apos;t show.
      </p>
      {usualDayShort && (
        <p className="mt-4 font-semibold">
          Your usual day looks lighter than a full day&apos;s food. Add everything you eat and drink across the day, snacks and chai included, or log meals on three days.
        </p>
      )}
      {fullDays > 0 && (
        <p className="mt-4 font-semibold">
          {fullDays} of 3 days logged. A day counts once most of what you ate is in.
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/fuel" className="button-primary h-13">
          Log a meal
        </Link>
        <Link href="/upload" className="button-ghost h-13">
          Upload a blood report
        </Link>
      </div>
      <Link href="/fuel?usual=1" className="link-quiet mt-6 inline-flex min-h-11 items-center">
        {usualDayShort ? "Add to my usual day" : "Short on time? Describe a normal day instead"}
      </Link>
    </main>
  );
}

async function Stack() {
  const { user, profile, persona } = await requireMember();
  // What Stack shows is worked out by stackView, which the apps' GET /api/stack sends too
  // (lib/platform/views/stack.ts), so the two can't drift.
  const v = stackView({ profile, persona }, await stackData({ user, profile }));
  if (v.state === "start_with_food") return <StartWithFood fullDays={v.fullDays} usualDayShort={v.usualDayShort} />;
  return (
    <StackClient
      aiOff={v.aiOff}
      stack={v.stack}
      staleReason={v.staleReason}
      basis={v.basis}
      hasReport={v.hasReport}
      body={v.body}
      markerNames={v.markerNames}
      budget={v.budget}
      flagged={v.flagged}
      hold={v.hold}
      ask={v.ask}
    />
  );
}

export default function StackPage() {
  return (
    <Suspense fallback={<PageLoading title="Your stack" />}>
      <Stack />
    </Suspense>
  );
}
