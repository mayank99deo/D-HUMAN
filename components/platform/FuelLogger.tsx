"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { MealOrbit, type MealRun } from "./MealOrbit";
import type { OrbitFact } from "./Orbit";
import { shrinkImage } from "./shrink";

type Totals = { kcal: number; proteinG: number; carbsG: number; fatG: number; fibreG: number };
type Log = { id: string; meal: string; title: string; source: string; kcal: number; proteinG: number; confidence: string | null; tip: string | null; items: string[]; demo: boolean };
type Mode = "photo" | "voice" | "text";
type Meal = "" | "breakfast" | "lunch" | "dinner" | "snack";

const MEALS: { id: Meal; label: string }[] = [
  { id: "", label: "Guess from the time" },
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
];
const MEAL_ORDER = ["breakfast", "lunch", "snack", "dinner"];

const ERRORS: Record<string, string> = {
  not_food: "That doesn't look like food. Try another photo, or tell us what you ate.",
  ai_off: "Food reading isn't switched on yet on this server.",
  rate_limited: "That's a lot of meals in an hour. Try again a bit later.",
  too_large: "That photo is too big. Try again; we shrink photos before sending.",
  empty: "Add a photo or a few words first.",
};

// Minimal typing for the browser's speech recognition, which TypeScript doesn't ship.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const noop = () => () => {};
const hasSpeech = () => {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
};

