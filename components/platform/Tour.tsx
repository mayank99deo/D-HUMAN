"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { send } from "./net";
import { FREE_LINE, TOUR, cardWidth, placeTour, scrimClip, type Box } from "./tour-stops";

// A quick walk round the app for someone who has just finished onboarding: the
// screen dims and a light moves from tab to tab. Shown once per person (the server
// keeps profiles.tour_done_at, so once holds across devices). Finishing or skipping
// it hides it at once and is remembered in this browser too, so a failed request
// never brings it back here. Settings can replay it, which changes nothing stored.

const REPLAY_EVENT = "dh:replay-tour";
const OPEN_AFTER_MS = 700; // let the page land first, then dim it
const storageKey = (who: string) => `dh-tour-done:${who}`;

function seenHere(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function rememberHere(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* private mode or blocked storage: the server's copy still holds */
  }
}

type Outcome = "finished" | "skipped";
const markDone = (body: { outcome?: Outcome; stop?: number }) => send("/api/profile/tour", { body, keepalive: true });

/** Mounted on every app page for onboarded people; `pending` is true until the server has it as done. */
export function Tour({ who, pending, name }: { who: string; pending: boolean; name: string }) {
  const [run, setRun] = useState<{ replay: boolean } | null>(null);
  const [stop, setStop] = useState(0);
  // Once per page life, whatever a refresh of the layout says afterwards.
  const opened = useRef(false);

  useEffect(() => {
    if (!pending || opened.current) return;
    const key = storageKey(who);
    if (seenHere(key)) {
      // Done in this browser, but the server never heard: tell it again, quietly.
      void markDone({});
      return;
    }
    // Browsers without <dialog> (Safari before 15.4) simply don't get the tour.
    if (typeof HTMLDialogElement === "undefined" || !("showModal" in HTMLDialogElement.prototype)) return;
    const t = setTimeout(() => {
      opened.current = true;
      setStop(0);
      setRun({ replay: false });
    }, OPEN_AFTER_MS);
    return () => clearTimeout(t);
  }, [pending, who]);

  useEffect(() => {
    const replay = () => {
      opened.current = true;
      setStop(0);
      setRun({ replay: true });
    };
    window.addEventListener(REPLAY_EVENT, replay);
    return () => window.removeEventListener(REPLAY_EVENT, replay);
  }, []);

  if (!run) return null;

  const end = (outcome: Outcome) => {
    if (!run.replay) {
      rememberHere(storageKey(who));
      void markDone({ outcome, stop: stop + 1 });
    }
    setRun(null);
  };
  const lead = !run.replay && stop === 0 ? `Welcome${name ? `, ${name}` : ""}. A quick look round: ${TOUR.length} stops, skip any time.` : null;
  return <TourDialog stop={stop} setStop={setStop} lead={lead} replay={run.replay} onEnd={end} />;
}

/** For Settings: walks through the tour again. Nothing is saved. */
export function ReplayTour({ className = "" }: { className?: string }) {
  return (
    <button type="button" className={`link-quiet min-h-11 text-sm ${className}`} onClick={() => window.dispatchEvent(new Event(REPLAY_EVENT))}>
      Replay the app tour
    </button>
  );
}

function setBox(el: HTMLElement | null, b: Box | null) {
  if (!el) return;
  if (!b) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  el.style.top = `${b.top}px`;
  el.style.left = `${b.left}px`;
  el.style.width = `${b.width}px`;
  el.style.height = `${b.height}px`;
}

