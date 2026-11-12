"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

// "Your contour": every marker on the report becomes a direction on a
// topographic fingerprint. In range, the lines run calm; a marker below range
// pulls them in, one above pushes them out. The same contour language as the
// site's hero, drawn from your own blood.

export type ContourMarker = {
  id: string;
  short: string;
  name: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  low: number | null;
  high: number | null;
  status: string;
  range: string;
};

const RINGS = 9;
const SIZE = 340;
const C = SIZE / 2;
const R0 = 30;
const STEP = 12;
const PAD = 76; // room either side for the labels, which are set large enough to read on a phone

function deviation(m: ContourMarker) {
  const v = m.value;
  if (v == null) return 0;
  const { low, high } = m;
  if (low != null && high != null && high > low) {
    const z = (v - (low + high) / 2) / ((high - low) / 2);
    return Math.max(-1, Math.min(1, z / 2));
  }
  if (high != null && high > 0) return v > high ? Math.min(1, 0.5 + (v - high) / high) : Math.max(0, Math.min(0.5, v / high - 0.5));
  if (low != null && low > 0) return v < low ? -Math.min(1, 0.5 + (low - v) / low) : 0;
  return 0;
}

const COLOR: Record<string, string> = {
  in_range: "var(--color-serum)",
  edge_low: "var(--color-straw)",
  edge_high: "var(--color-straw)",
  low: "var(--color-haem)",
  high: "var(--color-haem)",
};

// Shape carries the status, colour only confirms it (the same set as the
// .glyph classes): a disc in range, a half disc at the edge, a diamond out of
// range, a ring when there's no range.
function StatusMark({ x, y, status, on }: { x: number; y: number; status: string; on: boolean }) {
  const s = on ? 1.35 : 1;
  const r = 4.6 * s;
  const color = COLOR[status];
  if (status === "low" || status === "high") {
    const d = 6.2 * s;
    return <path d={`M${x} ${y - d}L${x + d} ${y}L${x} ${y + d}L${x - d} ${y}Z`} fill={color} />;
  }
  if (status === "edge_low" || status === "edge_high")
    return (
      <g>
        <circle cx={x} cy={y} r={r - 0.75} fill="none" stroke={color} strokeWidth={1.5} />
        <path d={`M${x} ${y - r}A${r} ${r} 0 0 0 ${x} ${y + r}Z`} fill={color} />
      </g>
    );
  if (status === "in_range") return <circle cx={x} cy={y} r={r} fill={color} />;
  return <circle cx={x} cy={y} r={r - 0.75} fill="none" stroke="var(--color-graphite)" strokeWidth={1.5} />;
}

// The draw-in is a moment, not wallpaper: once per browser session for each
// read, when the contour first comes into view. Reduced motion never draws.
const DRAWN = "dh:contour-drawn";
function useDrawOnce(ref: React.RefObject<SVGSVGElement | null>, signature: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !signature || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(sessionStorage.getItem(DRAWN) ?? "[]");
    } catch {
      /* storage blocked: draw every time, as before */
    }
    if (seen.includes(signature)) return;
    const play = () => {
      el.dataset.draw = "on";
      try {
        sessionStorage.setItem(DRAWN, JSON.stringify([...seen, signature].slice(-20)));
      } catch {
        /* ignore */
      }
    };
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return play();
    // Off screen: hide the lines now, draw them in when the person gets there.
    el.dataset.draw = "armed";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        play();
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, signature]);
}

const statusText = (s: string) =>
  ({ in_range: "In range", edge_low: "Low end of range", edge_high: "High end of range", low: "Below range", high: "Above range" })[s] ?? "No range printed";

