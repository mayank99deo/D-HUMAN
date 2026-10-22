const PLANS = [
  {
    name: "Baseline",
    promise: "Know your numbers",
    includes: [
      "100+ marker blood and urine panel, at home",
      "Doctor-reviewed report",
      "30-minute consult",
      "Supplement stack advice",
    ],
    offset: "lg:mt-32",
  },
  {
    name: "Core",
    promise: "Know your body",
    note: "The full loop: test, stack, retest.",
    includes: [
      "Everything in Baseline",
      "Gut microbiome and cortisol",
      "DEXA body composition and ECG",
      "60-minute consult",
      "Retest of key markers at 3–4 months",
      "Quarterly check-ins",
    ],
    offset: "lg:mt-16",
  },
  {
    name: "Complete",
    promise: "Know your risks",
    includes: [
      "Everything in Core",
      "Genetic risk panel",
      "CT calcium score and low-dose lung CT",
      "Full body MRI",
      "Breast screening, where a doctor advises it",
      "Monthly check-ins for 12 months",
    ],
    offset: "",
  },
];

export function Plans() {
  return (
    <section aria-labelledby="plans-title" className="py-24 sm:py-32">
      <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <h2 id="plans-title" className="semiwide max-w-[14ch] text-title font-bold lg:col-span-6">
            Three plans, one ladder.
          </h2>
          <p className="max-w-[46ch] text-graphite lg:col-span-5 lg:col-start-8 lg:pt-3">
            Start with your numbers, or go all the way to a full risk screen. Pricing goes to the
            waitlist first.
          </p>
        </div>

        {/* Columns step up like a ladder: each plan builds on the one before it. */}
        <ol className="mt-16 grid gap-4 lg:grid-cols-3 lg:items-start">
          {PLANS.map((plan) => {
            const featured = Boolean(plan.note);
            return (
              <li
                key={plan.name}
                className={`${plan.offset} p-6 sm:p-8 ${featured ? "paper" : "border border-paper/25"}`}
              >
                <h3 className="wide text-3xl font-extrabold">{plan.name}</h3>
                <p className="mt-2 text-lead">{plan.promise}</p>
                {plan.note && <p className="mt-4 text-sm font-semibold">{plan.note}</p>}
                <ul className={`mt-8 grid gap-3 border-t pt-6 ${featured ? "border-rule" : "border-paper/15"}`}>
                  {plan.includes.map((item) => (
                    <li key={item} className="flex gap-3 leading-snug">
                      <span aria-hidden="true" className={`mt-[0.55em] h-1.5 w-1.5 shrink-0 ${featured ? "bg-ink" : "bg-paper"}`} />
                      {item}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
        <p className="mt-8 max-w-[64ch] text-sm text-graphite">
          VO2 max, lung function and insulin tests can be added to any plan. Supplements are billed
          separately.
        </p>
      </div>
    </section>
  );
}
