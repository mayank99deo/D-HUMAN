// Slide 3: blood reports, in one screen. Open mode's short version of Problem
// (the sourced vitamin D figure) and Loop (the four steps), with blood tests
// through D-Human marked as coming soon. Reads are AI-analysed; nobody else
// reviews them, so the page never says otherwise.

const STEPS = [
  { title: "Upload", body: "A recent blood report, as a PDF or photos." },
  { title: "Read", body: "AI reads it for the way you train, and says when a marker needs a doctor." },
  { title: "Stack", body: "Food first. Supplements only where a marker or a food gap points." },
  { title: "Retest", body: "A date to test again, to see what moved." },
];

export function Reports() {
  return (
    <section
      id="reports"
      aria-labelledby="reports-title"
      className="flex min-h-[calc(100svh-5rem)] snap-start flex-col justify-center border-t border-paper/15 py-16 lg:py-12"
    >
      <div className="mx-auto grid w-full max-w-[1280px] gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-5">
          <p className="text-sm font-semibold text-graphite">Blood reports</p>
          <h2 id="reports-title" className="semiwide mt-3 max-w-[14ch] text-title font-bold">
            Test first. Supplement second.
          </h2>
          <p className="mt-8 flex items-baseline gap-4 lg:mt-10">
            <span className="display-num text-[clamp(3.5rem,2.5rem+4vw,6rem)]">76%</span>
            <span className="max-w-[24ch] text-sm text-graphite">
              deficient in vitamin D, across 2.2 lakh lab tests in 27 Indian cities (2023).
            </span>
          </p>
          <p className="mt-4 max-w-[40ch] text-graphite">Most people buy supplements without ever seeing their number.</p>
        </div>

        <div className="lg:col-span-6 lg:col-start-7">
          <ol className="border-t border-line">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-x-3 border-b border-line py-3.5">
                <span aria-hidden="true" className="wide text-lg font-extrabold leading-tight">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-semibold">{s.title}</span>
                  <span className="block text-graphite">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>

          {/* Mayank asked that people know testing through D-Human opens very soon. No date. */}
          <div className="mt-8 border border-paper p-5">
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
