const STEPS = [
  { title: "Test", body: "Blood, urine, gut and more. Most of it from home." },
  { title: "Read", body: "A doctor-reviewed report in plain words." },
  { title: "Stack", body: "Supplements matched to your markers, from clean-label brands." },
  { title: "Retest", body: "Key markers again at 3–4 months, to show what moved." },
];

export function Loop() {
  return (
    <section aria-labelledby="loop-title" className="paper py-24 sm:py-32">
      <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
        <h2 id="loop-title" className="semiwide max-w-[18ch] text-title font-bold">
          Test first. Supplement second.
        </h2>
        <p className="mt-6 max-w-[46ch] text-smoke">
          Four steps, and then the loop starts again with your new numbers.
        </p>

        <div className="relative mt-16 lg:pb-20">
          <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
            {STEPS.map((step, i) => (
              <li key={step.title} className="border-t-2 border-ink pt-5 lg:pr-8">
                <span className="wide block text-5xl font-extrabold leading-none" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-2xl font-bold">{step.title}</h3>
                <p className="mt-2 max-w-[26ch] text-smoke">{step.body}</p>
              </li>
            ))}
          </ol>
          {/* The return path: retest results feed the next stack. */}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 hidden h-12 lg:block">
            <div className="absolute right-0 bottom-0 left-0 h-full border-x-2 border-b-2 border-ink" />
            <span className="absolute -top-px -left-[7px] border-x-[8px] border-b-[10px] border-x-transparent border-b-ink" />
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 bg-paper px-4 text-sm font-semibold">
              New results reset the stack
            </span>
          </div>
        </div>

        <div className="mt-24 grid gap-14 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <p className="semiwide text-lead font-bold">
              We recommend a supplement only when a marker points to it. No test result, no pitch.
            </p>
            <p className="mt-6 max-w-[42ch] text-smoke">
              Food and sleep come first. Brands in the stack have to clear a clean-label bar: third-party
              tested, every ingredient and dose on the label, FSSAI licensed and traceable by batch.
            </p>
          </div>
          <SampleReport />
        </div>
      </div>
    </section>
  );
}

const READING = 14;
const SCALE_MAX = 100;
const RANGE = [30, 100] as const;

function SampleReport() {
  const pct = (value: number) => `${(value / SCALE_MAX) * 100}%`;
  return (
    <figure className="border-2 border-ink p-5 sm:p-8 lg:col-span-6 lg:col-start-7">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-4 text-sm">
        <span className="font-semibold">Sample report</span>
        <span className="text-smoke">Values are illustrative</span>
      </figcaption>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-xl font-bold">Vitamin D, 25-OH</p>
        <p className="text-xl">
          <span className="font-bold">{READING}</span> ng/mL
        </p>
      </div>

      <div className="mt-8" role="img" aria-label={`Reading ${READING} ng/mL, below the reference range of ${RANGE[0]} to ${RANGE[1]} ng/mL`}>
        <div className="relative h-3">
          <div className="absolute inset-x-0 top-1/2 h-px bg-ink/40" />
          <div className="absolute top-0 h-full bg-ink" style={{ left: pct(RANGE[0]), right: 0 }} />
          <div className="absolute -top-2.5 h-8 w-1 -translate-x-1/2 bg-ink" style={{ left: pct(READING) }} />
        </div>
        <div className="relative mt-3 h-5 text-sm text-smoke" aria-hidden="true">
          <span className="absolute left-0">0</span>
          <span className="absolute -translate-x-1/2 font-semibold text-ink" style={{ left: pct(READING) }}>
            {READING}
          </span>
          <span className="absolute -translate-x-1/2" style={{ left: pct(RANGE[0]) }}>
            {RANGE[0]}
          </span>
          <span className="absolute right-0">{RANGE[1]}</span>
        </div>
      </div>

      <dl className="mt-8 grid gap-x-6 gap-y-4 border-t border-rule pt-6 sm:grid-cols-[8rem_1fr]">
        <dt className="font-semibold">Finding</dt>
        <dd className="text-smoke">Below the reference range.</dd>
        <dt className="font-semibold">Candidate</dt>
        <dd className="text-smoke">Vitamin D3, often with K2.</dd>
        <dt className="font-semibold">Guardrail</dt>
        <dd className="text-smoke">Retest at 3–4 months to confirm. Don&apos;t keep taking it blind.</dd>
      </dl>
      <p className="mt-6 border-t border-rule pt-4 text-sm text-smoke">
        Every out-of-range marker is reviewed by a doctor before a stack is suggested.
      </p>
    </figure>
  );
}
