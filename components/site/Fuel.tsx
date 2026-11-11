import { Fragment, type CSSProperties } from "react";
import { MICROS } from "@/lib/domain/nutrition";
import { PlayOnView } from "./PlayOnView";

// Fuel, the calorie and protein tracker, told the way the app shows it: the
// three ways in (the same Snap, Say and Type tiles as components/platform/
// FuelLogger.tsx), what you said, the estimate card, and the day so far.
// Every number in the example is illustrative and labelled so.

// What the person said, revealed word by word as speech recognition fills it in.
const SAID = "2 rotis, dal, bhindi sabzi and a katori of curd".split(" ");

const MEAL = {
  title: "Dal, roti, bhindi and curd",
  kcal: 590,
  protein: 23,
  items: ["Roti, 2 medium", "dal, 1 katori", "bhindi sabzi, 1 katori", "curd, 1 katori"],
  // The tip follows what the person's blood report flagged. Same note as the languages section.
  tip: "Ferritin was low on your report. Squeeze lemon on the dal: vitamin C helps your body absorb its iron.",
};

// The day after this meal, against an illustrative person's targets.
const DAY = { kcal: 1240, kcalTarget: 2150, protein: 49, proteinTarget: 84, carbs: 168, fat: 38 };

// The ring from Fuel's "today" panel: the day's energy target, split by where the energy came from.
const R = 70;
const C = 2 * Math.PI * R;
const RING = (() => {
  const parts = [
    { kcal: DAY.protein * 4, opacity: 1 },
    { kcal: DAY.carbs * 4, opacity: 0.7 },
    { kcal: DAY.fat * 9, opacity: 0.45 },
  ];
  const sum = parts.reduce((t, p) => t + p.kcal, 0);
  const filled = Math.min(1, DAY.kcal / DAY.kcalTarget) * C;
  let offset = 0;
  return parts.map((p) => {
    const len = (p.kcal / sum) * filled;
    const arc = { dash: `${Math.max(0, len - 2).toFixed(2)} ${C.toFixed(2)}`, offset: (-offset).toFixed(2), opacity: p.opacity };
    offset += len;
    return arc;
  });
})();

// Hidden while armed; on play, each piece arrives after its own delay (--d).
const REVEAL =
  "motion-safe:group-data-[play=armed]/play:opacity-0 motion-safe:group-data-[play=armed]/play:translate-y-1.5 group-data-[play=on]/play:transition group-data-[play=on]/play:duration-500 group-data-[play=on]/play:ease-out group-data-[play=on]/play:[transition-delay:var(--d)]";
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const WAYS = [
  { title: "Snap", body: "A photo of your plate" },
  { title: "Say", body: "Tell us what you ate", on: true },
  { title: "Type", body: "A few words is enough" },
];

const GETS = [
  {
    title: "Today's plate",
    body: "Your day against targets set from your height, weight, age, training and goal. Vitamin and mineral needs follow India's ICMR-NIN 2020 allowances.",
  },
  { title: "Your biggest gaps", body: "What runs short across your last two weeks of meals." },
  {
    title: "How you usually eat",
    body: "Not one for logging every meal? Describe a normal day once, and we work from that until you've logged a few days.",
  },
  { title: "Tips that know your report", body: "Add a blood report, and each meal's tip follows the markers it flagged." },
];

const num = (n: number) => n.toLocaleString("en-IN");

