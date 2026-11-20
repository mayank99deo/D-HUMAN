"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// How loud the voice is while the recogniser listens, for the Say card's ring
// (VoiceRing.tsx) and the small bars beside Ask's "Listening in …" line (VoiceMeter).
// Decorative only (aria-hidden): words on screen carry the meaning.
//
// Where the level comes from:
// - Real levels, from the microphone itself (getUserMedia and an AnalyserNode), only
//   where a second reader of the microphone is known not to disturb speech
//   recognition: Chromium on a desktop (navigator.userAgentData.mobile === false).
//   It opens only after the recogniser has the microphone (onaudiostart), only if
//   microphone permission is already granted (so there's never a second prompt),
//   and gives up after 1.2 s. If the recogniser ever reports a capture error while
//   it's open, it isn't used again on this page.
// - Everywhere else (Android, iPhone, Safari) and whenever that fails: the
//   recogniser's own events. Speech starting lifts the level, each new result gives
//   it a pulse, and speech ending lets it settle. Silence is flat: nothing moves
//   unless the browser says there's a voice.
// Recognition never waits on or depends on the meter.

type VoiceEvent = "audiostart" | "speechstart" | "speechend" | "result" | "end";

/** What the recogniser reports, for the meters to follow. One per listening control. */
export class VoiceActivity {
  private hasMic = false;
  private speaking = false;
  private pulse = 0;
  private open = false;

  note(kind: VoiceEvent) {
    if (kind === "audiostart") this.hasMic = true;
    else if (kind === "speechstart") this.speaking = true;
    else if (kind === "speechend") this.speaking = false;
    else if (kind === "result") {
      this.speaking = true;
      this.pulse = Math.min(1, this.pulse + 0.5);
    } else if (kind === "end") {
      this.hasMic = false;
      this.speaking = false;
    }
  }
  reset() {
    this.hasMic = false;
    this.speaking = false;
    this.pulse = 0;
  }
  micReady() {
    return this.hasMic;
  }
  /** Whether the browser last said someone is speaking (the reduced-motion ring's two lengths). */
  isSpeaking() {
    return this.speaking;
  }
  /** The level (0–1) when the meter can't hear the mic itself. Flat in silence. */
  level(t: number) {
    this.pulse *= 0.93;
    if (!this.speaking) return this.pulse * 0.4;
    return 0.38 + 0.18 * Math.sin(t / 210) * Math.sin(t / 370) + this.pulse * 0.45;
  }
  setOpen(open: boolean) {
    this.open = open;
  }
  /** A capture error while the meter had its own stream open: don't open one again. */
  captureFailed() {
    if (this.open) distrusted = true;
  }
}

let distrusted = false;

function canHearDirectly() {
  if (distrusted || typeof AudioContext === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  const ua = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return ua?.mobile === false;
}

async function micGranted() {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(motionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** Reduced motion, read after hydration (the server renders as if motion is fine). */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
}

const OPEN_BUDGET_MS = 1200;

/**
 * The level reader for a meter that's on screen while `active`: call `read.current(t)`
 * once a frame. It hears the mic directly where it safely can, else follows `activity`.
 * The mic stream closes when it's no longer active, the page is hidden, or it unmounts.
 */
export function useVoiceLevel(active: boolean, activity: VoiceActivity) {
  const read = useRef<(t: number) => number>((t) => activity.level(t));

  useEffect(() => {
    if (!active) {
      read.current = (t) => activity.level(t);
      return;
    }
    let stopped = false;
    let tried = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    const samples = new Uint8Array(512);

    const close = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      analyser = null;
      context?.close().catch(() => {});
      context = null;
      activity.setOpen(false);
    };

    async function hearDirectly() {
      if (!(await micGranted()) || stopped) return;
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), OPEN_BUDGET_MS));
      const opening = navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      const got = await Promise.race([opening, timeout]);
      if (!got || stopped || document.hidden) {
        // Too slow, refused, or no longer wanted: make sure a late stream is closed.
        opening.then((late) => late?.getTracks().forEach((t) => t.stop()));
        return;
      }
      stream = got;
      activity.setOpen(true);
      try {
        context = new AudioContext();
        await context.resume();
        if (stopped || context.state !== "running") return close();
        const node = context.createAnalyser();
        node.fftSize = samples.length;
        node.smoothingTimeConstant = 0.6;
        context.createMediaStreamSource(got).connect(node);
        analyser = node;
      } catch {
        close();
      }
    }

    read.current = (t) => {
      if (!tried && activity.micReady() && canHearDirectly()) {
        tried = true;
        void hearDirectly();
      }
      if (!analyser) return activity.level(t);
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / samples.length);
      // Room noise stays at zero, so silence is still.
      return Math.min(1, Math.max(0, (rms - 0.015) * 7));
    };

    const onHide = () => {
      if (document.hidden) close();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onHide);
      close();
      read.current = (t) => activity.level(t);
    };
  }, [active, activity]);

  return read;
}

const SHAPE = [0.55, 0.8, 1, 0.8, 0.55];
const STILL = [0.35, 0.6, 0.85, 0.6, 0.35];

/** Five small bars that move with the voice. With reduced motion they stand still. */
export function VoiceMeter({ active, activity }: { active: boolean; activity: VoiceActivity }) {
  const reduced = useReducedMotion();
  const bars = useRef<HTMLSpanElement>(null);
  const read = useVoiceLevel(active && !reduced, activity);

  useEffect(() => {
    const box = bars.current;
    if (!active || reduced || !box) return;
    const els = [...box.children] as HTMLElement[];
    let raf = 0;
    let level = 0;
    const frame = (t: number) => {
      // Ease toward the target, so the bars stay calm.
      level += (read.current(t) - level) * 0.22;
      els.forEach((el, i) => {
        const wobble = level > 0.02 ? 0.75 + 0.25 * Math.sin(t / 160 + i * 1.7) : 1;
        const h = Math.min(1, Math.max(0.12, level * SHAPE[i] * wobble * 1.6));
        el.style.transform = `scaleY(${h.toFixed(3)})`;
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced, read]);

  return (
    <span aria-hidden className="inline-flex h-4 items-center gap-1.5 text-paper">
      <MicGlyph className="h-4 w-4" />
      <span ref={bars} className="flex h-4 items-center gap-[2px]">
        {SHAPE.map((_, i) => (
          <span key={i} className="block h-4 w-[3px] origin-center bg-paper" style={{ transform: `scaleY(${active && reduced ? STILL[i] : 0.12})` }} />
        ))}
      </span>
    </span>
  );
}

/** The mic, drawn as a capsule on a stand. */
export function MicGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <rect x="5.25" y="1.5" width="5.5" height="8.5" rx="2.75" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
    </svg>
  );
}