function TourDialog({
  stop,
  setStop,
  lead,
  replay,
  onEnd,
}: {
  stop: number;
  setStop: (n: number) => void;
  lead: string | null;
  replay: boolean;
  onEnd: (outcome: Outcome) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const leader = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const ended = useRef(false);
  const describedBy = useId();
  const s = TOUR[stop];
  const last = stop === TOUR.length - 1;

  const finish = (outcome: Outcome) => {
    if (ended.current) return;
    ended.current = true;
    onEnd(outcome);
  };

  // Light the target and put the card beside it. Written to the DOM directly, so
  // moving between stops is a CSS transition and nothing render-time reads the window.
  const place = useCallback(() => {
    const d = dialog.current;
    const c = card.current;
    if (!d || !c || !d.open) return;
    const view = { width: d.clientWidth, height: d.clientHeight };
    c.style.width = `${cardWidth(view.width)}px`;
    const r = document.querySelector(`[data-tour="${TOUR[stop].id}"]`)?.getBoundingClientRect();
    const p = placeTour(r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null, c.offsetHeight, view);
    c.style.top = `${p.card.top}px`;
    c.style.left = `${p.card.left}px`;
    if (scrim.current) scrim.current.style.clipPath = scrimClip(p.hole, view);
    setBox(ring.current, p.hole);
    setBox(leader.current, p.leader);
  }, [stop]);

  // Open as a modal: the rest of the page goes inert, and focus goes back where it was afterwards.
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    // The browser focuses the first control, Skip tour; start on Next so a quick Enter moves on.
    primary.current?.focus({ preventScroll: true });
    // Transitions switch on only after the first placement, so the light doesn't fly in from a corner.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => d.setAttribute("data-placed", ""));
    });
    return () => {
      cancelAnimationFrame(raf);
      // Close first: while it's modal the page behind is inert and can't take focus back.
      if (d.open) d.close();
      if (before && before !== document.body && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    place();
    // Back and the last step swap buttons out; keep focus on the main action.
    if (!card.current?.contains(document.activeElement)) primary.current?.focus({ preventScroll: true });
  }, [place]);

  useEffect(() => {
    let raf = 0;
    const again = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener("resize", again);
    window.visualViewport?.addEventListener("resize", again);
    window.addEventListener("scroll", again, { passive: true, capture: true });
    const ro = new ResizeObserver(again);
    if (card.current) ro.observe(card.current);
    void document.fonts?.ready.then(again);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", again);
      window.visualViewport?.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, { capture: true });
      ro.disconnect();
    };
  }, [place]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" && !last) {
      e.preventDefault();
      setStop(stop + 1);
    } else if (e.key === "ArrowLeft" && stop > 0) {
      e.preventDefault();
      setStop(stop - 1);
    } else if (e.key === "Tab" && card.current) {
      // Keep Tab inside the card rather than wandering out to the browser's own controls.
      const items = [...card.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      if (!items.length) return;
      const first = items[0];
      const end = items[items.length - 1];
      const inside = card.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        end.focus();
      } else if (!e.shiftKey && (document.activeElement === end || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Quick tour"
      aria-describedby={describedBy}
      onCancel={(e) => {
        // Esc (and Android's back gesture) skips the whole tour.
        e.preventDefault();
        finish("skipped");
      }}
      // The browser closed it (Android's back gesture). A close event that arrives while
      // it's open again is Strict Mode's rehearsal closing and reopening it: ignore that.
      onClose={() => {
        if (!dialog.current?.open) finish("skipped");
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 size-auto max-h-none max-w-none overflow-hidden border-0 bg-transparent p-0 text-paper outline-none backdrop:bg-transparent"
    >
      <div ref={scrim} aria-hidden className="tour-in tour-move absolute inset-0 bg-ink/80" />
      <div ref={ring} aria-hidden className="tour-in tour-move pointer-events-none absolute border border-paper" />
      <div ref={leader} aria-hidden className="tour-in tour-move pointer-events-none absolute bg-paper" />

      <div ref={card} className="tour-in tour-move absolute max-h-[calc(100dvh-2rem)] overflow-y-auto border border-paper bg-ink px-5 pb-5 pt-4">
        <div className="flex gap-1" aria-hidden>
          {TOUR.map((t, j) => (
            <span key={t.id} className={`h-0.5 flex-1 ${j <= stop ? "bg-paper" : "bg-line-strong"}`} />
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-sm text-graphite" aria-hidden>
            {stop + 1} of {TOUR.length}
          </span>
          <button type="button" className="link-quiet -mr-2 min-h-11 px-2 text-sm" onClick={() => finish(last ? "finished" : "skipped")}>
            {last ? "Done" : "Skip tour"}
          </button>
        </div>

        {/* Stable live region; only its inside changes, so each stop is read out. */}
        <div id={describedBy} aria-live="polite" aria-atomic="true">
          <div key={stop} className="fact-in">
            <p className="sr-only">
              Stop {stop + 1} of {TOUR.length}.
            </p>
            {lead && <p className="mb-2 text-[0.9375rem]">{lead}</p>}
            <h2 className="text-xl font-bold leading-tight semiwide">{s.title}</h2>
            <p className="mt-2 text-[0.9375rem] leading-snug text-graphite">{s.body}</p>
            {last && <p className="mt-3 text-[0.9375rem] font-semibold">{FREE_LINE}</p>}
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          {stop > 0 && (
            <button type="button" onClick={() => setStop(stop - 1)} className="button-ghost h-12 px-4">
              Back
            </button>
          )}
          {last ? (
            <Link ref={primary} href="/fuel#log" onClick={() => finish("finished")} className="button-primary h-12 flex-1 px-4">
              {replay ? "Log a meal" : "Log your first meal"}
            </Link>
          ) : (
            <button ref={primary} type="button" onClick={() => setStop(stop + 1)} className="button-primary h-12 flex-1 px-4">
              Next
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