function Plate({ totals, target }: { totals: Totals; target: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const p = totals.proteinG * 4;
  const cb = totals.carbsG * 4;
  const f = totals.fatG * 9;
  const sum = p + cb + f || 1;
  const filled = Math.min(1, totals.kcal / target);
  const arcs = [
    { v: p / sum, label: "Protein", o: 1 },
    { v: cb / sum, label: "Carbs", o: 0.55 },
    { v: f / sum, label: "Fat", o: 0.28 },
  ];
  let offset = 0;
  return (
    <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0 -rotate-90" aria-hidden>
      <circle cx="90" cy="90" r={r} fill="none" stroke="var(--color-line)" strokeWidth="14" />
      {arcs.map((a) => {
        const len = a.v * filled * c;
        const el = <circle key={a.label} cx="90" cy="90" r={r} fill="none" stroke="var(--color-paper)" strokeOpacity={a.o} strokeWidth="14" strokeDasharray={`${len} ${c}`} strokeDashoffset={-offset} />;
        offset += len;
        return el;
      })}
    </svg>
  );
}

export function FuelLogger({
  aiOff,
  targets,
  totals,
  micros,
  logs,
  typical,
  gaps,
  gapSource,
  language,
  facts,
  categories,
}: {
  aiOff: boolean;
  targets: Totals & { basis: string[]; estimated: boolean };
  totals: Totals;
  micros: { label: string; pct: number }[];
  logs: Log[];
  typical: { description: string; patterns: string[] } | null;
  gaps: { label: string; pct: number }[];
  gapSource: "logs" | "typical_day" | "none";
  language: string;
  facts: OrbitFact[];
  categories: string[];
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode | null>(null);
  const [meal, setMeal] = useState<Meal>("");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Log | null>(null);
  const [listening, setListening] = useState(false);
  const voiceSupported = useSyncExternalStore(noop, hasSpeech, () => true);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const voiceOk = voiceSupported && !voiceFailed;
  const rec = useRef<Recognition | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [typicalText, setTypicalText] = useState(typical?.description ?? "");
  const [editingTypical, setEditingTypical] = useState(!typical);
  const [typicalBusy, setTypicalBusy] = useState(false);
  const [run, setRun] = useState<MealRun | null>(null);

  function listen() {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return setVoiceFailed(true);
    const r = new Ctor();
    r.lang = language === "hi" ? "hi-IN" : "en-IN";
    r.interimResults = true;
    r.continuous = true;
    const before = text ? `${text.trim()} ` : "";
    r.onresult = (e) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setText(before + s);
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed") setError("Allow the microphone to talk, or type instead.");
    };
    rec.current = r;
    r.start();
    setListening(true);
  }

  function stop() {
    rec.current?.stop();
    setListening(false);
  }

  async function pickPhoto(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setError(null);
    try {
      const small = await shrinkImage(f, 1280, 0.8);
      setPhoto({ file: small, url: URL.createObjectURL(small) });
      setMode("photo");
    } catch {
      setError("We couldn't open that photo. Try a JPEG or PNG.");
    }
  }

  async function submit() {
    if (listening) stop();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("source", mode === "photo" ? "photo" : mode === "voice" ? "voice" : "text");
    if (text.trim()) form.append("text", text.trim());
    if (meal) form.append("meal", meal);
    if (mode === "photo" && photo) form.append("photo", photo.file, "meal.jpg");
    const startedAt = Date.now();
    setRun({ kind: "meal", startedAt, state: "running" });
    const res = await fetch("/api/food", { method: "POST", body: form }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      const message = ERRORS[data.error] ?? "We couldn't log that. Try again.";
      setRun((r) => (r ? { ...r, state: "error", error: message } : r));
      return setError(message);
    }
    const l = data.log;
    const logged: Log = {
      id: l.id, meal: l.meal, title: l.title, source: l.source, kcal: l.kcal, proteinG: l.proteinG, confidence: l.confidence,
      tip: l.micros?.tip ?? null, items: l.items.map((i: { name: string; portion: string }) => `${i.name}, ${i.portion}`), demo: l.model === "mock",
    };
    setLast(logged);
    setRun((r) => (r ? { ...r, state: "done", result: { title: logged.title, kcal: logged.kcal, proteinG: logged.proteinG, tip: logged.tip, demo: logged.demo } } : r));
    setText("");
    setPhoto(null);
    setMode(null);
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    await fetch(`/api/food/${id}`, { method: "DELETE" });
    if (last?.id === id) setLast(null);
    startTransition(() => router.refresh());
  }

  async function saveTypical() {
    setTypicalBusy(true);
    setRun({ kind: "typical", startedAt: Date.now(), state: "running" });
    const res = await fetch("/api/food/typical", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: typicalText }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setTypicalBusy(false);
    if (res?.ok) {
      setEditingTypical(false);
      setRun((r) => (r ? { ...r, state: "done", patterns: data.day?.patterns ?? [] } : r));
      startTransition(() => router.refresh());
    } else {
      const message = "Tell us a little more about a normal day, then save.";
      setRun((r) => (r ? { ...r, state: "error", error: message } : r));
      setError(message);
    }
  }

  const sorted = [...logs].sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal));

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      {run && <MealOrbit run={run} facts={facts} categories={categories} onClose={() => setRun(null)} />}
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Fuel</h1>

      <section className={`mt-8 flex flex-wrap items-center gap-8 ${refreshing ? "opacity-70" : ""}`} aria-label="Today so far">
        <div className="relative">
          <Plate totals={totals} target={targets.kcal} />
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="display-num text-4xl">{Math.round(totals.kcal).toLocaleString("en-IN")}</p>
              <p className="text-sm text-graphite">of {targets.kcal.toLocaleString("en-IN")} kcal</p>
            </div>
          </div>
        </div>
        <dl className="grid min-w-56 flex-1 gap-4">
          {[
            { k: "Protein", v: totals.proteinG, t: targets.proteinG, o: 1 },
            { k: "Carbs", v: totals.carbsG, t: targets.carbsG, o: 0.55 },
            { k: "Fat", v: totals.fatG, t: targets.fatG, o: 0.28 },
            { k: "Fibre", v: totals.fibreG, t: targets.fibreG, o: 1 },
          ].map((x) => (
            <div key={x.k}>
              <div className="flex justify-between text-sm">
                <dt className="flex items-center gap-2">
                  <span aria-hidden className="h-2.5 w-2.5 bg-paper" style={{ opacity: x.o }} />
                  {x.k}
                </dt>
                <dd>
                  <span className="font-bold">{Math.round(x.v)}</span> <span className="text-graphite">/ {x.t} g</span>
                </dd>
              </div>
              <div className="mt-1.5 h-1 bg-line" aria-hidden>
                <div className="h-1 bg-paper" style={{ width: `${Math.min(100, (x.v / x.t) * 100)}%`, opacity: x.o }} />
              </div>
            </div>
          ))}
        </dl>
      </section>

      {/* Log a meal */}
      <section className="mt-12" aria-labelledby="log">
        <h2 id="log" className="text-2xl font-bold semiwide">
          Log a meal
        </h2>
        {aiOff && <p className="error-mark mt-3 text-sm">Food reading isn&apos;t switched on yet on this server.</p>}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => camera.current?.click()} className={`flex min-h-24 flex-col items-start justify-between border p-4 text-left ${mode === "photo" ? "border-paper" : "border-line-strong"}`}>
            <span className="text-lg font-bold semiwide">Snap</span>
            <span className="text-xs text-graphite">A photo of your plate</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("voice");
              if (voiceOk && !listening) listen();
            }}
            className={`flex min-h-24 flex-col items-start justify-between border p-4 text-left ${mode === "voice" ? "border-paper" : "border-line-strong"}`}
          >
            <span className="text-lg font-bold semiwide">Say</span>
            <span className="text-xs text-graphite">Tell us what you ate</span>
          </button>
          <button type="button" onClick={() => setMode("text")} className={`flex min-h-24 flex-col items-start justify-between border p-4 text-left ${mode === "text" ? "border-paper" : "border-line-strong"}`}>
            <span className="text-lg font-bold semiwide">Type</span>
            <span className="text-xs text-graphite">A few words is enough</span>
          </button>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pickPhoto(e.target.files)} />

        {mode && (
          <div className="mt-5 space-y-4">
            {mode === "photo" && photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.url} alt="Your meal" className="max-h-72 w-full border border-line object-cover" />
            )}
            {mode === "voice" && !voiceOk && <p className="text-sm text-graphite">This browser can&apos;t listen. Use the mic on your keyboard in the box below instead.</p>}
            <label className="block">
              <span className="mb-2 block text-sm text-graphite">
                {mode === "photo" ? "Anything the photo won't show? (optional)" : mode === "voice" ? (listening ? "Listening… speak naturally" : "What you said") : "What did you eat?"}
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
                className="textarea"
                placeholder={mode === "photo" ? "e.g. cooked in ghee, 2 rotis under the dal" : "e.g. 2 rotis, dal, bhindi sabzi and a katori of curd"}
              />
            </label>
            {mode === "voice" && voiceOk && (
              <button type="button" onClick={listening ? stop : listen} className="button-ghost h-11">
                {listening ? "Stop listening" : "Talk again"}
              </button>
            )}
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-2 text-sm text-graphite">Which meal?</legend>
              {MEALS.map((m) => (
                <label key={m.id || "auto"} className="choice">
                  <input type="radio" name="meal" className="sr-only" checked={meal === m.id} onChange={() => setMeal(m.id)} />
                  {m.label}
                </label>
              ))}
            </fieldset>
            <div className="flex gap-3">
              <button type="button" onClick={submit} disabled={busy || (!text.trim() && !(mode === "photo" && photo))} className="button-primary h-13 flex-1 sm:flex-none sm:px-10">
                {busy ? "Reading your meal…" : "Log this meal"}
              </button>
              <button
                type="button"
                className="button-ghost h-13"
                onClick={() => {
                  stop();
                  setMode(null);
                  setPhoto(null);
                  setText("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="error-mark mt-4 text-sm">
            {error}
          </p>
        )}

        {last && (
          <article className="fact-in mt-6 border border-paper p-5" aria-live="polite">
            <p className="text-sm text-graphite">Logged{last.demo ? " (demo estimate)" : ""}</p>
            <h3 className="mt-1 text-xl font-bold">{last.title}</h3>
            <p className="mt-2">
              <span className="display-num text-3xl">{Math.round(last.kcal)}</span> <span className="text-graphite">kcal</span>
              <span className="ml-5 display-num text-3xl">{Math.round(last.proteinG)}</span> <span className="text-graphite">g protein</span>
            </p>
            <p className="mt-2 text-sm text-graphite">{last.items.join("; ")}</p>
            {last.tip && <p className="mt-3">{last.tip}</p>}
          </article>
        )}
      </section>

      {/* Today's meals */}
      <section className="mt-12" aria-labelledby="today">
        <h2 id="today" className="text-2xl font-bold semiwide">
          Today
        </h2>
        {sorted.length === 0 ? (
          <p className="mt-3 text-graphite">Nothing yet. Your first meal sets the day&apos;s picture.</p>
        ) : (
          <ul className="mt-3">
            {sorted.map((l) => (
              <li key={l.id} className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-line py-4">
                <div className="min-w-0">
                  <p className="text-sm text-graphite">
                    {l.meal[0].toUpperCase() + l.meal.slice(1)}, by {l.source === "photo" ? "photo" : l.source === "voice" ? "voice" : "text"}
                    {l.confidence === "low" ? ", rough estimate" : ""}
                  </p>
                  <p className="font-semibold">{l.title}</p>
                  <p className="truncate text-sm text-graphite">{l.items.join("; ")}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{Math.round(l.kcal)} kcal</p>
                  <p className="text-sm text-graphite">{Math.round(l.proteinG)} g protein</p>
                  <button type="button" className="link-quiet min-h-11 text-sm" onClick={() => remove(l.id)} aria-label={`Delete ${l.title}`}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {sorted.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-graphite">Micronutrients today, as a share of your daily need</h3>
            <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {micros.map((m) => (
                <li key={m.label}>
                  <div className="flex justify-between text-sm">
                    <span>{m.label}</span>
                    <span className="text-graphite">{m.pct}%</span>
                  </div>
                  <div className="mt-1 h-1 bg-line" aria-hidden>
                    <div className="h-1 bg-paper" style={{ width: `${Math.min(100, m.pct)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Gaps */}
      {gaps.length > 0 && (
        <section className="mt-12" aria-labelledby="gaps">
          <h2 id="gaps" className="text-2xl font-bold semiwide">
            Your biggest gaps
          </h2>
          <p className="mt-2 text-graphite">{gapSource === "logs" ? "Averaged over your logged days in the last two weeks." : "From how you said you usually eat. Logging meals makes this sharper."}</p>
          <ul className="mt-4">
            {gaps.map((g) => (
              <li key={g.label} className="flex items-baseline justify-between border-t border-line py-3">
                <span className="font-semibold">{g.label}</span>
                <span>
                  <span className="display-num text-2xl">{g.pct}%</span> <span className="text-sm text-graphite">of your need</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Typical day */}
      <section className="mt-12 border border-line-strong p-5" aria-labelledby="typical">
        <h2 id="typical" className="text-2xl font-bold semiwide">
          How you usually eat
        </h2>
        {editingTypical ? (
          <>
            <p className="mt-2 text-graphite">Describe a normal day, morning to night. We use it until you&apos;ve logged a few days.</p>
            <textarea
              value={typicalText}
              onChange={(e) => setTypicalText(e.target.value)}
              maxLength={2000}
              className="textarea mt-4 min-h-32"
              placeholder="e.g. Chai and 2 biscuits at 7. Poha at 9. Office lunch: 3 rotis, dal, sabzi. Evening chai with namkeen. Dinner rice, dal, curd."
            />
            <button type="button" onClick={saveTypical} disabled={typicalBusy || typicalText.trim().length < 10} className="button-primary mt-3 h-12">
              {typicalBusy ? "Reading…" : "Save my usual day"}
            </button>
          </>
        ) : (
          typical && (
            <>
              <ul className="mt-3 space-y-2">
                {typical.patterns.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
              <button type="button" className="link-quiet mt-3 min-h-11 text-sm" onClick={() => setEditingTypical(true)}>
                Change it
              </button>
            </>
          )
        )}
      </section>

      <details className="mt-10 text-sm text-graphite">
        <summary className="min-h-11 cursor-pointer py-3">How we set your targets</summary>
        <ul className="mt-2 space-y-1">
          {targets.basis.map((b) => (
            <li key={b}>{b}</li>
          ))}
          {targets.estimated && <li>Add your height and weight in Settings for targets that fit you.</li>}
          <li>Meal numbers are estimates from your photo or words, not lab measurements.</li>
        </ul>
      </details>
    </main>
  );
}
