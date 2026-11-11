// The first-run tour: its stops and where the card sits beside each one.
// Pure, so the copy and the layout maths can be tested without a browser.
import { PLAN } from "@/lib/domain/plan";

/** Each stop points at a real control, marked data-tour="<id>" in Nav.tsx. */
export type TourStop = { id: "fuel" | "upload" | "home" | "stack" | "wraps" | "settings"; title: string; body: string };

// The pilot leads with calorie tracking, so Fuel comes first. Every claim here is
// checked against the screen it describes; keep them in step when screens change.
export const TOUR: readonly TourStop[] = [
  {
    id: "fuel",
    title: "Fuel: log what you eat",
    body: "Snap a photo, say it or type it. AI estimates the calories and protein in Indian portions, like a katori of dal or two rotis.",
  },
  {
    id: "upload",
    title: "Upload a blood report",
    body: "A PDF or photos of the pages. AI reads every marker and weighs it for how you train. It's a read, not a diagnosis. Booking a blood test through D-Human is coming soon.",
  },
  {
    id: "home",
    title: "Home: where you stand",
    body: "Once a report is read, Home shows your verdict and the markers that matter for how you train. Today's fuel sits right under it.",
  },
  {
    id: "stack",
    title: "Stack: only what your markers point to",
    body: "A supplement shows up only where a marker or a repeated food gap points to it, with food first. We don't partner with any brand.",
  },
  {
    id: "wraps",
    title: "Wraps: your weeks in review",
    body: "Your week, month and year: what you ate, what moved and the one thing to do next. Tap through them like stories.",
  },
  {
    id: "settings",
    title: "Reads in your language",
    body: "Report reads, food notes, wraps and your stack come in English, Hindi or Hinglish. Change it any time here, in Settings. Buttons stay in English for now.",
  },
];

/** Said once, on the last stop, from the plan's own numbers. */
export const FREE_LINE = `Free to start: ${PLAN.freeMeals} meal logs and ${PLAN.freeReads} report reads.`;

export type Box = { top: number; left: number; width: number; height: number };
export type Side = "above" | "below" | "right" | "center";
export type Placement = {
  /** The lit area around the target, or null when there's nothing to point at. */
  hole: Box | null;
  card: { top: number; left: number; width: number };
  side: Side;
  /** A hairline from the card to the lit area. */
  leader: Box | null;
};

export const GUTTER = 16;
const PAD = 4; // light around the target
const GAP = 14; // between the lit area and the card
const CARD_MAX = 380;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const round = (b: Box): Box => ({ top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) });

export const cardWidth = (viewWidth: number) => Math.max(0, Math.min(CARD_MAX, viewWidth - 2 * GUTTER));

/**
 * Where the card goes for a target. The phone's tab bar sits at the bottom, so the
 * card goes above it; the desktop rail sits at the left, so it goes to the right;
 * the settings button sits at the top, so it goes below.
 */
export function placeTour(target: Box | null, cardHeight: number, view: { width: number; height: number }): Placement {
  const width = cardWidth(view.width);
  const centred = (): Placement => ({
    hole: null,
    card: { top: Math.round(Math.max(GUTTER, (view.height - cardHeight) / 2)), left: Math.round((view.width - width) / 2), width },
    side: "center",
    leader: null,
  });
  if (!target || target.width <= 0 || target.height <= 0) return centred();

  const top = Math.max(0, target.top - PAD);
  const left = Math.max(0, target.left - PAD);
  const hole = round({
    top,
    left,
    width: Math.min(view.width, target.left + target.width + PAD) - left,
    height: Math.min(view.height, target.top + target.height + PAD) - top,
  });
  // Off screen (a scrolled-away target): no light, card in the middle.
  if (hole.width <= 0 || hole.height <= 0 || hole.top >= view.height || hole.left >= view.width) return centred();

  const cx = hole.left + hole.width / 2;
  const cy = hole.top + hole.height / 2;
  const right = hole.left + hole.width;
  const bottom = hole.top + hole.height;

  if (right < view.width * 0.2 && right + GAP + width + GUTTER <= view.width) {
    const cardTop = clamp(cy - cardHeight / 2, GUTTER, view.height - GUTTER - cardHeight);
    return {
      hole,
      card: { top: Math.round(cardTop), left: Math.round(right + GAP), width },
      side: "right",
      leader: round({ top: cy, left: right, width: GAP, height: 1 }),
    };
  }

  const cardLeft = clamp(cx - width / 2, GUTTER, view.width - GUTTER - width);
  if (cy > view.height / 2) {
    const cardTop = Math.max(GUTTER, hole.top - GAP - cardHeight);
    return {
      hole,
      card: { top: Math.round(cardTop), left: Math.round(cardLeft), width },
      side: "above",
      leader: round({ top: cardTop + cardHeight, left: cx, width: 1, height: Math.max(0, hole.top - cardTop - cardHeight) }),
    };
  }
  const cardTop = bottom + GAP;
  return {
    hole,
    card: { top: Math.round(cardTop), left: Math.round(cardLeft), width },
    side: "below",
    leader: round({ top: bottom, left: cx, width: 1, height: GAP }),
  };
}

/** The dimmed screen with the lit area cut out, as a clip-path that animates between stops. */
export function scrimClip(hole: Box | null, view: { width: number; height: number }) {
  const W = view.width;
  const H = view.height;
  // No hole: a zero-size one in the middle keeps the same ten points, so it still animates.
  const h = hole ?? { top: H / 2, left: W / 2, width: 0, height: 0 };
  const L = h.left;
  const R = h.left + h.width;
  const T = h.top;
  const B = h.top + h.height;
  const pts = [
    [0, 0], [0, H], [L, H], [L, T], [R, T], [R, B], [L, B], [L, H], [W, H], [W, 0],
  ];
  return `polygon(${pts.map(([x, y]) => `${Math.round(x)}px ${Math.round(y)}px`).join(", ")})`;
}
