"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// A small mic with five bars that move with the voice while Fuel is listening.
// Decorative only (aria-hidden): the "Listening in …" text carries the meaning.
//
// Where the bars get their movement:
// - Real levels, from the microphone itself (getUserMedia and an AnalyserNode), only
//   where a second reader of the microphone is known not to disturb speech
//   recognition: Chromium on a desktop (navigator.userAgentData.mobile === false).
//   It opens only after the recogniser has the microphone (onaudiostart), only if
//   microphone permission is already granted (so there's never a second prompt),
//   and gives up after 1.2 s. If the recogniser ever reports a capture error while
//   it's open, it isn't used again on this page.
// - Everywhere else (Android, iPhone, Safari) and whenever that fails: the
//   recogniser's own events. Sound or speech starting lifts the bars, each new
//   result gives them a pulse, and speech ending lets them settle.
// Recognition never waits on or depends on the meter.
// With reduced motion the bars stand still.

type VoiceEvent = "audiostart" | "speechstart" | "speechend" | "result" | "end";

/** What the recogniser reports, for the bars to follow. FuelLogger owns one per page. */
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
  /** The level the bars aim for (0–1) when the meter can't hear the mic itself. */
  level(t: number) {
    this.pulse *= 0.93;
    if (!this.speaking) return 0.1 + 0.04 * Math.sin(t / 600) + this.pulse * 0.4;
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

const SHAPE = [0.55, 0.8, 1, 0.8, 0.55];
const STILL = [0.35, 0.6, 0.85, 0.6, 0.35];
const OPEN_BUDGET_MS = 1200;

export function VoiceMeter({ active, activity }: { active: boolean; activity: VoiceActivity }) {
  const reduced = useReducedMotion();
  const bars = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const box = bars.current;
    if (!active || reduced || !box) return;
    const els = [...box.children] as HTMLElement[];
    let raf = 0;
    let level = 0;
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

    const frame = (t: number) => {
      if (!tried && activity.micReady() && canHearDirectly()) {
        tried = true;
        void hearDirectly();
      }
      let target: number;
      if (analyser) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / samples.length);
        target = Math.min(1, Math.max(0.08, (rms - 0.01) * 7));
      } else target = activity.level(t);
      // Ease toward the target, so the bars stay calm.
      level += (target - level) * 0.22;
      els.forEach((el, i) => {
        const wobble = 0.75 + 0.25 * Math.sin(t / 160 + i * 1.7);
        const h = Math.min(1, Math.max(0.12, level * SHAPE[i] * wobble * 1.6));
        el.style.transform = `scaleY(${h.toFixed(3)})`;
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onHide = () => {
      if (document.hidden) close();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onHide);
      close();
    };
  }, [active, reduced, activity]);

  return (
    <span aria-hidden className="inline-flex h-4 items-center gap-1.5 text-paper">
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="5.25" y="1.5" width="5.5" height="8.5" rx="2.75" />
        <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
      </svg>
      <span ref={bars} className="flex h-4 items-center gap-[2px]">
        {SHAPE.map((_, i) => (
          <span key={i} className="block h-4 w-[3px] origin-center bg-paper" style={{ transform: `scaleY(${active && reduced ? STILL[i] : 0.12})` }} />
        ))}
      </span>
    </span>
  );
}
