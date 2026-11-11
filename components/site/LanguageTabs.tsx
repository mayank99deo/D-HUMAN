"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

export type LanguageTab = { id: string; label: string; lang?: string; style?: CSSProperties };

// Colours for a black slide or a white one. Full strings, so Tailwind sees every class.
const TONES = {
  ink: { on: "text-paper", off: "text-graphite hover:text-paper", track: "bg-line", fill: "bg-paper" },
  paper: { on: "text-ink", off: "text-smoke hover:text-ink", track: "bg-rule", fill: "bg-ink" },
};

// Tabs that cycle the example meal card through languages. The card itself is
// server-rendered children: every language is in the HTML, stacked in one grid
// cell (so the tallest sets the height and nothing shifts), and each layer shows
// itself with `group-data-[active=N]/rot:` variants. This component only keeps
// the active index and the tabs.
//
// Timing lives in CSS: the active tab's fill runs `wrap-fill` (app/globals.css)
// for 3.5 s and its animationend moves on. So hover and keyboard focus pause it
// (animation-play-state), reduced motion never runs it (no animationend, no
// rotation), and it only runs while the card is on screen and the tab visible.
// A tap or arrow key picks a language and stops the rotation for good.
export function LanguageTabs({
  tabs,
  idBase,
  label,
  tone = "ink",
  children,
}: {
  tabs: LanguageTab[];
  idBase: string;
  label: string;
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  const c = TONES[tone];
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageShown, setPageShown] = useState(true);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    const onVisibility = () => setPageShown(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const running = inView && pageShown && !picked;

  function pick(i: number, focus = false) {
    setPicked(true);
    setActive(i);
    if (focus) buttons.current[i]?.focus();
  }

  function onKeyDown(e: KeyboardEvent, i: number) {
    const n = tabs.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    pick(to, true);
  }

  return (
    <div ref={root} data-active={active} className="group/rot">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-x-4 sm:gap-x-6">
        {tabs.map((t, i) => {
          const on = i === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              id={`${idBase}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`${idBase}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`relative min-h-11 pt-3 text-sm font-semibold transition-colors active:opacity-60 ${
                on ? c.on : c.off
              }`}
            >
              <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-0.5 ${c.track}`}>
                {on &&
                  (running ? (
                    <span
                      onAnimationEnd={() => setActive((a) => (a + 1) % tabs.length)}
                      className={`absolute inset-y-0 left-0 w-0 animate-[wrap-fill_3500ms_linear_both] ${c.fill} group-focus-within/rot:[animation-play-state:paused] group-hover/rot:[animation-play-state:paused] motion-reduce:w-full motion-reduce:animate-none`}
                    />
                  ) : (
                    <span className={`absolute inset-0 ${c.fill}`} />
                  ))}
              </span>
              <span lang={t.lang} style={t.style}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
      {/* Auto changes stay quiet for screen readers; a picked language is announced. */}
      <div
        role="tabpanel"
        id={`${idBase}-panel`}
        aria-labelledby={`${idBase}-tab-${tabs[active].id}`}
        aria-live={picked ? "polite" : "off"}
        className="mt-3"
      >
        {children}
      </div>
    </div>
  );
}
