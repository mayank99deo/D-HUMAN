"use client";

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

const TOTAL = 100;
const DEFICIENT = 76;
const COLUMNS = 10;

// Squares fill from the bottom row up, like a level rising to 76%.
const fillRank = (index: number) =>
  (COLUMNS - 1 - Math.floor(index / COLUMNS)) * COLUMNS + (index % COLUMNS);
const isDeficient = (index: number) => fillRank(index) < DEFICIENT;

// Everyone behind a square gets a small panel of markers. Only the vitamin D share is sourced
// (it follows the chart); the other odds and values are illustrative.
type Marker = {
  name: string;
  unit: string;
  flag: "Low" | "Raised";
  odds: number;
  out: [number, number];
  normal: [number, number];
  decimals?: number;
  stack: string;
};

const MARKERS: Marker[] = [
  { name: "Vitamin D", unit: "ng/mL", flag: "Low", odds: 0, out: [6, 19], normal: [30, 62], stack: "Vitamin D3 with K2" },
  { name: "Vitamin B12", unit: "pg/mL", flag: "Low", odds: 0.35, out: [120, 195], normal: [260, 780], stack: "Vitamin B12 (methylcobalamin)" },
  { name: "Ferritin", unit: "ng/mL", flag: "Low", odds: 0.25, out: [5, 14], normal: [30, 160], stack: "Iron bisglycinate" },
  { name: "Magnesium", unit: "mg/dL", flag: "Low", odds: 0.2, out: [1.4, 1.6], normal: [1.8, 2.4], decimals: 1, stack: "Magnesium bisglycinate" },
  { name: "hsCRP", unit: "mg/L", flag: "Raised", odds: 0.25, out: [3.2, 7.5], normal: [0.3, 1.8], decimals: 1, stack: "Omega-3 (EPA and DHA)" },
];

type Reading = { marker: Marker; value: string; flagged: boolean };

// A seeded generator, so each square is always the same person, on the server and in the browser.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function profileFor(index: number): Reading[] {
  const rand = seeded((index + 1) * 7919);
  return MARKERS.map((marker, i) => {
    const flagged = i === 0 ? isDeficient(index) : rand() < marker.odds;
    const [lo, hi] = flagged ? marker.out : marker.normal;
    const value = (lo + rand() * (hi - lo)).toFixed(marker.decimals ?? 0);
    return { marker, value, flagged };
  });
}

