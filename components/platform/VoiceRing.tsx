"use client";

import { useEffect, useRef } from "react";
import { COUNTDOWN_MS } from "./autolog";
import type { RingMode } from "./say-view";
import { useReducedMotion, useVoiceLevel, type VoiceActivity } from "./VoiceMeter";

// The Say card's ring: 48 short radial ticks around the big control, in the orbit's
// language (Orbit.tsx), white on ink. It moves only with the voice (voice UX spec §4):
// - faint: starting. A still, faint ring.
// - live: the ticks draw in once (240 ms) when the mic goes live, then follow the voice.
//   Silence is still. The shape around the ring travels only as fast as the voice is loud.
// - count: the ring is the countdown's clock. Ticks go grey clockwise from twelve o'clock.
// - dim: errors and review. Still, at 20%.
// Reduced motion: no draw-in, two still lengths switched on speech start and end, and the
// countdown empties in three steps.
// Drawn in px for the phone's 176 px ring; CSS scales it for other sizes.

const TICKS = 48;
const R0 = 72;
const REST = 6;
const EXTRA = 16;
const DRAW_IN_MS = 240;
const clock = () => Date.now();

const angle = (i: number) => (i / TICKS) * Math.PI * 2;
const at = (i: number, r: number) => [(Math.sin(angle(i)) * r).toFixed(2), (-Math.cos(angle(i)) * r).toFixed(2)];

export function VoiceRing({ mode, activity, endsAt, className }: { mode: RingMode; activity: VoiceActivity; endsAt: number | null; className?: string }) {
  const reduced = useReducedMotion();
  const group = useRef<SVGGElement>(null);
  const read = useVoiceLevel(mode === "live" && !reduced, activity);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    const lines = [...g.children] as SVGLineElement[];
    const draw = (i: number, len: number, opacity: number, spent = false) => {
      const el = lines[i];
      const [x2, y2] = at(i, R0 + Math.max(0, len));
      el.setAttribute("x2", x2);
      el.setAttribute("y2", y2);
      el.setAttribute("stroke-opacity", opacity.toFixed(2));
      el.setAttribute("stroke", spent ? "var(--color-line)" : "currentColor");
    };
    const all = (len: number, opacity: number) => lines.forEach((_, i) => draw(i, len, opacity));

    if (mode === "faint" || mode === "dim") {
      all(REST, 0.2);
      return;
    }

    const spentShare = () => {
      if (endsAt == null) return 0;
      const f = Math.min(1, Math.max(0, 1 - (endsAt - clock()) / COUNTDOWN_MS));
      // Reduced motion: thirds, a second each, with no sweep.
      return reduced ? Math.floor(f * 3) / 3 : f;
    };
    const countFrame = () => {
      const f = spentShare();
      lines.forEach((_, i) => draw(i, REST, 1, i / TICKS < f));
    };

    if (reduced) {
      // Two still lengths, switched only when the browser says speech started or ended.
      const tick = () => {
        if (mode === "count") return countFrame();
        const speaking = activity.isSpeaking();
        all(speaking ? REST + EXTRA * 0.6 : REST, speaking ? 1 : 0.5);
      };
      tick();
      const id = setInterval(tick, 100);
      return () => clearInterval(id);
    }

    let raf = 0;
    let level = 0;
    let phase = 0;
    let last = 0;
    let began = 0;
    const frame = (t: number) => {
      if (mode === "count") countFrame();
      else {
        began ||= t;
        const dt = last ? Math.min(64, t - last) : 16;
        last = t;
        level += (read.current(t) - level) * 0.25;
        phase += level * dt * 0.006;
        const grow = Math.min(1, (t - began) / DRAW_IN_MS);
        const eased = 1 - (1 - grow) ** 3;
        const opacity = level > 0.04 ? 1 : 0.5;
        lines.forEach((_, i) => {
          const shape = 0.55 + 0.45 * Math.sin(angle(i) * 3 + phase) * Math.sin(angle(i) * 2 - phase * 0.7);
          draw(i, (REST + EXTRA * level * Math.max(0, shape)) * eased, opacity);
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode, reduced, endsAt, activity, read]);

  return (
    <svg viewBox="-88 -88 176 176" className={`overflow-visible text-paper ${className ?? ""}`} aria-hidden>
      {mode === "faint" && <circle r={R0 + REST / 2} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />}
      <g ref={group} strokeWidth="2" strokeLinecap="butt" style={{ visibility: mode === "faint" ? "hidden" : "visible" }}>
        {Array.from({ length: TICKS }, (_, i) => {
          const [x1, y1] = at(i, R0);
          const [x2, y2] = at(i, R0 + REST);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeOpacity={mode === "live" ? 0.5 : 0.2} />;
        })}
      </g>
    </svg>
  );
}
