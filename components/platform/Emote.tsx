"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Archetype } from "@/lib/domain/persona";

// The persona emote: a sports-pictogram figure in the brand's heavy stroke,
// animated with a tiny two-bone rig. Each sport is a function from cycle phase
// (0–1) to a pose; limbs are solved by inverse kinematics from hand and foot
// targets, so feet stay planted and hands stay on the sled, bar or bars.

type P = [number, number];
type Pose = {
  hip: P;
  lean: number; // torso, degrees from upright, forward positive
  hands: [P, P]; // near, far
  feet: [P, P];
  props?: Props;
};
type Props = {
  ball?: { at: P; o: number };
  sled?: boolean;
  plate?: boolean;
  bike?: number; // crank angle
  pack?: boolean;
  pole?: boolean;
  water?: number;
  dash?: number;
};

const TORSO = 22;
const UA = 13;
const FA = 12;
const TH = 17;
const SH = 17;
const rad = (d: number) => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: P, b: P, t: number): P => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

function neckOf(hip: P, lean: number): P {
  return [hip[0] + TORSO * Math.sin(rad(lean)), hip[1] - TORSO * Math.cos(rad(lean))];
}

// Two-bone IK. bend +1 puts the joint on the clockwise side (elbows back), -1 the other (knees forward).
function ik(root: P, target: P, l1: number, l2: number, bend: 1 | -1): P {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
  const phi = Math.atan2(dy, dx);
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const ang = phi + bend * a;
  return [root[0] + l1 * Math.cos(ang), root[1] + l1 * Math.sin(ang)];
}

function mix(a: Pose, b: Pose, t: number): Pose {
  const e = ease(t);
  return {
    hip: lerpP(a.hip, b.hip, e),
    lean: lerp(a.lean, b.lean, e),
    hands: [lerpP(a.hands[0], b.hands[0], e), lerpP(a.hands[1], b.hands[1], e)],
    feet: [lerpP(a.feet[0], b.feet[0], e), lerpP(a.feet[1], b.feet[1], e)],
    props: a.props,
  };
}

function cycle(frames: Pose[], t: number): Pose {
  const n = frames.length;
  const x = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(x) % n;
  return mix(frames[i], frames[(i + 1) % n], x - Math.floor(x));
}

const swap = (p: Pose): Pose => ({ ...p, hands: [p.hands[1], p.hands[0]], feet: [p.feet[1], p.feet[0]] });

// ── Sports ──────────────────────────────────────────────────────────────
const RUN_A: Pose = { hip: [46, 60], lean: 12, hands: [[44, 52], [62, 40]], feet: [[63, 91], [24, 82]] };
const RUN_B: Pose = { hip: [46, 58], lean: 12, hands: [[52, 50], [55, 47]], feet: [[44, 92], [44, 76]] };
const WALK_A: Pose = { hip: [48, 59], lean: 3, hands: [[44, 76], [58, 75]], feet: [[59, 92], [37, 92]] };
const WALK_B: Pose = { hip: [48, 58], lean: 3, hands: [[50, 77], [51, 77]], feet: [[49, 92], [45, 87]] };

