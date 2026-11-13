"use client";

import { useInView } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { isWaitlist } from "@/lib/site-mode";

// Chapter starts in the phone clip (video/loop). Change them together with the composition.
const CHAPTERS = [
  {
    title: "Test",
    // Open mode runs no tests of its own yet: people bring a report, and booking through D-Human is coming soon.
    body: isWaitlist ? "Blood, urine, gut and more. Most of it from home." : "Upload a recent blood report, as a PDF or photos. Tests through D-Human are coming soon.",
    start: 0,
    still: "test",
    alt: "The Tests screen: blood, urine, gut and body marked collected, and a notification that the AI-analysed report is in.",
  },
  {
    title: "Read",
    body: "An AI-analysed report in plain words.",
    start: 3.65,
    still: "read",
    alt: "Vitamin D in plain words: 14 ng/mL, below the 30 to 100 range. Candidate: vitamin D3, often with K2. Retest at 3 to 4 months.",
  },
  {
    title: "Stack",
    // Open mode's stacks name brands found on merit, with no clean-label audit behind them.
    body: isWaitlist ? "Supplements matched to your markers, from clean-label brands." : "Supplements only where a marker or a food gap points.",
    start: 9.8,
    still: "stack",
    alt: "Your stack: vitamin D3 with K2, magnesium bisglycinate and omega-3, each for a flagged marker, and four clean-label checks: third-party tested, every dose on the label, FSSAI licensed, traceable by batch.",
  },
  {
    title: "Retest",
    // Open mode: the read picks the markers and the weeks (lib/ai/report.ts), so no fixed months here.
    body: isWaitlist ? "Key markers again at 3–4 months, to show what moved." : "Key markers again when your read says, to show what moved.",
    start: 15.8,
    still: "retest",
    alt: "Your retest: vitamin D and evening cortisol back in range, hsCRP still raised. New results reset the stack.",
  },
];
// The clip is back on its first screen from here, so the last half second counts as the start.
const LOOP_END = 19.45;

function chapterAt(time: number) {
  if (time >= LOOP_END) return { index: 0, progress: 0 };
  const index = CHAPTERS.findLastIndex((c) => time >= c.start);
  const start = CHAPTERS[index].start;
  const end = CHAPTERS[index + 1]?.start ?? LOOP_END;
  return { index, progress: (time - start) / (end - start) };
}

// Reduced motion and Data Saver get the stills. Read through useSyncExternalStore so the
// server's answer (the video) is used while hydrating, then the browser's.
const REDUCE = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const query = matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const readStill = () =>
  matchMedia(REDUCE).matches ||
  Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);

// Without `intro`, the layout waitlist mode has always had. With it (open mode's phone
// slide), three columns on wide screens: the headline and the closing words, the phone,
// then the steps beside it. The phone also shrinks on short screens, so the slide fits
// about one screen.
const LAYOUT = {
  page: {
    grid: "mt-14 grid gap-10 lg:mt-16 lg:grid-cols-12 lg:gap-8",
    figure: "lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1",
    phone: "mx-auto w-[min(17.5rem,76vw)] rounded-[2.75rem] border-[3px] border-[#2e2e2e] bg-ink p-2.5 sm:w-[19.5rem] lg:mr-0",
    caption: "mx-auto mt-4 flex w-[min(17.5rem,76vw)] items-center justify-between gap-4 text-sm text-smoke sm:w-[19.5rem] lg:mr-0",
    steps: "lg:col-span-6 lg:row-start-1",
    list: "grid grid-cols-4 gap-3 lg:grid-cols-1 lg:gap-6",
    button: "lg:pt-5",
    number: "wide text-sm font-extrabold leading-none lg:text-4xl",
    title: "block text-sm font-bold sm:text-base lg:text-2xl",
    close: "lg:col-span-6 lg:row-start-2",
    lead: "semiwide text-lead font-bold",
    body: "mt-6 max-w-[42ch] text-smoke",
  },
  slide: {
    grid: "grid gap-8 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-8",
    figure: "lg:col-span-4 lg:col-start-5 lg:row-span-2 lg:row-start-1 lg:self-center",
    phone:
      "mx-auto w-[min(17.5rem,76vw)] rounded-[2.75rem] border-[3px] border-[#2e2e2e] bg-ink p-2.5 sm:w-[19.5rem] lg:w-full lg:max-w-[min(19.5rem,calc((100svh-13rem)/2.16))]",
    caption:
      "mx-auto mt-4 flex w-[min(17.5rem,76vw)] items-center justify-between gap-4 text-sm text-smoke sm:w-[19.5rem] lg:w-full lg:max-w-[min(19.5rem,calc((100svh-13rem)/2.16))]",
    steps: "lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1 lg:self-center",
    list: "grid grid-cols-4 gap-3 lg:grid-cols-1 lg:gap-4",
    button: "lg:pt-3",
    number: "wide text-sm font-extrabold leading-none lg:text-2xl",
    title: "block text-sm font-bold sm:text-base lg:text-xl",
    close: "lg:col-span-4 lg:row-start-2",
    lead: "semiwide text-xl font-bold",
    body: "mt-3 max-w-[46ch] text-smoke",
  },
};