export function VitaminDChart() {
  const gridRef = useRef<HTMLDivElement>(null);
  const inView = useInView(gridRef, { once: true, amount: 0.5 });
  const reduceMotion = useReducedMotion();

  // One value drives both the squares and the counter, so they stay in step.
  // It starts at 76 so the server-rendered chart is already correct.
  const count = useMotionValue(DEFICIENT);
  const shown = useTransform(count, (v) => Math.round(v));

  useEffect(() => {
    if (reduceMotion) return;
    if (!inView) {
      count.jump(0);
      return;
    }
    const controls = animate(count, DEFICIENT, { duration: 2.6, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [inView, reduceMotion, count]);

  const [picked, setPicked] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function stopScan() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setScanning(false);
  }

  function pickSomeone() {
    stopScan();
    let final = Math.floor(Math.random() * TOTAL);
    if (final === picked) final = (final + 1 + Math.floor(Math.random() * (TOTAL - 1))) % TOTAL;
    if (reduceMotion) {
      setPicked(final);
      return;
    }
    // Hop across random squares, slowing down, then land on the final one.
    setScanning(true);
    const hops = 12;
    let delay = 0;
    for (let h = 0; h < hops; h++) {
      delay += 55 + h * h * 1.8;
      const index = h === hops - 1 ? final : Math.floor(Math.random() * TOTAL);
      timers.current.push(
        window.setTimeout(() => {
          setPicked(index);
          if (h === hops - 1) setScanning(false);
        }, delay),
      );
    }
  }

  // Pointers can also pick a square directly; keyboards use the button, which does the same job.
  function pickSquare(event: MouseEvent<HTMLDivElement>) {
    const square = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
    if (!square) return;
    stopScan();
    setPicked(Number(square.dataset.index));
  }

  const profile = picked === null ? null : profileFor(picked);
  const stack = profile?.filter((r) => r.flagged).map((r) => r.marker.stack) ?? [];
  const settled = profile !== null && !scanning;

  return (
    <figure className="lg:col-span-5 lg:col-start-8">
      <div
        ref={gridRef}
        role="img"
        aria-label={`${DEFICIENT} of every ${TOTAL} people tested were vitamin D deficient`}
        onClick={pickSquare}
        className="grid w-full max-w-[19rem] grid-cols-10 gap-1.5"
      >
        {Array.from({ length: TOTAL }, (_, index) => (
          <Square key={index} index={index} rank={fillRank(index)} count={count} picked={picked === index} />
        ))}
      </div>

      <figcaption className="mt-6 max-w-[24rem]">
        <span className="block text-lead font-semibold">
          <motion.span>{shown}</motion.span> of every 100
        </span>
        <span className="mt-2 block text-graphite">
          people tested were vitamin D deficient, across 2.2 lakh lab tests in 27 Indian cities
          (2023).
        </span>
      </figcaption>

      <div className="mt-8 max-w-[24rem] border-t border-paper/15 pt-6">
        <button
          type="button"
          onClick={pickSomeone}
          disabled={scanning}
          className="h-11 border border-paper px-5 text-sm font-semibold transition-colors hover:bg-paper hover:text-ink disabled:cursor-progress disabled:opacity-60"
        >
          {picked === null ? "Pick someone at random" : "Pick someone else"}
        </button>

        {/* The panel keeps its height before and after a pick, so nothing below it jumps. */}
        <div aria-live="polite" className="mt-6">
          <p className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-semibold">
              {scanning ? "Picking…" : picked === null ? "Every square is one person" : `Person ${picked + 1}`}
            </span>
            <span className="text-graphite">Illustrative profile</span>
          </p>

          <ul className={`mt-3 transition-opacity ${scanning ? "opacity-40" : ""}`}>
            {MARKERS.map((marker, i) => {
              const reading = profile?.[i];
              return (
                <motion.li
                  key={`${picked}-${marker.name}`}
                  initial={settled && !reduceMotion ? { opacity: 0, x: -6 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.05 }}
                  className="grid grid-cols-[1fr_auto_5.5rem] items-baseline gap-3 border-b border-paper/15 py-2 text-sm"
                >
                  <span>{marker.name}</span>
                  <span className="text-graphite">
                    {reading ? `${reading.value} ${marker.unit}` : "–"}
                  </span>
                  <span className="justify-self-end">
                    {reading &&
                      (reading.flagged ? (
                        <span className="bg-paper px-1.5 font-semibold text-ink">{marker.flag}</span>
                      ) : (
                        <span className="text-graphite">In range</span>
                      ))}
                  </span>
                </motion.li>
              );
            })}
          </ul>

          <div className="mt-4 min-h-[8.5rem]">
            {settled ? (
              <>
                <p className="font-semibold">
                  {stack.length ? "Their stack" : "Their stack: nothing to add. Every marker is in range."}
                </p>
                {stack.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {stack.map((item) => (
                      <li key={item} className="border border-paper/50 px-2 py-0.5 text-sm font-semibold">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-graphite">
                  Which square is you? There&apos;s no way to tell without a test.{" "}
                  <a href="#join" className="text-paper underline underline-offset-4">
                    Find your number
                  </a>
                </p>
              </>
            ) : (
              <p className="text-graphite">
                Tap a square, or pick at random, to see what one person&apos;s markers showed and what
                their stack would hold.
              </p>
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}

function Square({
  index,
  rank,
  count,
  picked,
}: {
  index: number;
  rank: number;
  count: MotionValue<number>;
  picked: boolean;
}) {
  const fill = useTransform(count, (v) => Math.min(1, Math.max(0, v - rank)));
  const scale = useTransform(fill, [0, 1], [0.3, 1]);
  return (
    <span data-index={index} className="relative aspect-square cursor-pointer border border-paper/35">
      <motion.span className="absolute -inset-px bg-paper" style={{ opacity: fill, scale }} />
      {picked && (
        <motion.span
          layoutId="vitamin-d-picker"
          // The black halo cuts the ring out of neighbouring white squares so it stays visible.
          className="absolute -inset-[5px] z-10 border-2 border-paper shadow-[0_0_0_3px_#000]"
          transition={{ type: "spring", stiffness: 520, damping: 34 }}
        />
      )}
    </span>
  );
}
