// Open mode: people bring their own report today. Booking a test through D-Human
// is the next thing to open, so the page says so plainly, without a date.
export function TestsSoon() {
  return (
    <section id="tests" aria-labelledby="tests-title" className="border-t border-paper/15 py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-5 sm:px-8 lg:grid-cols-12 lg:items-end lg:gap-x-8">
        <div className="lg:col-span-7">
          <p className="text-sm font-semibold text-graphite">Coming soon</p>
          <h2 id="tests-title" className="semiwide mt-4 text-title font-bold">
            Blood tests through <span className="whitespace-nowrap">D-Human.</span>
          </h2>
        </div>
        <p className="max-w-[44ch] text-graphite lg:col-span-5">
          Book your blood test with us, and the results come straight into your account to be read. It opens very soon.
          Until then, upload a report you already have, and start with your meals today.
        </p>
      </div>
    </section>
  );
}
