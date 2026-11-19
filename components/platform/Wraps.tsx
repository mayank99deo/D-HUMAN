"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { OFFLINE, send } from "./net";
import { Stall } from "./Stall";

type Card = { kind: string; big: string; label: string; line: string };
type Story = { id: string; title: string; cards: Card[]; oneThing: string; demo: boolean; made: string };
export type PeriodCard = {
  key: string;
  period: "week" | "month" | "year";
  offset: number;
  name: string;
  label: string;
  ongoing: boolean;
  hasData: boolean;
  wrap: Story | null;
};
/** The week a link asked for (/wraps?week=…): its card, and Monday to Sunday, which days have meals. */
export type WeekLink = { key: string; days: boolean[] };

// Each card kind gets a faint wash from the blood palette; "next" is printed on paper.
const WASH: Record<string, string> = {
  stat: "radial-gradient(90% 70% at 80% 10%, rgb(181 210 192 / 0.22), transparent 65%)",
  streak: "radial-gradient(90% 70% at 20% 90%, rgb(226 211 162 / 0.22), transparent 65%)",
  food: "radial-gradient(90% 70% at 80% 90%, rgb(226 211 162 / 0.16), transparent 65%)",
  gap: "radial-gradient(90% 70% at 20% 10%, rgb(227 165 162 / 0.24), transparent 65%)",
  marker: "radial-gradient(90% 70% at 50% 0%, rgb(181 210 192 / 0.18), transparent 65%)",
  win: "radial-gradient(90% 70% at 50% 100%, rgb(181 210 192 / 0.24), transparent 65%)",
};

type ViewerProps = {
  story: Story;
  onClose: () => void;
  /** Reached the last card ("One thing"). */
  onFinish: (id: string) => void;
  /** For a period still running: remake the wrap with what's been logged since. */
  onUpdate?: () => void;
  updating: boolean;
  error: string | null;
};

function Viewer({ story, onClose, onFinish, onUpdate, updating, error }: ViewerProps) {
  const slides: Card[] = [{ kind: "title", big: story.title, label: "", line: "" }, ...story.cards, { kind: "next", big: "One thing", label: "", line: story.oneThing }];
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const next = useCallback(() => setI((x) => (x + 1 < slides.length ? x + 1 : x)), [slides.length]);
  const prev = () => setI((x) => Math.max(0, x - 1));
  const last = i === slides.length - 1;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (paused || reduce || last) return;
    const t = setTimeout(next, 5200);
    return () => clearTimeout(t);
  }, [i, paused, next, last]);

  useEffect(() => {
    if (last) onFinish(story.id);
  }, [last, onFinish, story.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === " ") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [next, onClose]);

  const s = slides[i];
  const paper = s.kind === "next";
  const quiet = paper ? "text-smoke" : "text-graphite";
  return (
    <div role="dialog" aria-modal aria-label={story.title} className={`fixed inset-0 z-50 flex flex-col ${paper ? "paper" : "bg-ink"}`} style={{ backgroundImage: paper ? undefined : WASH[s.kind] }}>
      <div className="mx-auto flex w-full max-w-xl gap-1 px-4 pt-[max(1rem,env(safe-area-inset-top))]" aria-hidden>
        {slides.map((_, j) => (
          <div key={j} className={`h-0.5 flex-1 ${paper ? "bg-ink/20" : "bg-paper/20"}`}>
            <div className={`h-0.5 ${paper ? "bg-ink" : "bg-paper"} ${j === i && !paused ? "wrap-fill" : ""}`} style={{ width: j < i ? "100%" : j === i ? undefined : "0%" }} />
          </div>
        ))}
      </div>
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 pt-2">
        <span className={`text-sm ${quiet}`}>
          {i + 1} of {slides.length}
          {story.demo ? ", demo" : ""}
        </span>
        <div className="flex items-center gap-1">
          {onUpdate && (
            <button type="button" onClick={onUpdate} disabled={updating} className={`min-h-11 px-2 text-sm underline underline-offset-[3px] ${quiet}`}>
              {updating ? "Updating…" : "Update with latest"}
            </button>
          )}
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm font-semibold">
            Close
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-mark mx-auto w-full max-w-xl px-4 text-sm">
          {error}
        </p>
      )}

      <div
        className="relative mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 pb-16 short:pb-6"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerCancel={() => setPaused(false)}
      >
        <div key={i} className="fact-in">
          {s.kind === "title" ? (
            <p className="verdict-type text-[clamp(2.25rem,min(11vw,15svh),5rem)]">{s.big}</p>
          ) : (
            <>
              {s.label && <p className={`text-lg font-semibold ${quiet}`}>{s.label}</p>}
              {/* Bounded by height too, so a phone turned sideways still fits the whole slide. */}
              <p className={`mt-2 display-num ${s.big.length > 8 ? "text-[clamp(2.5rem,min(13vw,18svh),5.5rem)]" : "text-[clamp(3.5rem,min(26vw,30svh),10rem)]"}`}>{s.big}</p>
              <p className="mt-6 max-w-md text-xl leading-snug short:mt-3 short:text-lg">{s.line}</p>
            </>
          )}
        </div>
        <button type="button" aria-label="Previous" onClick={prev} className="absolute inset-y-0 left-0 w-1/3" />
        <button type="button" aria-label="Next" onClick={last ? onClose : next} className="absolute inset-y-0 right-0 w-2/3" />
      </div>
    </div>
  );
}

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