const SPORTS: Record<Archetype, { ms: number; pose: (t: number) => Pose }> = {
  running: { ms: 720, pose: (t) => ({ ...cycle([RUN_A, RUN_B, swap(RUN_A), swap(RUN_B)], t), props: { dash: t } }) },
  walking: { ms: 1150, pose: (t) => cycle([WALK_A, WALK_B, swap(WALK_A), swap(WALK_B)], t) },
  trekking: {
    ms: 1500,
    pose: (t) => {
      const A: Pose = { hip: [46, 58], lean: 12, hands: [[64, 70], [40, 72]], feet: [[57, 89], [35, 93]] };
      const B: Pose = { hip: [47, 56.5], lean: 12, hands: [[62, 68], [46, 73]], feet: [[48, 90.5], [44, 86]] };
      return { ...cycle([A, B, { ...swap(A), hands: [[66, 69], [38, 73]] }, { ...swap(B), hands: [[63, 67], [46, 73]] }], t), props: { pack: true, pole: true } };
    },
  },
  hyrox: {
    ms: 1300,
    pose: (t) => {
      const A: Pose = { hip: [36, 66], lean: 62, hands: [[80, 52], [79, 54]], feet: [[52, 92], [14, 90]] };
      return { ...cycle([A, swap(A)], t), hands: [[80, 52], [79, 54]], props: { sled: true, dash: t } };
    },
  },
  strength: {
    ms: 2600,
    pose: (t) => {
      const up: Pose = { hip: [48, 58], lean: 4, hands: [[44, 34], [43, 35]], feet: [[50, 92], [47, 92]] };
      const down: Pose = { hip: [39, 74], lean: 34, hands: [[47, 47], [46, 48]], feet: [[50, 92], [47, 92]] };
      // Hold at the top, sink, drive up.
      const s = t < 0.35 ? 0 : t < 0.65 ? (t - 0.35) / 0.3 : t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      return { ...mix(up, down, s), props: { plate: true } };
    },
  },
  cycling: {
    ms: 900,
    pose: (t) => {
      const a = t * Math.PI * 2;
      const bb: P = [50, 80];
      const pedal = (o: number): P => [bb[0] + 7 * Math.cos(a + o), bb[1] + 7 * Math.sin(a + o)];
      return { hip: [43, 55], lean: 58, hands: [[70, 54], [69, 55]], feet: [pedal(0), pedal(Math.PI)], props: { bike: a } };
    },
  },
  swimming: {
    ms: 1700,
    pose: (t) => {
      const a = t * Math.PI * 2;
      const sh: P = [62, 62];
      const stroke = (o: number): P => [sh[0] + 22 * Math.cos(a + o), sh[1] + 10 * Math.sin(a + o)];
      const kick = (o: number): P => [12, 63 + 3 * Math.sin(a * 3 + o)];
      return { hip: [41, 63], lean: 88, hands: [stroke(0), stroke(Math.PI)], feet: [kick(0), kick(Math.PI)], props: { water: t } };
    },
  },
  yoga: {
    ms: 6000,
    pose: (t) => {
      const down: Pose = { hip: [49, 57], lean: 0, hands: [[52, 38], [51, 39]], feet: [[57, 74], [49, 92]] };
      const up: Pose = { hip: [49, 56], lean: 0, hands: [[50, 14], [49, 15]], feet: [[57, 73], [49, 92]] };
      return cycle([down, up], t);
    },
  },
  team: {
    ms: 2200,
    pose: (t) => {
      const ready: Pose = { hip: [44, 59], lean: 6, hands: [[38, 74], [54, 72]], feet: [[48, 92], [40, 92]] };
      const wind: Pose = { hip: [44, 59], lean: 10, hands: [[56, 66], [32, 70]], feet: [[30, 82], [46, 92]] };
      const kick: Pose = { hip: [46, 60], lean: -4, hands: [[30, 70], [58, 64]], feet: [[70, 80], [46, 92]] };
      const p = cycle([ready, wind, kick, ready], t);
      const flight = t > 0.5 && t < 0.8 ? (t - 0.5) / 0.3 : t >= 0.8 ? 1 : 0;
      return { ...p, props: { ball: { at: [64 + flight * 30, 89 - Math.sin(flight * Math.PI) * 26], o: t >= 0.8 ? 0 : 1 } } };
    },
  },
  starting: {
    ms: 4200,
    pose: (t) => {
      const rest: Pose = { hip: [49, 58], lean: 0, hands: [[46, 77], [52, 77]], feet: [[52, 92], [46, 92]] };
      const reach: Pose = { hip: [49, 55], lean: -3, hands: [[44, 16], [55, 17]], feet: [[52, 90], [46, 90]] };
      return cycle([rest, reach], t);
    },
  },
};

// ── Drawing ─────────────────────────────────────────────────────────────
type Built = { near: string; far: string; head: P; props: string; propsFill: string; ballO: number };

function build(p: Pose): Built {
  const neck = neckOf(p.hip, p.lean);
  const shoulder = lerpP(p.hip, neck, 0.9);
  const limb = (root: P, target: P, l1: number, l2: number, bend: 1 | -1) => {
    const j = ik(root, target, l1, l2, bend);
    const v: P = [target[0] - j[0], target[1] - j[1]];
    const len = Math.hypot(v[0], v[1]) || 1;
    const end: P = [j[0] + (v[0] / len) * l2, j[1] + (v[1] / len) * l2];
    return `M${root[0].toFixed(2)} ${root[1].toFixed(2)}L${j[0].toFixed(2)} ${j[1].toFixed(2)}L${end[0].toFixed(2)} ${end[1].toFixed(2)}`;
  };
  const near =
    `M${p.hip[0].toFixed(2)} ${p.hip[1].toFixed(2)}L${neck[0].toFixed(2)} ${neck[1].toFixed(2)}` +
    limb(p.hip, p.feet[0], TH, SH, -1) +
    limb(shoulder, p.hands[0], UA, FA, 1);
  const far = limb(p.hip, p.feet[1], TH, SH, -1) + limb(shoulder, p.hands[1], UA, FA, 1);
  const lean = rad(p.lean);
  const head: P = [neck[0] + 7.5 * Math.sin(lean), neck[1] - 7.5 * Math.cos(lean)];

  let props = "";
  let propsFill = "";
  const pr = p.props ?? {};
  if (pr.dash != null) {
    const off = (pr.dash * 16) % 16;
    for (let x = -off; x < 100; x += 16) props += `M${(x + 2).toFixed(1)} 96L${(x + 8).toFixed(1)} 96`;
  }
  if (pr.sled) props += "M84 92L98 92L96 76L84 76ZM82 52L84 76";
  if (pr.plate) {
    // A barbell seen end-on: the plate as a ring with its hub, sitting on the upper back.
    const c: P = [shoulder[0] - 3, shoulder[1] + 1];
    props += circle(c[0], c[1], 9.5);
    propsFill += circle(c[0], c[1], 2.6);
  }
  if (pr.pack) {
    const back = lerpP(p.hip, neck, 0.62);
    const bx = back[0] - 7 * Math.cos(lean);
    const by = back[1] - 7 * Math.sin(lean);
    propsFill += rotRect(bx, by, 9, 16, p.lean);
  }
  if (pr.pole) {
    const h = p.hands[0];
    props += `M${h[0].toFixed(1)} ${(h[1] - 4).toFixed(1)}L${(h[0] + 6).toFixed(1)} 92`;
  }
  if (pr.bike != null) {
    props += ringPath(26, 80, 13) + ringPath(76, 80, 13);
    props += "M26 80L50 80L68 56M50 80L41 58M38 57L45 57M41 58L68 58M66 52L72 52L76 80";
  }
  if (pr.water != null) {
    const w = pr.water * Math.PI * 2;
    props += "M0 70";
    for (let x = 0; x <= 100; x += 5) props += `L${x} ${(70 + 1.6 * Math.sin(x / 7 + w)).toFixed(2)}`;
  }
  return { near, far, head, props, propsFill, ballO: pr.ball?.o ?? 0 };
}

