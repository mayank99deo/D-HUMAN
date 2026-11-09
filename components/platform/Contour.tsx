"use client";

import { useId, useMemo, useState } from "react";

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

export function Contour({ markers, onSelectLabel = "Tap a marker to see it" }: { markers: ContourMarker[]; onSelectLabel?: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const uid = useId();
  const n = markers.length;

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

  return (
    <div>
      <svg viewBox={`-44 -16 ${SIZE + 88} ${SIZE + 32}`} className="mx-auto block w-full max-w-[30rem]" role="group" aria-labelledby={`${uid}-t`}>
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
            className="contour-draw"
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
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={COLOR[m.status] ?? "currentColor"} strokeWidth={on ? 3 : 2} />
              <circle cx={x} cy={y} r={on ? 5 : 3.6} fill={COLOR[m.status] ?? "transparent"} stroke={COLOR[m.status] ? "none" : "currentColor"} />
              {(m.status === "low" || m.status === "high" || on) && (
                <text
                  x={+(C + (outer + 12) * Math.cos(t)).toFixed(2)}
                  y={+(C + (outer + 12) * Math.sin(t)).toFixed(2)}
                  textAnchor={Math.cos(t) > 0.3 ? "start" : Math.cos(t) < -0.3 ? "end" : "middle"}
                  dominantBaseline="middle"
                  className="fill-paper text-[10px] font-semibold"
                >
                  {m.short}
                </text>
              )}
              <foreignObject x={+(x - 22).toFixed(2)} y={+(y - 22).toFixed(2)} width={44} height={44}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${m.name}: ${m.value ?? m.valueText ?? ""} ${m.unit ?? ""}`}
                  onClick={() => setSel(on ? null : m.id)}
                  className="h-11 w-11 rounded-full"
                />
              </foreignObject>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 min-h-16 text-center" aria-live="polite">
        {selected ? (
          <p>
            <span className="font-semibold">{selected.name}</span>{" "}
            <span className="display-num text-2xl">{selected.value ?? selected.valueText}</span>{" "}
            <span className="text-graphite">{selected.unit}</span>
            <span className="block text-sm text-graphite">Range {selected.range}</span>
          </p>
        ) : (
          <p className="text-sm text-graphite">{onSelectLabel}</p>
        )}
      </div>
    </div>
  );
}