export function Contour({ markers, onSelectLabel = "Tap a marker to see it" }: { markers: ContourMarker[]; onSelectLabel?: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const uid = useId();
  const n = markers.length;
  const svg = useRef<SVGSVGElement>(null);
  useDrawOnce(svg, n ? `${markers[0].id}:${n}` : "");

  const { angles, paths } = useMemo(() => {
    const angles = markers.map((_, i) => -Math.PI / 2 + (i / n) * Math.PI * 2);
    const devs = markers.map(deviation);
    const sigma = Math.max(0.12, (Math.PI * 2) / Math.max(n, 1) / 1.6);
    const field = (t: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) {
        let d = Math.abs(t - angles[i]) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        s += devs[i] * Math.exp(-(d * d) / (2 * sigma * sigma));
      }
      return s;
    };
    const out: string[] = [];
    for (let r = 0; r < RINGS; r++) {
      const base = R0 + r * STEP;
      const amp = 6 + r * 3.6;
      let d = "";
      const steps = 180;
      for (let k = 0; k <= steps; k++) {
        const t = -Math.PI / 2 + (k / steps) * Math.PI * 2;
        const wobble = 1.1 * Math.sin(3 * t + r * 0.9) + 0.7 * Math.sin(5 * t - r * 1.3);
        const rad = base + amp * field(t) + wobble;
        d += `${k ? "L" : "M"}${(C + rad * Math.cos(t)).toFixed(2)} ${(C + rad * Math.sin(t)).toFixed(2)}`;
      }
      out.push(`${d}Z`);
    }
    return { angles, paths: out };
  }, [markers, n]);

  const selected = markers.find((m) => m.id === sel) ?? null;
  const outer = R0 + (RINGS - 1) * STEP + 30;
  // Tap areas as big as the room between neighbours allows: 44 units at the least, 66 at most.
  // The drawing shrinks on phones (about 0.67 px a unit at 360 px), so 44 alone came out 29 px.
  const hit = Math.round(Math.min(66, Math.max(44, (2 * Math.PI * outer) / Math.max(1, markers.length))));

  return (
    <div>
      <svg ref={svg} viewBox={`-${PAD} -24 ${SIZE + PAD * 2} ${SIZE + 48}`} className="mx-auto block w-full max-w-[32rem]" role="group" aria-labelledby={`${uid}-t`}>
        <title id={`${uid}-t`}>Your contour: each marker is a direction; lines bulge out above range and pull in below it.</title>
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={i === RINGS - 1 ? 1.4 : 1}
            opacity={0.2 + (i / RINGS) * 0.6}
            pathLength={1}
            className="contour-line"
            style={{ animationDelay: `${i * 70}ms` }}
          />
        ))}
        {markers.map((m, i) => {
          const t = angles[i];
          // Rounded: server and browser maths can differ in the last digit, which breaks hydration.
          const at = (r: number) => [+(C + r * Math.cos(t)).toFixed(2), +(C + r * Math.sin(t)).toFixed(2)] as const;
          const [x, y] = at(outer);
          const [x0, y0] = at(outer - 16);
          const [x1, y1] = at(outer - 8);
          const on = sel === m.id;
          return (
            <g key={m.id}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={COLOR[m.status] ?? "var(--color-graphite)"} strokeWidth={on ? 3 : 2} />
              <StatusMark x={x} y={y} status={m.status} on={on} />
              {(m.status === "low" || m.status === "high" || on) && (
                <text
                  x={+(C + (outer + 13) * Math.cos(t)).toFixed(2)}
                  y={+(C + (outer + 13) * Math.sin(t)).toFixed(2)}
                  textAnchor={Math.cos(t) > 0.3 ? "start" : Math.cos(t) < -0.3 ? "end" : "middle"}
                  dominantBaseline="middle"
                  className="fill-paper text-[16px] font-semibold"
                >
                  {m.short.length > 9 ? `${m.short.slice(0, 8)}…` : m.short}
                </text>
              )}
              <foreignObject x={+(x - hit / 2).toFixed(2)} y={+(y - hit / 2).toFixed(2)} width={hit} height={hit}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${m.name}: ${m.value ?? m.valueText ?? ""} ${m.unit ?? ""}, ${statusText(m.status).toLowerCase()}`}
                  onClick={() => setSel(on ? null : m.id)}
                  className="h-full w-full rounded-full"
                />
              </foreignObject>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-graphite" aria-label="Key">
        {[
          ["glyph-in", "In range"],
          ["glyph-edge", "Edge of range"],
          ["glyph-out", "Out of range"],
        ].map(([g, label]) => (
          <li key={g} className="flex items-center gap-2">
            <span aria-hidden className={`glyph ${g}`} />
            {label}
          </li>
        ))}
      </ul>
      <div className="mt-3 min-h-16 text-center" aria-live="polite">
        {selected ? (
          <p>
            <span className="font-semibold">{selected.name}</span>{" "}
            <span className="display-num text-2xl">{selected.value ?? selected.valueText}</span>{" "}
            <span className="text-graphite">{selected.unit}</span>
            <span className="block text-sm text-graphite">
              {statusText(selected.status)}, range {selected.range}
            </span>
          </p>
        ) : (
          <p className="text-sm text-graphite">{onSelectLabel}</p>
        )}
      </div>
    </div>
  );
}
