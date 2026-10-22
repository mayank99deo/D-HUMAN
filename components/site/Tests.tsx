const GROUPS = [
  {
    name: "Blood and urine",
    tests: [
      ["100+ biomarker panel", "At home"],
      ["Insulin and diabetes risk", "At home"],
      ["Retest of key markers", "At home"],
    ],
  },
  {
    name: "Gut and stress",
    tests: [
      ["Gut microbiome", "Home kit by post"],
      ["Cortisol, from saliva", "At home"],
    ],
  },
  {
    name: "Body and fitness",
    tests: [
      ["DEXA: fat, muscle and bone", "Partner centre"],
      ["ECG and vitals", "Centre or home visit"],
      ["VO2 max and lung function", "Partner lab"],
    ],
  },
  {
    name: "Heart, lung and cancer screening",
    tests: [
      ["CT calcium score", "Imaging centre"],
      ["Low-dose lung CT", "Imaging centre"],
      ["Full body MRI", "Partner hospital"],
      ["Breast screening", "Imaging centre"],
    ],
  },
  {
    name: "Genetics and experts",
    tests: [
      ["Genetic risk panel", "Home kit by post"],
      ["60-minute consult", "Video or in person"],
      ["Personal plan and stack", "In the app"],
      ["Health manager check-ins", "App and WhatsApp"],
      ["Dashboard for every result", "In the app"],
    ],
  },
] as const;

export function Tests() {
  return (
    <section aria-labelledby="tests-title" className="paper border-t border-rule py-24 sm:py-32">
      <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <h2 id="tests-title" className="semiwide text-title font-bold lg:col-span-5">
            What we test
          </h2>
          <p className="max-w-[52ch] text-smoke lg:col-span-6 lg:col-start-7 lg:pt-3">
            Seventeen tests in five groups. Blood, urine, gut and saliva samples are collected at home.
            Imaging and clinical tests run through licensed partner centres and a reviewing doctor.
          </p>
        </div>

        <div className="mt-16 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-5">
          {GROUPS.map((group) => (
            <section key={group.name} aria-label={group.name} className="border-t-2 border-ink pt-5">
              <h3 className="min-h-[3em] text-lg leading-snug font-bold">{group.name}</h3>
              <ul className="mt-4 grid gap-4">
                {group.tests.map(([test, where]) => (
                  <li key={test}>
                    <span className="block leading-snug">{test}</span>
                    <span className="mt-0.5 block text-sm text-smoke">{where}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