// While a linked week's wrap is made: the week as seven squares, filling in left to right
// (white: a day with meals; outlined: none, never red). The one moment of motion on this
// screen; with reduced motion the squares simply show.
function Wrapping({ label, days, onClose }: { label: string; days: boolean[]; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal aria-label={`Wrapping ${label}`} className="fixed inset-0 z-50 flex flex-col bg-ink">
      <div className="mx-auto flex w-full max-w-xl justify-end px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm font-semibold">
          Close
        </button>
      </div>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 pb-16 short:pb-6">
        <p role="status" className="verdict-type text-[clamp(2rem,min(9vw,12svh),3.5rem)]">
          Wrapping {label}…
        </p>
        <div className="mt-8 grid max-w-sm grid-cols-7 gap-1.5 short:mt-4" aria-hidden>
          {DAY_LETTERS.map((letter, n) => (
            <div key={n} className="fact-in" style={{ animationDelay: `${n * 140}ms` }}>
              <p className="text-center text-xs text-graphite">{letter}</p>
              <div className={`mt-1.5 aspect-square ${days[n] ? "bg-paper" : "border border-line-strong"}`} />
            </div>
          ))}
        </div>
        <Stall after={8000} />
      </div>
    </div>
  );
}

const ERRORS: Record<string, string> = {
  ai_off: "Wraps aren't switched on yet on this server.",
  rate_limited: "That's a lot of wraps in an hour. Try again a bit later.",
};

const thatPeriod = (p: PeriodCard["period"]) => (p === "week" ? "that week" : p === "month" ? "that month" : "that year");
// Meals always log to today, so only a period still running can be filled in.
const nothingYet = (c: PeriodCard) => (c.ongoing ? `Nothing logged for ${c.name.toLowerCase()} yet. Log a few meals first.` : `Nothing logged ${thatPeriod(c.period)}.`);

/**
 * A wrap being made for card `key`. It counts as arrived once the page's own data carries
 * a wrap for that card made after `after` (null: any), so the screen never shows the old
 * story as the new one, and never drops back while the refreshed data is on its way.
 * `open`: play it when it arrives.
 */
type Making = { key: string; after: string | null; open: boolean };