export function Fuel() {
  return (
    <section id="fuel" aria-labelledby="fuel-title" className="border-t border-paper/15 py-24 sm:py-32">
      {/* Phones read intro, example, then the details; wide screens put the example beside both. */}
      <div className="mx-auto grid max-w-[1280px] gap-14 px-5 sm:px-8 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-0">
        <div className="lg:col-span-5 lg:row-start-1">
          <p className="text-sm font-semibold text-graphite">Calorie tracking</p>
          <h2 id="fuel-title" className="semiwide mt-4 text-title font-bold">
            <span className="block">Snap it.</span> <span className="block">Say it.</span>{" "}
            <span className="block">Type it.</span>
          </h2>
          <p className="mt-8 max-w-[44ch]">
            Log a meal whichever way suits you. AI estimates it in Indian household portions: calories,
            protein, carbs, fat and fibre, plus {MICROS.length} vitamins and minerals.
          </p>
        </div>

        <figure className="lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:row-start-1">
          <PlayOnView className="border border-line-strong bg-lift p-4 sm:p-6">
            <p className="semiwide text-xl font-bold">Log a meal</p>

            {/* The three ways in, as the app draws them. A picture of the screen, not controls. */}
            <ul className="mt-4 grid grid-cols-3 gap-2" aria-label="Three ways to log a meal">
              {WAYS.map((w) => (
                <li
                  key={w.title}
                  className={`flex min-h-24 flex-col items-start justify-between gap-2 border p-3 sm:p-4 ${
                    w.on ? "border-paper" : "border-line-strong"
                  }`}
                >
                  <span className="semiwide text-lg font-bold">{w.title}</span>
                  <span className="text-xs leading-snug text-graphite">{w.body}</span>
                </li>
              ))}
            </ul>

            {/* While the words come in, the label reads as it does in the app while listening. */}
            <div className="mt-5 grid text-sm text-graphite">
              <span
                aria-hidden="true"
                className="col-start-1 row-start-1 opacity-0 group-data-[play=armed]/play:opacity-100 group-data-[play=on]/play:transition-opacity group-data-[play=on]/play:delay-[1000ms] group-data-[play=on]/play:duration-300"
              >
                Listening… speak naturally
              </span>
              <span className="col-start-1 row-start-1 motion-safe:group-data-[play=armed]/play:opacity-0 group-data-[play=on]/play:transition-opacity group-data-[play=on]/play:delay-[1000ms] group-data-[play=on]/play:duration-300">
                What you said
              </span>
            </div>
            <p className="mt-2 border border-paper/40 px-4 py-3.5">
              {SAID.map((word, i) => (
                <Fragment key={i}>
                  <span className={`inline-block ${REVEAL}`} style={delay(200 + i * 80)}>
                    {word}
                  </span>{" "}
                </Fragment>
              ))}
            </p>

            {/* The estimate, laid out like the "Logged" card in Fuel. */}
            <div className={`mt-4 border border-paper p-5 ${REVEAL}`} style={delay(1200)}>
              <p className="text-sm text-graphite">Logged</p>
              <p className="mt-1 text-xl font-bold">{MEAL.title}</p>
              {/* Each number keeps its unit on narrow phones. */}
              <p className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="whitespace-nowrap">
                  <span className="display-num text-3xl">{MEAL.kcal}</span> <span className="text-graphite">kcal</span>
                </span>
                <span className="whitespace-nowrap">
                  <span className="display-num text-3xl">{MEAL.protein}</span> <span className="text-graphite">g protein</span>
                </span>
              </p>
              <p className="mt-2 text-sm text-graphite">{MEAL.items.join("; ")}</p>
              <p className="mt-3">{MEAL.tip}</p>
            </div>

            {/* The day so far, as the ring at the top of Fuel shows it. */}
            <div className={`mt-5 flex items-center gap-5 ${REVEAL}`} style={delay(1500)}>
              <div className="relative shrink-0">
                <svg viewBox="0 0 180 180" className="h-24 w-24 -rotate-90 sm:h-28 sm:w-28" aria-hidden="true">
                  <circle cx="90" cy="90" r={R} fill="none" stroke="var(--color-line)" strokeWidth="14" />
                  {RING.map((a, i) => (
                    <circle
                      key={i}
                      cx="90"
                      cy="90"
                      r={R}
                      fill="none"
                      stroke="var(--color-paper)"
                      strokeOpacity={a.opacity}
                      strokeWidth="14"
                      strokeDasharray={a.dash}
                      strokeDashoffset={a.offset}
                    />
                  ))}
                  <line x1={90 + R - 10} y1="90" x2={90 + R + 10} y2="90" stroke="var(--color-paper)" strokeWidth="2" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-graphite">Today</p>
                <p className="mt-1">
                  <span className="display-num text-2xl">{num(DAY.kcal)}</span>{" "}
                  <span className="text-sm text-graphite">of {num(DAY.kcalTarget)} kcal</span>
                </p>
                <div className="mt-3 flex justify-between gap-3 text-sm">
                  <span>Protein</span>
                  <span>
                    <span className="font-bold">{DAY.protein}</span>{" "}
                    <span className="text-graphite">/ {DAY.proteinTarget} g</span>
                  </span>
                </div>
                <div className="relative mt-1.5 h-1 bg-line" aria-hidden="true">
                  <div
                    className="absolute inset-y-0 left-0 bg-paper"
                    style={{ width: `${((DAY.protein / DAY.proteinTarget) * 100).toFixed(1)}%` }}
                  />
                </div>
              </div>
            </div>
          </PlayOnView>
          <figcaption className="mt-4 text-sm text-graphite">
            Illustrative example. Meal numbers are estimates from your photo or words, not lab measurements.
          </figcaption>
        </figure>

        <dl className="max-w-[44ch] border-t border-line lg:col-span-5 lg:row-start-2 lg:mt-10">
          {GETS.map((g) => (
            <div key={g.title} className="border-b border-line py-5">
              <dt className="font-semibold">{g.title}</dt>
              <dd className="mt-1 text-graphite">{g.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
