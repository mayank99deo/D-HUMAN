"use client";

import { useEffect, useMemo, useState } from "react";
import type { Fact } from "@/lib/domain/facts";

// The analysis screen. Two rings of type orbit the centre: the outer one carries
// the marker names as Claude finds them on your report, the inner one the steps
// of the read. The centre holds one fact at a time, still and large, so the
// moving parts never cost readability.

export type Stage = "uploading" | "reading" | "matching" | "weighing" | "writing" | "done" | "error";

const ORDER: Stage[] = ["uploading", "reading", "matching", "weighing", "writing", "done"];

function seeded(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function Orbit({
  facts,
  found,
  stage,
  noun,
  target,
  error,
  children,
}: {
  facts: Fact[];
  found: string[];
  stage: Stage;
  noun: string;
  target: string | null;
  error?: string | null;
  children?: React.ReactNode; // actions shown when done or failed
}) {
  const [f, setF] = useState(0);
  const running = stage !== "done" && stage !== "error";

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setF((x) => (x + 1) % facts.length), 8500);
    return () => clearInterval(id);
  }, [running, facts.length]);

  const steps = [
    { s: "reading" as Stage, text: "Reading your pages" },
    { s: "matching" as Stage, text: "Matching every range" },
    { s: "weighing" as Stage, text: target ? `Weighing it for ${target}` : `Weighing it for a ${noun}` },
    { s: "writing" as Stage, text: "Writing your read" },
  ];
  const at = ORDER.indexOf(stage === "error" ? "reading" : stage);
  const progress = stage === "done" ? 1 : Math.max(0.04, (at - 0.5) / (ORDER.length - 1)) + Math.min(found.length, 30) / 300;

  // The outer ring repeats what's been found until it fills the circle.
  const outer = useMemo(() => {
    const names = found.length ? found : ["Opening your report"];
    let s = "";
    // Em spaces: SVG would collapse ordinary ones.
    const gap = "\u2003\u2003";
    while (s.length < 120) s += names.join(gap) + gap;
    return s;
  }, [found]);

  // A contour that gains a ripple with every marker found.
  const ripple = useMemo(() => {
    const c = 300;
    let d = "";
    for (let k = 0; k <= 180; k++) {
      const t = (k / 180) * Math.PI * 2;
      let r = 150;
      found.forEach((_, i) => {
        const a = seeded(i) * Math.PI * 2;
        let dt = Math.abs(t - a) % (Math.PI * 2);
        if (dt > Math.PI) dt = Math.PI * 2 - dt;
        r += (seeded(i + 99) > 0.5 ? 1 : -1) * 9 * Math.exp(-(dt * dt) / 0.03);
      });
      r += 1.5 * Math.sin(4 * t);
      d += `${k ? "L" : "M"}${(c + r * Math.cos(t)).toFixed(1)} ${(c + r * Math.sin(t)).toFixed(1)}`;
    }
    return `${d}Z`;
  }, [found]);

  const fact = facts[f];
  const ticks = 96;

  return (
    <div className="relative mx-auto aspect-square w-[min(94vw,78dvh,44rem)]">
      <svg viewBox="0 0 600 600" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <path id="orbit-outer" d="M300 300m-268 0a268 268 0 1 1 536 0a268 268 0 1 1 -536 0" />
          <path id="orbit-inner" d="M300 300m-224 0a224 224 0 1 1 448 0a224 224 0 1 1 -448 0" />
        </defs>

        <g className={running ? "orbit-spin" : ""} style={{ ["--orbit-speed" as string]: "110s" }}>
          <text className="fill-paper text-[17px] font-semibold" style={{ fontVariationSettings: '"wdth" 112' }} opacity={found.length ? 0.9 : 0.45}>
            <textPath href="#orbit-outer">{outer}</textPath>
          </text>
        </g>

        <g className={running ? "orbit-spin-back" : ""} style={{ ["--orbit-speed" as string]: "150s" }}>
          <text className="text-[14px]">
            <textPath href="#orbit-inner">
              {steps.map((x) => {
                const idx = ORDER.indexOf(x.s);
                const state = stage === "done" || idx < at ? "done" : idx === at ? "now" : "next";
                return (
                  <tspan key={x.s} className={state === "now" ? "fill-paper font-bold" : "fill-graphite"} opacity={state === "next" ? 0.5 : 1}>
                    {state === "done" ? "✓ " : ""}
                    {x.text}
                    {"\u2003\u2003\u2003"}
                  </tspan>
                );
              })}
            </textPath>
          </text>
        </g>

        {/* Progress ticks */}
        {Array.from({ length: ticks }, (_, i) => {
          const a = -Math.PI / 2 + (i / ticks) * Math.PI * 2;
          const on = i / ticks < progress;
          return (
            <line
              key={i}
              x1={(300 + 194 * Math.cos(a)).toFixed(2)}
              y1={(300 + 194 * Math.sin(a)).toFixed(2)}
              x2={(300 + (i % 8 === 0 ? 182 : 187) * Math.cos(a)).toFixed(2)}
              y2={(300 + (i % 8 === 0 ? 182 : 187) * Math.sin(a)).toFixed(2)}
              stroke={on ? "var(--color-paper)" : "var(--color-line-strong)"}
              strokeWidth={on ? 2 : 1}
            />
          );
        })}

        <g className={running ? "orbit-spin" : ""} style={{ ["--orbit-speed" as string]: "60s" }}>
          <path d={ripple} fill="none" stroke="var(--color-paper)" strokeOpacity={0.35} strokeWidth={1.2} />
        </g>
      </svg>

      {/* The readable centre */}
      <div className="absolute inset-[24%] flex flex-col items-center justify-center text-center" aria-live="polite">
        {stage === "done" ? (
          <div className="fact-in">
            <p className="verdict-type text-[clamp(1.75rem,5vw,2.5rem)]">Your read is ready.</p>
            <div className="mt-5">{children}</div>
          </div>
        ) : stage === "error" ? (
          <div className="fact-in">
            <p className="error-mark text-lg font-semibold">{error ?? "Something went wrong."}</p>
            <div className="mt-5">{children}</div>
          </div>
        ) : (
          <button type="button" onClick={() => setF((x) => (x + 1) % facts.length)} className="group" aria-label="Show another fact">
            <span key={f} className="fact-in block">
              <span className="block text-sm font-semibold text-graphite">{fact.kicker}</span>
              <span className="mt-2 block text-balance text-[clamp(1rem,2.6vw,1.375rem)] font-semibold leading-snug">{fact.text}</span>
            </span>
            <span className="mt-4 block text-xs text-graphite opacity-70 group-active:opacity-100">Tap for another</span>
          </button>
        )}
      </div>

      <p className="absolute inset-x-0 -bottom-2 text-center text-sm text-graphite" aria-live="polite">
        {running ? (found.length ? `${found.length} markers found` : stage === "uploading" ? "Uploading" : "Reading") : null}
      </p>
    </div>
  );
}
