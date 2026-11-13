import Link from "next/link";

// Slide 3, on black: blood reports, the problem and the proof. The sourced
// vitamin D figure, and blood tests through D-Human marked as coming soon. The
// steps (upload, read, stack, retest) live on the phone slide that follows.
// Reads are AI-analysed; nobody else reviews them, so the page never says otherwise.

export function Reports() {
  return (
    <section
      id="reports"
      aria-labelledby="reports-title"
      className="flex min-h-[calc(100svh-5rem)] snap-start flex-col justify-center py-16 lg:py-12"
    >
      <div className="mx-auto grid w-full max-w-[1280px] gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:items-center lg:gap-8">
        <div className="lg:col-span-6">
          <p className="text-sm font-semibold text-graphite">Blood reports</p>
          <h2 id="reports-title" className="semiwide mt-3 max-w-[16ch] text-title font-bold">
            Know your numbers before you buy another bottle.
          </h2>
          <p className="mt-6 max-w-[40ch] text-graphite">
            Most people buy supplements without ever seeing their number. D-Human starts there.
          </p>
          <p className="mt-3">
            <Link href="/blood-report-analysis" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 active:opacity-60">
              How blood report analysis works
            </Link>
          </p>
        </div>

        <div className="lg:col-span-5 lg:col-start-8">
          <p>
            <span className="display-num block text-[clamp(4.5rem,3rem+6vw,8rem)]">76%</span>
            <span className="mt-3 block max-w-[30ch] text-graphite">
              deficient in vitamin D, across 2.2 lakh lab tests in 27 Indian cities (2023).
            </span>
          </p>

          {/* Mayank asked that people know testing through D-Human opens very soon. No date. */}
          <div className="mt-10 border border-paper p-5">
            <p className="text-sm font-semibold text-graphite">Coming soon</p>
            <p className="semiwide mt-1 text-xl font-bold">
              Blood tests through <span className="whitespace-nowrap">D-Human.</span>
            </p>
            <p className="mt-2 text-graphite">Book a test with us, and your results come straight in to be read.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
