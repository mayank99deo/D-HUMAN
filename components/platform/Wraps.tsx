"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

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

// Each card kind gets a faint wash from the blood palette; "next" is printed on paper.
const WASH: Record<string, string> = {
  stat: "radial-gradient(90% 70% at 80% 10%, rgb(181 210 192 / 0.22), transparent 65%)",
  streak: "radial-gradient(90% 70% at 20% 90%, rgb(226 211 162 / 0.22), transparent 65%)",
  food: "radial-gradient(90% 70% at 80% 90%, rgb(226 211 162 / 0.16), transparent 65%)",
  gap: "radial-gradient(90% 70% at 20% 10%, rgb(227 165 162 / 0.24), transparent 65%)",
  marker: "radial-gradient(90% 70% at 50% 0%, rgb(181 210 192 / 0.18), transparent 65%)",
  win: "radial-gradient(90% 70% at 50% 100%, rgb(181 210 192 / 0.24), transparent 65%)",
};

function Viewer({ story, onClose }: { story: Story; onClose: () => void }) {
  const slides: Card[] = [{ kind: "title", big: story.title, label: "", line: "" }, ...story.cards, { kind: "next", big: "One thing", label: "", line: story.oneThing }];
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const next = useCallback(() => setI((x) => (x + 1 < slides.length ? x + 1 : x)), [slides.length]);
  const prev = () => setI((x) => Math.max(0, x - 1));

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (paused || reduce || i >= slides.length - 1) return;
    const t = setTimeout(next, 5200);
    return () => clearTimeout(t);
  }, [i, paused, next, slides.length]);

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
  return (
    <div role="dialog" aria-modal aria-label={story.title} className={`fixed inset-0 z-50 flex flex-col ${paper ? "paper" : "bg-ink"}`} style={{ backgroundImage: paper ? undefined : WASH[s.kind] }}>
      <div className="mx-auto flex w-full max-w-xl gap-1 px-4 pt-[max(1rem,env(safe-area-inset-top))]" aria-hidden>
        {slides.map((_, j) => (
          <div key={j} className={`h-0.5 flex-1 ${paper ? "bg-ink/20" : "bg-paper/20"}`}>
            <div className={`h-0.5 ${paper ? "bg-ink" : "bg-paper"} ${j === i && !paused ? "wrap-fill" : ""}`} style={{ width: j < i ? "100%" : j === i ? undefined : "0%" }} />
          </div>
        ))}
      </div>
      <div className="mx-auto flex w-full max-w-xl items-center justify-between px-4 pt-2">
        <span className={`text-sm ${paper ? "text-smoke" : "text-graphite"}`}>
          {i + 1} of {slides.length}
          {story.demo ? ", demo" : ""}
        </span>
        <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm font-semibold">
          Close
        </button>
      </div>

      <div
        className="relative mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 pb-16"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerCancel={() => setPaused(false)}
      >
        <div key={i} className="fact-in">
          {s.kind === "title" ? (
            <p className="verdict-type text-[clamp(2.75rem,11vw,5rem)]">{s.big}</p>
          ) : (
            <>
              {s.label && <p className={`text-lg font-semibold ${paper ? "text-smoke" : "text-graphite"}`}>{s.label}</p>}
              <p className={`mt-2 display-num ${s.big.length > 8 ? "text-[clamp(3rem,13vw,5.5rem)]" : "text-[clamp(5rem,26vw,10rem)]"}`}>{s.big}</p>
              <p className="mt-6 max-w-md text-xl leading-snug">{s.line}</p>
            </>
          )}
        </div>
        <button type="button" aria-label="Previous" onClick={prev} className="absolute inset-y-0 left-0 w-1/3" />
        <button type="button" aria-label="Next" onClick={i < slides.length - 1 ? next : onClose} className="absolute inset-y-0 right-0 w-2/3" />
      </div>
    </div>
  );
}

const ERRORS: Record<string, string> = {
  ai_off: "Wraps aren't switched on yet on this server.",
  rate_limited: "That's a lot of wraps in an hour. Try again a bit later.",
};

export function WrapsClient({ cards, firstName, aiOff }: { cards: PeriodCard[]; firstName: string; aiOff: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState<Story | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [want, setWant] = useState<string | null>(null);

  // After making a wrap, it opens as soon as the refreshed list carries it.
  const showing = open ?? (want ? (cards.find((c) => c.wrap?.id === want)?.wrap ?? null) : null);
  const close = () => {
    setOpen(null);
    setWant(null);
  };

  async function make(c: PeriodCard) {
    setBusy(c.key);
    setError(null);
    const res = await fetch("/api/wraps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ period: c.period, offset: c.offset }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(ERRORS[data.error] ?? "We couldn't make that wrap. Try again.");
    if (data.empty) return setError(`Nothing logged for ${c.name.toLowerCase()} yet. Log a few meals first.`);
    setWant(data.id);
    startTransition(() => router.refresh());
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Wraps</h1>
      <p className="mt-3 max-w-prose text-lg text-graphite">
        Your week, month and year in health, {firstName}: what you ate, what moved, and the one thing to do next. Built from your food log and reports.
      </p>
      {aiOff && <p className="error-mark mt-4 text-sm">Wraps aren&apos;t switched on yet on this server.</p>}
      {error && (
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
                <button type="button" onClick={() => setOpen(c.wrap)} className="button-primary h-11">
                  Play
                </button>
              )}
              {(!c.wrap || c.ongoing) && (
                <button type="button" onClick={() => make(c)} disabled={!!busy || !c.hasData} className={c.wrap ? "link-quiet min-h-11 text-sm" : "button-ghost h-11"}>
                  {busy === c.key ? "Making it…" : c.wrap ? "Update with latest" : c.hasData ? "Make my wrap" : "Log meals to unlock"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {showing && <Viewer story={showing} onClose={close} />}
    </main>
  );
}
