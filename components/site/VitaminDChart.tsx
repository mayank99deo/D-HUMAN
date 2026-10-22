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
import { useEffect, useRef, useState } from "react";

const TOTAL = 100;
const DEFICIENT = 76;
const COLUMNS = 10;

// Squares fill from the bottom row up, like a level rising to 76%.
const fillRank = (index: number) =>
  (COLUMNS - 1 - Math.floor(index / COLUMNS)) * COLUMNS + (index % COLUMNS);
const isDeficient = (index: number) => fillRank(index) < DEFICIENT;

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

  function pickSomeone() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const final = Math.floor(Math.random() * TOTAL);
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

  const result =
    picked === null || scanning
      ? null
      : isDeficient(picked)
        ? "Deficient. This person's vitamin D was below the range."
        : "In range. This person was one of the 24.";

  return (
    <figure className="lg:col-span-5 lg:col-start-8">
      <div
        ref={gridRef}
        role="img"
        aria-label={`${DEFICIENT} of every ${TOTAL} people tested were vitamin D deficient`}
        className="grid w-full max-w-[19rem] grid-cols-10 gap-1.5"
      >
        {Array.from({ length: TOTAL }, (_, index) => (
          <Square key={index} rank={fillRank(index)} count={count} picked={picked === index} />
        ))}
      </div>

      <figcaption className="mt-6 max-w-[24rem]">
        <span className="block text-lead font-semibold">
          <motion.span>{shown}</motion.span> of every 100
        </span>
        <span className="mt-2 block text-graphite">
          people tested were vitamin D deficient. Source: Tata 1mg Labs, 2.2 lakh tests in 27 cities,
          2023.
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
        <p aria-live="polite" className="mt-4 min-h-[3.2em]">
          {result ? (
            <>
              <span className="font-semibold">{result}</span>{" "}
              <span className="text-graphite">
                Which square is you? There&apos;s no way to tell without a test.{" "}
                <a href="#join" className="text-paper underline underline-offset-4">
                  Find your number
                </a>
              </span>
            </>
          ) : (
            <span className="text-graphite">
              {scanning ? "Picking…" : "Every square is one person who was tested."}
            </span>
          )}
        </p>
      </div>
    </figure>
  );
}

function Square({ rank, count, picked }: { rank: number; count: MotionValue<number>; picked: boolean }) {
  const fill = useTransform(count, (v) => Math.min(1, Math.max(0, v - rank)));
  const scale = useTransform(fill, [0, 1], [0.3, 1]);
  return (
    <span className="relative aspect-square border border-paper/35">
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