export function LoopPhone({ intro }: { intro?: ReactNode }) {
  const k = intro === undefined ? LAYOUT.page : LAYOUT.slide;
  const still = useSyncExternalStore(subscribeMotion, readStill, () => false);

  const phoneRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const inView = useInView(phoneRef, { amount: 0.35 });
  // On the slide, the poster waits until the phone is within a screen of view, so it doesn't
  // compete with the hero for bandwidth on first load. Waitlist mode keeps it from the start.
  const near = useInView(phoneRef, { once: true, margin: "0px 0px 100% 0px" });
  const poster = intro === undefined || near ? "/media/loop/poster.webp" : undefined;

  const [active, setActive] = useState(0);
  const [userPaused, setUserPaused] = useState(false);

  // Steps before the current one are full, later ones empty, the current one shows its progress.
  function paint(index: number, progress: number) {
    fills.current.forEach((fill, i) => {
      if (fill) fill.style.transform = `scaleX(${i < index ? 1 : i > index ? 0 : progress})`;
    });
  }

  // Plays only while on screen and not paused by the reader.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || still) return;
    if (inView && !userPaused) {
      video.muted = true;
      video.play().catch(() => setUserPaused(true));
    } else {
      video.pause();
    }
  }, [inView, userPaused, still]);

  // Follow the clip: which chapter is showing, and how far through it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || still) return;
    let frame = 0;
    const sync = () => {
      const { index, progress } = chapterAt(video.currentTime);
      setActive(index);
      paint(index, progress);
    };
    const tick = () => {
      sync();
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const stop = () => cancelAnimationFrame(frame);
    video.addEventListener("playing", start);
    video.addEventListener("pause", stop);
    video.addEventListener("seeked", sync);
    return () => {
      stop();
      video.removeEventListener("playing", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("seeked", sync);
    };
  }, [still]);

  useEffect(() => {
    if (still) paint(active, 1);
  }, [still, active]);

  function show(index: number) {
    setActive(index);
    const video = videoRef.current;
    if (still || !video) return;
    video.currentTime = CHAPTERS[index].start;
    paint(index, 0);
    setUserPaused(false);
  }

  const chapter = CHAPTERS[active];

  return (
    <div className={k.grid}>
      {/* First in the DOM so phones read the headline before the phone. */}
      {/* A size container, so the headline can fit its column on wide screens. */}
      {intro !== undefined && <div className="@container lg:col-span-4 lg:row-start-1">{intro}</div>}
      <figure className={k.figure}>
        <div
          ref={phoneRef}
          className={k.phone}
        >
          <div className="relative aspect-[600/1296] overflow-hidden rounded-[2.2rem] bg-paper">
            {still ? (
              <Image
                key={chapter.still}
                src={`/media/loop/${chapter.still}.webp`}
                alt={chapter.alt}
                width={600}
                height={1296}
                unoptimized
                className="absolute inset-0 h-full w-full"
              />
            ) : (
              <video
                ref={videoRef}
                muted
                playsInline
                loop
                preload="none"
                poster={poster}
                disablePictureInPicture
                aria-hidden="true"
                tabIndex={-1}
                className="absolute inset-0 h-full w-full"
              >
                <source src="/media/loop/how-it-works.mp4" type="video/mp4" />
              </video>
            )}
          </div>
        </div>
        <figcaption className={k.caption}>
          <span>Sample flow. Values are illustrative.</span>
          {!still && (
            <button
              type="button"
              onClick={() => setUserPaused((paused) => !paused)}
              className="-mr-2 min-h-11 px-2 font-semibold text-ink underline underline-offset-4 active:opacity-60"
            >
              {userPaused ? "Play" : "Pause"}
            </button>
          )}
        </figcaption>
        {!still && (
          <p className="sr-only">
            A phone plays D-Human&apos;s app: tests collected at home, an AI-analysed report with three
            markers flagged, vitamin D explained in plain words, a stack of three supplements matched to
            those markers from clean-label brands, and a retest where two markers are back in range.
          </p>
        )}
      </figure>

      <div className={k.steps}>
        <ol className={k.list}>
          {CHAPTERS.map((step, i) => (
            <li key={step.title}>
              <button
                type="button"
                onClick={() => show(i)}
                aria-current={active === i ? "step" : undefined}
                className={`group relative block min-h-11 w-full pt-4 text-left transition-colors active:opacity-60 ${k.button} ${
                  active === i ? "text-ink" : "text-ink/60 hover:text-ink"
                }`}
              >
                <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-rule">
                  <span
                    ref={(el) => {
                      fills.current[i] = el;
                    }}
                    className="absolute inset-0 origin-left scale-x-0 bg-ink"
                  />
                </span>
                <span className="flex flex-col gap-1 lg:flex-row lg:items-baseline lg:gap-5">
                  <span aria-hidden="true" className={k.number}>
                    {i + 1}
                  </span>
                  <span>
                    <span className={k.title}>{step.title}</span>
                    <span
                      className={`mt-1 hidden max-w-[34ch] lg:block ${active === i ? "text-smoke" : ""}`}
                    >
                      {step.body}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        {/* On small screens the steps are tabs under the phone; the current one's text shows here. */}
        <p className="mt-4 min-h-[3.1em] text-smoke lg:hidden">{chapter.body}</p>
      </div>

      <div className={k.close}>
        <p className={k.lead}>
          We recommend a supplement only when a marker points to it. No test result, no pitch.
        </p>
        <p className={k.body}>
          {isWaitlist
            ? "Food and sleep come first. Brands in the stack have to clear a clean-label bar: third-party tested, every ingredient and dose on the label, FSSAI licensed and traceable by batch."
            : "Food and sleep come first. Brands in a stack are found on merit: D-Human has no brand partners and earns nothing from them."}
        </p>
        {/* Open mode's slide links to the guide; waitlist mode's section is unchanged. */}
        {intro !== undefined && (
          <p className="mt-2">
            <Link href="/supplements-from-blood-test" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 active:opacity-60">
              Supplements from your blood test
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
