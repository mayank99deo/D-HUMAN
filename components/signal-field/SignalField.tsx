"use client";

import { useEffect, useRef } from "react";
import type { FieldMessage, FieldReply } from "./field.worker";
import { createFieldRenderer, type FieldController, type FieldOptions } from "./renderer";

export const PULSE_EVENT = "dhuman:pulse";
export type PulseDetail = { x: number; y: number };

type Props = {
  className?: string;
  seed?: number;
  /** Where the field is brightest, as fractions of the canvas (x from left, y from bottom). */
  focus?: [number, number];
};

export function SignalField({ className, seed = 0, focus = [0.7, 0.55] }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [focusX, focusY] = focus;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Start once the page has loaded, the browser is idle and the field is near the
    // screen, so it never competes with first paint; the closing section's field never
    // starts for visitors who don't scroll there.
    const hasIdle = typeof (window as { requestIdleCallback?: unknown }).requestIdleCallback === "function";
    let teardown: (() => void) | undefined;
    let idle: number | undefined;
    let near = false;

    const start = () => {
      idle = undefined;
      teardown ??= mountField(host, seed, [focusX, focusY]);
    };
    const schedule = () => {
      if (teardown || idle !== undefined || !near || document.readyState !== "complete") return;
      idle = hasIdle ? window.requestIdleCallback(start, { timeout: 2000 }) : window.setTimeout(start, 300);
    };
    const proximity = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        near = true;
        proximity.disconnect();
        schedule();
      },
      { rootMargin: "300px" },
    );
    proximity.observe(host);
    window.addEventListener("load", schedule);

    return () => {
      proximity.disconnect();
      window.removeEventListener("load", schedule);
      if (idle !== undefined) {
        if (hasIdle) window.cancelIdleCallback(idle);
        else window.clearTimeout(idle);
      }
      teardown?.();
    };
  }, [seed, focusX, focusY]);

  return <div ref={hostRef} aria-hidden="true" className={className} />;
}

// Forwards renderer calls to the worker as messages.
function workerController(worker: Worker): FieldController {
  const send = (message: FieldMessage) => worker.postMessage(message);
  return {
    resize: (width, height, dpr) => send({ type: "resize", width, height, dpr }),
    setVisible: (value) => send({ type: "visible", value }),
    setHidden: (value) => send({ type: "hidden", value }),
    setReducedMotion: (value) => send({ type: "reducedMotion", value }),
    pointer: (x, y) => send({ type: "pointer", x, y }),
    pulse: (x, y) => send({ type: "pulse", x, y }),
    dispose: () => {
      send({ type: "dispose" });
      worker.terminate();
    },
  };
}

// Puts a fresh canvas in `host` and draws the field until the returned function is called.
// A canvas can only be handed to a worker once, so each start gets a new one.
function mountField(host: HTMLDivElement, seed: number, focus: [number, number]) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let field: FieldController | null = null;
  let canvas: HTMLCanvasElement;
  let visible = false;
  let disposed = false;

  const newCanvas = () => {
    const c = document.createElement("canvas");
    c.style.display = "block";
    c.style.width = "100%";
    c.style.height = "100%";
    host.replaceChildren(c);
    return c;
  };
  const options = (): FieldOptions => {
    const rect = host.getBoundingClientRect();
    return {
      seed,
      focus,
      width: rect.width,
      height: rect.height,
      dpr: window.devicePixelRatio || 1,
      reducedMotion: reducedMotion.matches,
    };
  };
  // Without WebGL the section stays plain black.
  const hide = () => {
    canvas.style.visibility = "hidden";
  };
  const sync = () => {
    field?.setHidden(document.hidden);
    field?.setVisible(visible);
  };

  const onMainThread = () => {
    if (disposed) return;
    field?.dispose();
    canvas = newCanvas();
    field = createFieldRenderer(canvas, options(), hide);
    if (field) sync();
    else hide();
  };

  canvas = newCanvas();
  const canTransfer =
    typeof Worker === "function" &&
    typeof (canvas as { transferControlToOffscreen?: unknown }).transferControlToOffscreen === "function";
  if (canTransfer) {
    try {
      const worker = new Worker(new URL("./field.worker.ts", import.meta.url), { type: "module" });
      // Some browsers (e.g. Safari 16.4) have OffscreenCanvas but no WebGL in workers.
      worker.onmessage = (event: MessageEvent<FieldReply>) => {
        if (event.data.type === "unavailable") onMainThread();
      };
      worker.onerror = onMainThread;
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: "init", canvas: offscreen, ...options() } satisfies FieldMessage, [offscreen]);
      field = workerController(worker);
      sync();
    } catch {
      onMainThread();
    }
  } else {
    onMainThread();
  }

  const resizeObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    field?.resize(width, height, window.devicePixelRatio || 1);
  });
  resizeObserver.observe(host);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    field?.setVisible(visible);
  });
  intersection.observe(host);

  const local = (clientX: number, clientY: number) => {
    const rect = host.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top] as const;
  };
  const onPointer = (event: PointerEvent) => {
    if (!visible || event.pointerType === "touch") return;
    field?.pointer(...local(event.clientX, event.clientY));
  };
  const onPulse = (event: Event) => {
    const { x, y } = (event as CustomEvent<PulseDetail>).detail;
    field?.pulse(...local(x, y));
  };
  const onVisibility = () => field?.setHidden(document.hidden);
  const onMotion = () => field?.setReducedMotion(reducedMotion.matches);

  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener(PULSE_EVENT, onPulse);
  document.addEventListener("visibilitychange", onVisibility);
  reducedMotion.addEventListener("change", onMotion);

  return () => {
    disposed = true;
    resizeObserver.disconnect();
    intersection.disconnect();
    window.removeEventListener("pointermove", onPointer);
    window.removeEventListener(PULSE_EVENT, onPulse);
    document.removeEventListener("visibilitychange", onVisibility);
    reducedMotion.removeEventListener("change", onMotion);
    field?.dispose();
    host.replaceChildren();
  };
}

export function sendPulse(from: Element) {
  const rect = from.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent<PulseDetail>(PULSE_EVENT, {
      detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    }),
  );
}