export function WrapsClient({ cards, firstName, aiOff, link = null }: { cards: PeriodCard[]; firstName: string; aiOff: boolean; link?: WeekLink | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Opened from a link (/wraps?week=…): a made wrap plays at once; one with meals behind it
  // is made first, behind the "Wrapping…" screen.
  const [linked] = useState(() => (link ? (cards.find((c) => c.key === link.key) ?? null) : null));
  const [autoMake] = useState(() => (linked && !linked.wrap && linked.hasData && !aiOff ? linked : null));
  const [openKey, setOpenKey] = useState<string | null>(linked?.wrap ? linked.key : null);
  const [making, setMaking] = useState<Making | null>(autoMake ? { key: autoMake.key, after: null, open: true } : null);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(new Set<string>());
  const started = useRef(false);

  const makingCard = making ? cards.find((c) => c.key === making.key) : undefined;
  const arrived = Boolean(making && makingCard?.wrap && (making.after === null || makingCard.wrap.made > making.after));
  const busyKey = making && !arrived ? making.key : null;
  const viewKey = openKey ?? (making?.open && arrived ? making.key : null);
  const viewCard = viewKey ? cards.find((c) => c.key === viewKey) : undefined;
  const story = viewCard?.wrap ?? null;
  const wrapping = !story && making?.open && !arrived && link && making.key === link.key ? cards.find((c) => c.key === link.key) : undefined;

  const close = useCallback(() => {
    setOpenKey(null);
    setMaking(null);
  }, []);

  const onFinish = useCallback((id: string) => {
    if (finished.current.has(id)) return;
    finished.current.add(id);
    void send("/api/wraps/finished", { body: { id }, keepalive: true });
  }, []);

  // Asks for the wrap; the page's refreshed data brings it (see Making).
  const request = useCallback(
    async (c: PeriodCard) => {
      const r = await send<{ id: string; empty: boolean; message: string }>("/api/wraps", { body: { period: c.period, offset: c.offset }, timeoutMs: 60_000 });
      if (!r.ok || r.data.empty) {
        setMaking(null);
        return setError(r.data.empty ? nothingYet(c) : r.offline ? OFFLINE : r.data.message || (ERRORS[r.data.error ?? ""] ?? "We couldn't make that wrap. Try again."));
      }
      startTransition(() => router.refresh());
    },
    [router],
  );

  function make(c: PeriodCard, open: boolean) {
    setError(null);
    setMaking({ key: c.key, after: c.wrap?.made ?? null, open });
    void request(c);
  }

  // From inside the story: it stays on screen, the old version, until the new one arrives.
  function update(c: PeriodCard) {
    setOpenKey(c.key);
    make(c, false);
  }

  // The linked week's wrap, made once on arrival (React runs effects twice in development).
  useEffect(() => {
    if (started.current || !autoMake) return;
    started.current = true;
    void request(autoMake);
  }, [autoMake, request]);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Wraps</h1>
      <p className="mt-3 max-w-prose text-lg text-graphite">
        Your week, month and year in health, {firstName}: what you ate, what moved, and the one thing to do next. Built from your food log and reports.
      </p>
      {aiOff && <p className="error-mark mt-4 text-sm">Wraps aren&apos;t switched on yet on this server.</p>}
      {error && !story && (
        <p role="alert" className="error-mark mt-4 text-sm">
          {error}
        </p>
      )}

      <ul className="mt-10 grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.key} className={`flex min-h-44 flex-col justify-between border p-5 ${c.wrap ? "border-paper" : "border-line-strong"} ${c.period === "year" ? "sm:col-span-2" : ""}`}>
            <div>
              <p className="text-sm text-graphite">{c.label}</p>
              <h2 className="mt-1 text-2xl font-bold semiwide">{c.wrap ? c.wrap.title : c.name}</h2>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {c.wrap && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setOpenKey(c.key);
                  }}
                  className="button-primary h-11"
                >
                  Play
                </button>
              )}
              {(c.wrap && c.ongoing) || (!c.wrap && c.hasData) ? (
                <button type="button" onClick={() => make(c, true)} disabled={!!busyKey} className={c.wrap ? "link-quiet min-h-11 text-sm" : "button-ghost h-11"}>
                  {busyKey === c.key ? "Making it…" : c.wrap ? "Update with latest" : "Make my wrap"}
                </button>
              ) : !c.wrap && c.ongoing ? (
                <Link href="/fuel" className="button-ghost h-11">
                  Log a meal to start it
                </Link>
              ) : !c.wrap ? (
                <p className="text-sm text-graphite">Nothing logged {thatPeriod(c.period)}.</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {story && viewCard && (
        <Viewer
          key={story.made}
          story={story}
          onClose={close}
          onFinish={onFinish}
          onUpdate={viewCard.ongoing ? () => update(viewCard) : undefined}
          updating={busyKey === viewCard.key}
          error={error}
        />
      )}
      {wrapping && <Wrapping label={wrapping.label} days={link?.days ?? []} onClose={() => setMaking((m) => m && { ...m, open: false })} />}
    </main>
  );
}
