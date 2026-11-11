"use client";

import Link from "next/link";
import { useEffect } from "react";

// Any page inside the app that fails to load says so, with a way to try again,
// instead of leaving a loading screen up.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[app] page failed to load", error);
  }, [error]);
  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-12 sm:px-6">
      <h1 className="verdict-type text-[clamp(2rem,6vw,3rem)]">This page didn&apos;t load.</h1>
      <p className="mt-4 max-w-prose text-graphite">Usually a weak connection or a hiccup on our side. Your data is safe.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className="button-primary h-12 px-8">
          Try again
        </button>
        <Link href="/fuel" className="button-ghost h-12">
          Log a meal
        </Link>
      </div>
    </main>
  );
}
