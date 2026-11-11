// When a spoken meal logs itself. Pure (no React, no timers), so the timing can be
// tested in Node; FuelLogger feeds it the recogniser's events and a clock tick.
//
// After at least one final result with words, a pause starts a short countdown:
// about 2 s with no new words, or the recogniser saying speech ended, or stopping by
// itself. When the countdown runs out the meal is logged. New words during the
// countdown cancel it and listening carries on. Typing in the box, Edit, Stop,
// Cancel, an error or leaving the page disarm it until the person talks again.
// Once logging, nothing else can start a second log.

export const PAUSE_MS = 2000;
export const COUNTDOWN_MS = 2000;

export type AutoLog =
  | { kind: "idle" }
  | { kind: "listening"; heard: boolean; lastAt: number; words: string }
  | { kind: "counting"; endsAt: number; left: number; words: string }
  | { kind: "logging" };

export type AutoEvent =
  /** Listening began (or began again); `words` is what's in the box already. */
  | { type: "start"; at: number; words: string }
  /** A new transcript. `words` is the whole box; `spoke` is whether this session heard any words. */
  | { type: "result"; at: number; final: boolean; spoke: boolean; words: string }
  | { type: "speechend"; at: number }
  /** The recogniser stopped by itself (Chrome does after a silence). */
  | { type: "ended"; at: number }
  | { type: "tick"; at: number }
  /** The person took over: typed, tapped Edit, Stop or Cancel; or an error, or the page was hidden. */
  | { type: "hold" }
  /** A log started, by hand or by the countdown. */
  | { type: "submit" }
  /** That log finished, either way. */
  | { type: "done" };

/** Whether a meal may log itself at all: voice mode, a meal log left today, food reading on. */
export type AutoContext = { allowed: boolean };

export const IDLE: AutoLog = { kind: "idle" };

// Words compared without case, punctuation or extra spaces, so the recogniser
// tidying its last phrase ("roti aur dal" to "Roti aur dal.") isn't new talking.
export const sameWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function arm(s: Extract<AutoLog, { kind: "listening" }>, at: number, ctx: AutoContext): AutoLog | null {
  if (!ctx.allowed || !s.heard || !s.words) return null;
  return { kind: "counting", endsAt: at + COUNTDOWN_MS, left: Math.ceil(COUNTDOWN_MS / 1000), words: s.words };
}

export function stepAutoLog(s: AutoLog, e: AutoEvent, ctx: AutoContext): AutoLog {
  if (s.kind === "logging") return e.type === "done" ? IDLE : s;
  switch (e.type) {
    case "start":
      return { kind: "listening", heard: false, lastAt: e.at, words: sameWords(e.words) };
    case "hold":
    case "done":
      return s.kind === "idle" ? s : IDLE;
    case "submit":
      return { kind: "logging" };
    case "result": {
      const words = sameWords(e.words);
      if (s.kind === "listening") return { kind: "listening", heard: s.heard || (e.final && e.spoke), lastAt: e.at, words };
      // More words during the countdown: they're still talking.
      if (s.kind === "counting" && words !== s.words) return { kind: "listening", heard: true, lastAt: e.at, words };
      return s;
    }
    case "speechend":
      return s.kind === "listening" ? (arm(s, e.at, ctx) ?? s) : s;
    case "ended":
      // Counting carries on after the recogniser stops; listening either counts down or stops.
      return s.kind === "listening" ? (arm(s, e.at, ctx) ?? IDLE) : s;
    case "tick":
      if (s.kind === "listening") return e.at - s.lastAt >= PAUSE_MS ? (arm(s, e.at, ctx) ?? s) : s;
      if (s.kind === "counting") {
        if (e.at >= s.endsAt) return { kind: "logging" };
        const left = Math.ceil((s.endsAt - e.at) / 1000);
        return left === s.left ? s : { ...s, left };
      }
      return s;
  }
}
