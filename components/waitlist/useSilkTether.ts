"use client";

import { useEffect, type RefObject } from "react";

// Silk threads that catch the pointer near a button: a bundle of thin strands
// runs from the side of the button facing the cursor to the cursor itself,
// sagging and swaying with rope physics. Moving away (or clicking) snaps them,
// and they fall away. Decorative only: drawn on a fixed canvas that ignores the
// pointer, and skipped on touch screens and when motion is reduced.

const RADIUS = 190; // px from the button's edge where the threads catch the pointer
const STRANDS = 15;
const SEGMENTS = 12;
const GRAVITY = 650; // px/s²
const DAMPING = 0.985;
const ITERATIONS = 8;
const DT = 1 / 60;
const GROW_MS = 260;
const FADE_MS = 700;
const SNAP_COOLDOWN_MS = 900;
const MAX_LEAN = 10; // px the button leans toward the cursor

type Point = { x: number; y: number; px: number; py: number };
type Strand = {
  t: number; // position across the bundle, 0..1
  slack: number;
  rest: number;
  end: { x: number; y: number }; // spread where the threads gather at the cursor
  width: number;
  alpha: number;
  sketch: { x: number; y: number }; // offset of the faint second pass that makes it look hand-drawn
  points: Point[];
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function distanceToRect(r: DOMRect, x: number, y: number) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

// The rectangle's outline as one line, walked clockwise from the top-left corner.
function pointOnOutline(r: DOMRect, s: number) {
  const w = r.width;
  const h = r.height;
  const perimeter = 2 * (w + h);
  let d = ((s % perimeter) + perimeter) % perimeter;
  if (d < w) return { x: r.left + d, y: r.top };
  d -= w;
  if (d < h) return { x: r.right, y: r.top + d };
  d -= h;
  if (d < w) return { x: r.right - d, y: r.bottom };
  d -= w;
  return { x: r.left, y: r.bottom - d };
}

function outlinePositionNearest(r: DOMRect, x: number, y: number) {
  const cx = clamp(x, r.left, r.right);
  const cy = clamp(y, r.top, r.bottom);
  const toLeft = cx - r.left;
  const toRight = r.right - cx;
  const toTop = cy - r.top;
  const toBottom = r.bottom - cy;
  const nearest = Math.min(toLeft, toRight, toTop, toBottom);
  if (nearest === toTop) return toLeft;
  if (nearest === toRight) return r.width + toTop;
  if (nearest === toBottom) return r.width + r.height + toRight;
  return 2 * r.width + r.height + toBottom;
}

export function useSilkTether(target: RefObject<HTMLElement | null>, rgb = "255,255,255") {
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "40",
    });
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.remove();
      return;
    }

    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };
    resize();

    const pointer = { x: 0, y: 0, present: false };
    let mode: "idle" | "attached" | "released" = "idle";
    let changedAt = 0;
    let cooldownUntil = 0;
    let strands: Strand[] = [];
    let raf = 0;
    const lean = { x: 0, y: 0 };

    const spawn = (anchor: { x: number; y: number }) => {
      strands = Array.from({ length: STRANDS }, (_, i) => ({
        t: i / (STRANDS - 1),
        slack: 1.04 + Math.random() * 0.16,
        rest: 0,
        end: { x: (Math.random() - 0.5) * 9, y: (Math.random() - 0.5) * 9 },
        width: 0.5 + Math.random() * 0.8,
        alpha: 0.4 + Math.random() * 0.5,
        sketch: { x: (Math.random() - 0.5) * 1.6, y: (Math.random() - 0.5) * 1.6 },
        points: Array.from({ length: SEGMENTS + 1 }, () => ({ ...anchor, px: anchor.x, py: anchor.y })),
      }));
    };

    const simulate = (strand: Strand, anchor: { x: number; y: number }, end: { x: number; y: number } | null) => {
      const pts = strand.points;
      const last = pts.length - 1;
      for (let k = 1; k <= last; k++) {
        if (end && k === last) continue;
        const p = pts[k];
        const vx = (p.x - p.px) * DAMPING;
        const vy = (p.y - p.py) * DAMPING;
        p.px = p.x;
        p.py = p.y;
        p.x += vx;
        p.y += vy + GRAVITY * DT * DT;
      }
      Object.assign(pts[0], { x: anchor.x, y: anchor.y, px: anchor.x, py: anchor.y });
      if (end) {
        Object.assign(pts[last], { x: end.x, y: end.y, px: end.x, py: end.y });
        strand.rest = Math.hypot(end.x - anchor.x, end.y - anchor.y) * strand.slack;
      } else {
        strand.rest *= 0.96; // a released thread draws back toward the button as it falls
      }
      const segment = strand.rest / SEGMENTS;
      for (let it = 0; it < ITERATIONS; it++) {
        for (let k = 0; k < last; k++) {
          const a = pts[k];
          const b = pts[k + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          const diff = (d - segment) / d;
          const aPinned = k === 0;
          const bPinned = end !== null && k + 1 === last;
          if (aPinned && bPinned) continue;
          const share = aPinned || bPinned ? 1 : 0.5;
          if (!aPinned) {
            a.x += dx * diff * share;
            a.y += dy * diff * share;
          }
          if (!bPinned) {
            b.x -= dx * diff * share;
            b.y -= dy * diff * share;
          }
        }
      }
    };

    const tracePath = (pts: Point[], ox: number, oy: number) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x + ox, pts[0].y + oy);
      for (let k = 1; k < pts.length - 1; k++) {
        const mx = (pts[k].x + pts[k + 1].x) / 2;
        const my = (pts[k].y + pts[k + 1].y) / 2;
        ctx.quadraticCurveTo(pts[k].x + ox, pts[k].y + oy, mx + ox, my + oy);
      }
      const end = pts[pts.length - 1];
      ctx.lineTo(end.x + ox, end.y + oy);
    };

    const draw = (now: number, closeness: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (mode === "idle") return;
      const fade = mode === "released" ? clamp(1 - (now - changedAt) / FADE_MS, 0, 1) : 1;
      // Threads look thinner and fainter near the edge of their reach, about to snap.
      const tension = mode === "attached" ? 0.45 + 0.55 * closeness : 0.8;
      ctx.lineCap = "round";
      for (const s of strands) {
        ctx.lineWidth = s.width;
        ctx.strokeStyle = `rgba(${rgb},${s.alpha * fade * tension})`;
        tracePath(s.points, 0, 0);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${rgb},${s.alpha * fade * tension * 0.35})`;
        tracePath(s.points, s.sketch.x, s.sketch.y);
        ctx.stroke();
      }
    };

    const frame = (now: number) => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const distance = distanceToRect(rect, pointer.x, pointer.y);
      const reach =
        pointer.present && distance < RADIUS && !reducedMotion.matches && !document.hidden && now > cooldownUntil;

      if (reach && mode !== "attached") {
        mode = "attached";
        changedAt = now;
        spawn(pointOnOutline(rect, outlinePositionNearest(rect, pointer.x, pointer.y)));
      } else if (!reach && mode === "attached") {
        mode = "released";
        changedAt = now;
      } else if (mode === "released" && now - changedAt > FADE_MS) {
        mode = "idle";
        strands = [];
      }

      // The button leans gently toward the cursor while the threads hold it.
      const cx = rect.left + rect.width / 2 - lean.x;
      const cy = rect.top + rect.height / 2 - lean.y;
      const pull = mode === "attached" ? 0.14 : 0;
      let tx = (pointer.x - cx) * pull;
      let ty = (pointer.y - cy) * pull;
      const len = Math.hypot(tx, ty);
      if (len > MAX_LEAN) {
        tx = (tx / len) * MAX_LEAN;
        ty = (ty / len) * MAX_LEAN;
      }
      lean.x += (tx - lean.x) * 0.15;
      lean.y += (ty - lean.y) * 0.15;
      el.style.transform = Math.hypot(lean.x, lean.y) > 0.05 ? `translate(${lean.x}px, ${lean.y}px)` : "";

      if (mode !== "idle") {
        const centre = outlinePositionNearest(rect, pointer.x, pointer.y);
        const spread = Math.min(rect.width * 0.85, (rect.width + rect.height) * 0.6);
        const grow = mode === "attached" ? 1 - (1 - clamp((now - changedAt) / GROW_MS, 0, 1)) ** 3 : 0;
        for (const s of strands) {
          const anchor = pointOnOutline(rect, centre + (s.t - 0.5) * spread);
          const end =
            mode === "attached"
              ? {
                  x: anchor.x + (pointer.x + s.end.x - anchor.x) * grow,
                  y: anchor.y + (pointer.y + s.end.y - anchor.y) * grow,
                }
              : null;
          simulate(s, anchor, end);
        }
      }

      draw(now, clamp(1 - distance / RADIUS, 0, 1));
      document.documentElement.style.cursor = mode === "attached" && distance > 0 ? "grab" : "";

      if (mode !== "idle" || el.style.transform) raf = requestAnimationFrame(frame);
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.present = true;
      if (mode !== "idle" || distanceToRect(el.getBoundingClientRect(), pointer.x, pointer.y) < RADIUS) kick();
    };
    const onLeave = () => {
      pointer.present = false;
      kick();
    };
    // Clicking snaps the threads; they reattach after a moment.
    const onPress = () => {
      cooldownUntil = performance.now() + SNAP_COOLDOWN_MS;
      kick();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    window.addEventListener("resize", resize);
    el.addEventListener("pointerdown", onPress);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("resize", resize);
      el.removeEventListener("pointerdown", onPress);
      el.style.transform = "";
      document.documentElement.style.cursor = "";
      canvas.remove();
    };
  }, [target, rgb]);
}