const circle = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const ringPath = (x: number, y: number, r: number) => circle(x, y, r);
function rotRect(cx: number, cy: number, w: number, h: number, deg: number) {
  const a = rad(deg);
  const pts = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
  return `M${pts.map((q) => q.map((n) => n.toFixed(2)).join(" ")).join("L")}Z`;
}

// The most telling moment of each sport, used for the still figure.
const STILL: Partial<Record<Archetype, number>> = { running: 0.05, strength: 0.6, starting: 0.5, yoga: 0.5, team: 0.55, walking: 0.05, trekking: 0.05 };

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(motionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

export function Emote({
  archetype,
  className,
  label,
  phase,
}: {
  archetype: Archetype;
  className?: string;
  label?: string;
  /** A fixed point in the cycle (0–1). Renders a still figure. */
  phase?: number;
}) {
  const sport = SPORTS[archetype] ?? SPORTS.starting;
  const prefersReduced = useSyncExternalStore(subscribe, () => window.matchMedia(motionQuery).matches, () => false);
  const reduced = prefersReduced || phase != null;
  const still = build(sport.pose(phase ?? STILL[archetype] ?? 0.12));
  const svg = useRef<SVGSVGElement>(null);
  const near = useRef<SVGPathElement>(null);
  const far = useRef<SVGPathElement>(null);
  const head = useRef<SVGCircleElement>(null);
  const props = useRef<SVGPathElement>(null);
  const propsFill = useRef<SVGPathElement>(null);
  const ball = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (reduced || !svg.current) return;
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(tick);
    });
    io.observe(svg.current);
    const start = performance.now();
    function tick(now: number) {
      raf = 0;
      if (!visible) return;
      // The first frame's timestamp can predate `start`; keep the phase in 0–1.
      const pose = sport.pose((((now - start) % sport.ms) + sport.ms) % sport.ms / sport.ms);
      const b = build(pose);
      near.current?.setAttribute("d", b.near);
      far.current?.setAttribute("d", b.far);
      head.current?.setAttribute("cx", String(b.head[0]));
      head.current?.setAttribute("cy", String(b.head[1]));
      props.current?.setAttribute("d", b.props);
      propsFill.current?.setAttribute("d", b.propsFill);
      if (ball.current && pose.props?.ball) {
        ball.current.setAttribute("cx", String(pose.props.ball.at[0]));
        ball.current.setAttribute("cy", String(pose.props.ball.at[1]));
        ball.current.setAttribute("opacity", String(pose.props.ball.o));
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [reduced, sport]);

  const ballPose = sport.pose(phase ?? STILL[archetype] ?? 0.12).props?.ball;
  return (
    <svg ref={svg} viewBox="0 0 100 100" className={className} role="img" aria-label={label ?? `${archetype} figure`}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path ref={props} d={still.props} stroke="currentColor" strokeWidth={2.6} opacity={0.55} />
        <path ref={propsFill} d={still.propsFill} fill="currentColor" stroke="none" opacity={0.85} />
        <path ref={far} d={still.far} stroke="currentColor" strokeWidth={6.5} opacity={0.42} />
        <path ref={near} d={still.near} stroke="currentColor" strokeWidth={7} />
        <circle ref={head} cx={still.head[0]} cy={still.head[1]} r={6.6} fill="currentColor" />
        {ballPose && <circle ref={ball} cx={ballPose.at[0]} cy={ballPose.at[1]} r={4.2} fill="currentColor" opacity={ballPose.o} />}
      </g>
    </svg>
  );
}
