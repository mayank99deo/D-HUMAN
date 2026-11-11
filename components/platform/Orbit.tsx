"use client";

import { useEffect, useMemo, useState } from "react";

// The orbit: D-Human's waiting screen. Two rings of type circle the centre; the
// outer one carries what's personal (markers found, or your age, height and
// weight bands), the inner one the steps. Between them, a ring of ticks fills
// from pale to deep green as the work nears done. The centre holds one fact at
// a time, still and large, so the moving parts never cost readability.

export type OrbitFact = { kicker: string; text: string; scope?: string };
export type OrbitStep = { text: string; state: "done" | "now" | "next" };

const LIGHT = [214, 235, 221]; // pale green at the start of the ring
const DEEP = [47, 158, 91]; // full green at 100%
const green = (t: number) => {
  const c = LIGHT.map((l, i) => Math.round(l + (DEEP[i] - l) * Math.min(1, Math.max(0, t))));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
};

function seeded(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function OrbitScreen({
  facts,
  ring,
  ringLit = true,
  steps,
  progress,
  state,
  ripples = 0,
  caption,
  done,
  error,
  actions,
}: {
  facts: OrbitFact[];
  ring: string[];
  ringLit?: boolean;
  steps: OrbitStep[];
  progress: number; // 0–1
  state: "running" | "done" | "error";
  ripples?: number; // how many ripples the inner contour carries
  caption?: string | null;
  done?: React.ReactNode; // the centre once finished
  error?: string | null;
  actions?: React.ReactNode; // buttons under the centre when finished or failed
}) {
  const [f, setF] = useState(0);
  const [showFact, setShowFact] = useState(false);
  const running = state === "running";

  useEffect(() => {
    if (!running || facts.length < 2) return;
    const id = setInterval(() => setF((x) => (x + 1) % facts.length), 8500);
    return () => clearInterval(id);
  }, [running, facts.length]);

  // The outer ring repeats its items until it fills the circle. Em spaces: SVG collapses ordinary ones.
  const outer = useMemo(() => {
    const items = ring.length ? ring : ["D-Human"];
    const gap = "  ";
    let s = "";
    while (s.length < 120) s += items.join(gap) + gap;
    return s;
  }, [ring]);

  // An inner contour that gains a ripple for each thing found.
  const ripple = useMemo(() => {
    const c = 300;
    let d = "";
    for (let k = 0; k <= 180; k++) {
      const t = (k / 180) * Math.PI * 2;
      let r = 150;
      for (let i = 0; i < ripples; i++) {
        const a = seeded(i) * Math.PI * 2;
        let dt = Math.abs(t - a) % (Math.PI * 2);
        if (dt > Math.PI) dt = Math.PI * 2 - dt;
        r += (seeded(i + 99) > 0.5 ? 1 : -1) * 9 * Math.exp(-(dt * dt) / 0.03);
      }
      r += 1.5 * Math.sin(4 * t);
      d += `${k ? "L" : "M"}${(c + r * Math.cos(t)).toFixed(1)} ${(c + r * Math.sin(t)).toFixed(1)}`;
    }
    return `${d}Z`;
  }, [ripples]);

  const ticks = 96;
  const lit = Math.round(Math.min(1, Math.max(0, progress)) * ticks);
  const fact = facts.length ? facts[f % facts.length] : null;

  const factView = fact && (
    <button
      type="button"
      onClick={() => setF((x) => (x + 1) % Math.max(1, facts.length))}
      className="group"
      aria-label="Show another fact"
    >
      <span key={f} className="fact-in block">
        {fact.scope && <span className="block text-xs font-semibold" style={{ color: green(0.75) }}>{fact.scope}</span>}
        <span className="mt-1 block text-sm font-semibold text-graphite">{fact.kicker}</span>
        <span className="mt-2 block text-balance text-[clamp(0.9rem,2.5vw,1.375rem)] font-semibold leading-snug">{fact.text}</span>
      </span>
      <span className="mt-3 block text-xs text-graphite group-active:text-paper">Tap for another</span>
    </button>
  );

  return (
    <div className="relative aspect-square w-[min(150vw,78dvh,44rem)] shrink-0">
      <svg viewBox="0 0 600 600" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <path id="orbit-outer" d="M300 300m-268 0a268 268 0 1 1 536 0a268 268 0 1 1 -536 0" />
          <path id="orbit-inner" d="M300 300m-224 0a224 224 0 1 1 448 0a224 224 0 1 1 -448 0" />
        </defs>

        <g className={state !== "error" ? "orbit-spin" : ""} style={{ ["--orbit-speed" as string]: running ? "110s" : "220s" }}>
          <text className="fill-paper text-[17px] font-semibold" style={{ fontVariationSettings: '"wdth" 112' }} opacity={ringLit ? 0.9 : 0.6}>
            <textPath href="#orbit-outer">{outer}</textPath>
          </text>
        </g>

        <g className={state !== "error" ? "orbit-spin-back" : ""} style={{ ["--orbit-speed" as string]: running ? "150s" : "300s" }}>
          <text className="text-[14px]">
            <textPath href="#orbit-inner">
              {/* State by mark and weight, not by fading: ✓ done, ● now (bold, white), plain for next. */}
              {steps.map((x, i) => (
                <tspan key={i} className={x.state === "now" ? "fill-paper font-bold" : "fill-graphite"}>
                  {x.state === "done" ? "✓ " : x.state === "now" ? "● " : ""}
                  {x.text}
                  {"   "}
                </tspan>
              ))}
            </textPath>
          </text>
        </g>

        {/* Progress ticks: each lit tick is greener than the one before, so the ring deepens as it nears 100%. */}
        {Array.from({ length: ticks }, (_, i) => {
          const a = -Math.PI / 2 + (i / ticks) * Math.PI * 2;
          const on = i < lit;
          // Lit ticks are longer and thicker as well as green, so progress reads without colour.
          const inner = on ? (i % 8 === 0 ? 178 : 182) : i % 8 === 0 ? 184 : 188;
          return (
            <line
              key={i}
              x1={(300 + 194 * Math.cos(a)).toFixed(2)}
              y1={(300 + 194 * Math.sin(a)).toFixed(2)}
              x2={(300 + inner * Math.cos(a)).toFixed(2)}
              y2={(300 + inner * Math.sin(a)).toFixed(2)}
              stroke={on ? green(i / (ticks - 1)) : "var(--color-line-strong)"}
              strokeWidth={on ? 2.4 : 1}
              style={{ transition: "stroke 400ms" }}
            />
          );
        })}

        <g className={state !== "error" ? "orbit-spin" : ""} style={{ ["--orbit-speed" as string]: "60s" }}>
          <path d={ripple} fill="none" stroke={state === "done" ? green(1) : "var(--color-paper)"} strokeOpacity={state === "done" ? 0.6 : 0.35} strokeWidth={1.2} />
        </g>
      </svg>

      {/* The readable centre */}
      <div className="absolute inset-[23%] isolate flex flex-col items-center justify-center text-center" aria-live="polite">
        {/* A soft black disc behind the centre, so text stays readable wherever the rings pass. */}
        <div aria-hidden className="pointer-events-none absolute -inset-[14%] -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(0_0_0/0.94)_62%,transparent)]" />
        {state === "error" ? (
          <div className="fact-in">
            <p className="error-mark text-lg font-semibold">{error ?? "Something went wrong."}</p>
            <div className="mt-5">{actions}</div>
          </div>
        ) : state === "done" && !showFact ? (
          <div className="fact-in">
            {done}
            <div className="mt-4">{actions}</div>
            {facts.length > 0 && (
              <button type="button" className="link-quiet mt-2 min-h-11 text-sm" onClick={() => setShowFact(true)}>
                Another fact
              </button>
            )}
          </div>
        ) : (
          <div>
            {factView}
            {state === "done" && (
              <button type="button" className="link-quiet mt-2 min-h-11 text-sm" onClick={() => setShowFact(false)}>
                Back to the result
              </button>
            )}
          </div>
        )}
      </div>

      <p className="absolute inset-x-0 -bottom-2 text-center text-sm text-graphite" aria-live="polite">
        {running ? caption : null}
      </p>
    </div>
  );
}

// ── The report version ────────────────────────────────────────────────────
export type Stage = "uploading" | "reading" | "matching" | "weighing" | "writing" | "done" | "error";
const ORDER: Stage[] = ["uploading", "reading", "matching", "weighing", "writing", "done"];

export function Orbit({
  facts,
  found,
  stage,
  noun,
  target,
  error,
  children,
}: {
  facts: OrbitFact[];
  found: string[];
  stage: Stage;
  noun: string;
  target: string | null;
  error?: string | null;
  children?: React.ReactNode; // actions shown when done or failed
}) {
  const at = ORDER.indexOf(stage === "error" ? "reading" : stage);
  const steps: OrbitStep[] = (
    [
      ["reading", "Reading your pages"],
      ["matching", "Matching every range"],
      ["weighing", target ? `Weighing it for ${target}` : `Weighing it for a ${noun}`],
      ["writing", "Writing your read"],
    ] as const
  ).map(([s, text]) => {
    const idx = ORDER.indexOf(s);
    return { text, state: stage === "done" || idx < at ? "done" : idx === at ? "now" : "next" };
  });
  const progress = stage === "done" ? 1 : Math.max(0.04, (at - 0.5) / (ORDER.length - 1)) + Math.min(found.length, 30) / 300;

  return (
    <OrbitScreen
      facts={facts}
      ring={found.length ? found : ["Opening your report"]}
      ringLit={found.length > 0}
      steps={steps}
      progress={progress}
      state={stage === "done" ? "done" : stage === "error" ? "error" : "running"}
      ripples={found.length}
      caption={found.length ? `${found.length} markers found` : stage === "uploading" ? "Uploading" : "Reading"}
      done={<p className="verdict-type text-[clamp(1.75rem,5vw,2.5rem)]">Your read is ready.</p>}
      error={error}
      actions={children}
    />
  );
}
