"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { PlanView } from "@/lib/domain/plan";
import {
  MEAL_ENGLISH_MAX,
  MEAL_WORDS_MAX,
  SPOKEN,
  langTag,
  scriptLanguage,
  soundsLikeHindi,
  spokenById,
  spokenForAppLanguage,
  spokenOf,
  translateSource,
  type Spoken,
  type SpokenId,
} from "@/lib/domain/speech";
import { COUNTDOWN_MS, IDLE, stepAutoLog, type AutoEvent, type AutoLog } from "./autolog";
import { MealOrbit, type MealRun } from "./MealOrbit";
import { OFFLINE, send } from "./net";
import { Paywall, PlanLine } from "./Paywall";
import { overBy, TargetBar } from "./Target";
import type { OrbitFact } from "./Orbit";
import { shrinkImage } from "./shrink";
import { toEnglish } from "./translate";
import { useReducedMotion, VoiceActivity, VoiceMeter } from "./VoiceMeter";

type Totals = { kcal: number; proteinG: number; carbsG: number; fatG: number; fibreG: number };
type Log = {
  id: string; meal: string; title: string; source: string; kcal: number; proteinG: number; confidence: string | null; tip: string | null; items: string[]; demo: boolean;
  /** The language the title and tip are written in, as an HTML lang tag. */
  lang?: string;
};
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
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
};

const noop = () => () => {};
// Handlers and timers read the time through this. They never run during render, but
// the React compiler's purity check can't always tell, and flags Date.now() in them.
const clock = () => Date.now();
const hasSpeech = () => {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
};

// The last "Speaking in" pick, remembered in this browser.
const SPOKEN_KEY = "dh-spoken";
function savedSpoken(): SpokenId | null {
  try {
    return spokenOf(localStorage.getItem(SPOKEN_KEY))?.id ?? null;
  } catch {
    return null;
  }
}
function rememberSpoken(id: SpokenId) {
  try {
    localStorage.setItem(SPOKEN_KEY, id);
  } catch {
    /* private mode or blocked storage: the pick still holds for this visit */
  }
}

// What to say when the browser stops listening. Errors not listed (no speech, aborted) say nothing.
function listenError(error: string, lang: Spoken): string | null {
  if (error === "not-allowed") return "Allow the microphone to talk, or type instead.";
  if (error === "language-not-supported" || error === "service-not-allowed")
    return `This browser can't listen in ${lang.name}. Type it in the box below, or use the mic on your keyboard.`;
  if (error === "audio-capture") return "We couldn't find a microphone. Type what you ate instead.";
  if (error === "network") return "Listening needs a connection. Check your signal, or type instead.";
  return null;
}

// Today's plate. The ring is the day's energy target, split by where the
// energy came from. Past the target the ring stays full and a thin outer arc
// carries the extra, with a notch at the top marking where the target sits,
// so 189% never looks like 100%.
function Plate({ totals, target }: { totals: Totals; target: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const p = totals.proteinG * 4;
  const cb = totals.carbsG * 4;
  const f = totals.fatG * 9;
  const sum = p + cb + f || 1;
  const filled = Math.min(1, totals.kcal / target);
  const over = Math.max(0, totals.kcal / target - 1);
  // Paper at these strengths keeps each arc at 3:1 or more against the track.
  const arcs = [
    { v: p / sum, label: "Protein", o: 1 },
    { v: cb / sum, label: "Carbs", o: 0.7 },
    { v: f / sum, label: "Fat", o: 0.45 },
  ].filter((a) => a.v > 0);
  const gap = arcs.length > 1 && filled > 0.04 ? 2 : 0;
  const ro = 84;
  const co = 2 * Math.PI * ro;
  let offset = 0;
  return (
    <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0 -rotate-90" aria-hidden>
      <circle cx="90" cy="90" r={r} fill="none" stroke="var(--color-line)" strokeWidth="14" />
      {arcs.map((a) => {
        const len = a.v * filled * c;
        const el = (
          <circle
            key={a.label}
            cx="90"
            cy="90"
            r={r}
            fill="none"
            stroke="var(--color-paper)"
            strokeOpacity={a.o}
            strokeWidth="14"
            strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
            strokeDashoffset={-offset}
          />
        );
        offset += len;
        return el;
      })}
      {over > 0 && (
        <circle cx="90" cy="90" r={ro} fill="none" stroke="var(--color-paper)" strokeWidth="3" strokeLinecap="butt" strokeDasharray={`${Math.min(1, over) * co} ${co}`} />
      )}
      {/* The target notch, at twelve o'clock (the svg is turned a quarter). */}
      <line x1={90 + r - 10} y1="90" x2={90 + (over > 0 ? ro + 4 : r + 10)} y2="90" stroke="var(--color-paper)" strokeWidth="2" />
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
  plan,
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
  plan: PlanView;
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
  // Why the browser stopped listening, shown by the language row rather than under the buttons.
  const [heardProblem, setHeardProblem] = useState<string | null>(null);
  const voiceSupported = useSyncExternalStore(noop, hasSpeech, () => true);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const voiceOk = voiceSupported && !voiceFailed;
  const rec = useRef<Recognition | null>(null);
  // "Speaking in": this visit's pick, else the one remembered here, else the app language.
  // The saved pick is read after hydration, so server and browser render the same.
  const [picked, setPicked] = useState<SpokenId | null>(null);
  const saved = useSyncExternalStore(noop, savedSpoken, () => null);
  const spokenId = picked ?? saved ?? spokenForAppLanguage(language);
  const spoken = spokenById(spokenId);
  const langRow = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const reduced = useReducedMotion();
  // What the recogniser hears, for the mic's bars (VoiceMeter.tsx).
  const [activity] = useState(() => new VoiceActivity());
  // Logging a spoken meal by itself after a pause (autolog.ts). The ref is the truth
  // for callbacks; the state mirrors it for the screen.
  const auto = useRef<AutoLog>(IDLE);
  const [autoView, setAutoView] = useState<AutoLog>(IDLE);
  const counting = autoView.kind === "counting";
  const suggestHindi = mode === "voice" && voiceOk && spoken.id === "en" && soundsLikeHindi(text);
  // Recogniser callbacks and the clock outlive the render that made them; they go
  // through this ref so they always see the current screen.
  const driveRef = useRef<(e: AutoEvent) => void>(() => {});
  // One meal log at a time, however it was started.
  const inFlight = useRef(false);
  const drain = useRef<HTMLSpanElement>(null);
  const [typicalText, setTypicalText] = useState(typical?.description ?? "");
  const [editingTypical, setEditingTypical] = useState(!typical);
  const [typicalBusy, setTypicalBusy] = useState(false);
  const [run, setRun] = useState<MealRun | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // The browser can't tell languages apart by itself, so it listens in the one picked.
  // Only the current recognition may write: one replaced or dropped stays quiet.
  function listen(lang: Spoken) {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return setVoiceFailed(true);
    rec.current?.abort();
    const r = new Ctor();
    r.lang = lang.speech;
    r.interimResults = true;
    r.continuous = true;
    const before = text.trim() ? `${text.trim()} ` : "";
    const mine = () => rec.current === r;
    activity.reset();
    r.onaudiostart = () => mine() && activity.note("audiostart");
    r.onsoundstart = r.onspeechstart = () => mine() && activity.note("speechstart");
    r.onspeechend = () => {
      if (!mine()) return;
      activity.note("speechend");
      driveRef.current({ type: "speechend", at: clock() });
    };
    r.onresult = (e) => {
      if (!mine()) return;
      let s = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        s += e.results[i][0].transcript;
        final ||= e.results[i].isFinal;
      }
      // The box's maxLength doesn't cap what code puts in it.
      const words = (before + s).slice(0, MEAL_WORDS_MAX);
      setText(words);
      activity.note("result");
      driveRef.current({ type: "result", at: clock(), final, spoke: s.trim() !== "", words });
    };
    r.onend = () => {
      if (!mine()) return;
      setListening(false);
      activity.note("end");
      driveRef.current({ type: "ended", at: clock() });
    };
    r.onerror = (e) => {
      if (!mine()) return;
      setListening(false);
      setHeardProblem(listenError(e.error, lang));
      if (e.error === "audio-capture") activity.captureFailed();
      // Don't log half a sentence because the browser stumbled.
      driveRef.current({ type: "hold" });
    };
    rec.current = r;
    setHeardProblem(null);
    try {
      r.start();
      setListening(true);
      drive({ type: "start", at: clock(), words: text });
    } catch {
      rec.current = null;
      setListening(false);
    }
  }

  // Stop listening but keep the last words, which can arrive just after. A stop by
  // hand means they'll log it themselves.
  function stop() {
    rec.current?.stop();
    setListening(false);
    drive({ type: "hold" });
  }

  // Stop listening and drop anything still on its way (on log, cancel or leaving voice).
  function quiet() {
    rec.current?.abort();
    rec.current = null;
    setListening(false);
    setHeardProblem(null);
    drive({ type: "hold" });
  }

  function drive(event: AutoEvent) {
    const before = auto.current;
    const next = stepAutoLog(before, event, { allowed: mode === "voice" && voiceOk && !plan.mealBlock && !aiOff });
    if (next === before) return;
    auto.current = next;
    setAutoView(next);
    // The countdown ran out: log it, as if they'd tapped the button.
    if (next.kind === "logging" && event.type === "tick") void submit();
  }

  useEffect(() => {
    driveRef.current = drive;
  });

  // A clock for the pause and the countdown, only while one could be running.
  const ticking = autoView.kind === "listening" || counting;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => driveRef.current({ type: "tick", at: clock() }), 100);
    return () => clearInterval(id);
  }, [ticking]);

  // The shrinking bar on the Log button while counting down.
  const countdownEnds = autoView.kind === "counting" ? autoView.endsAt : null;
  useEffect(() => {
    if (countdownEnds == null || reduced) return;
    const bar = drain.current?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
      duration: Math.max(0, countdownEnds - clock()),
      easing: "linear",
      fill: "forwards",
    });
    return () => bar?.cancel();
  }, [countdownEnds, reduced]);

  // Leaving the page stops listening (keeping the words) and never logs behind their back.
  useEffect(() => {
    const onHide = () => {
      if (!document.hidden) return;
      rec.current?.stop();
      setListening(false);
      driveRef.current({ type: "hold" });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  useEffect(() => () => rec.current?.abort(), []);

  // Picking a language listens in it straight away when already listening, or when
  // asked to (the "Sounds like Hindi?" suggestion). Otherwise it waits for Talk again.
  function pickSpoken(next: Spoken, andListen = false) {
    setPicked(next.id);
    rememberSpoken(next.id);
    setHeardProblem(null);
    if (listening || andListen) listen(next);
    else drive({ type: "hold" });
  }

  // During the countdown: carry on speaking, or stop and fix the words by hand.
  function keepTalking() {
    if (listening) drive({ type: "start", at: clock(), words: text });
    else listen(spoken);
  }
  function editWords() {
    stop();
    box.current?.focus();
  }

  // Show the picked language when the row opens, even if it's off to the side on a phone.
  useEffect(() => {
    const row = langRow.current;
    const chip = row?.querySelector<HTMLElement>("[data-picked]");
    if (row && chip) row.scrollLeft += chip.getBoundingClientRect().left - row.getBoundingClientRect().left - 16;
  }, [mode]);

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
    if (inFlight.current) return;
    inFlight.current = true;
    drive({ type: "submit" });
    try {
      await logNow();
    } finally {
      inFlight.current = false;
      drive({ type: "done" });
    }
  }

  async function logNow() {
    quiet();
    setBusy(true);
    setError(null);
    const words = text.trim();
    const speaking = mode === "voice" && voiceOk ? spokenId : null;
    const startedAt = clock();
    setRun({ kind: "meal", startedAt, state: "running" });
    // Into English on this device when the browser can; if not, their words go as they are.
    // The server answers in the language they spoke either way.
    const english = await toEnglish(words, translateSource(words, speaking), { maxLength: MEAL_ENGLISH_MAX });
    const form = new FormData();
    form.append("source", mode === "photo" ? "photo" : mode === "voice" ? "voice" : "text");
    if (english) {
      form.append("text", english);
      form.append("original", words);
    } else if (words) form.append("text", words);
    if (speaking) form.append("spoken", speaking);
    if (meal) form.append("meal", meal);
    if (mode === "photo" && photo) form.append("photo", photo.file, "meal.jpg");
    const res = await fetch("/api/food", { method: "POST", body: form }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.status === 402) {
      // Out of meal logs: the refreshed page shows the paywall in place of the buttons.
      setRun(null);
      setMode(null);
      return startTransition(() => router.refresh());
    }
    if (!res?.ok) {
      const message = data.message || (res ? (ERRORS[data.error] ?? "We couldn't log that. Try again.") : "No connection. Check your signal and try again.");
      setRun((r) => (r ? { ...r, state: "error", error: message } : r));
      return setError(message);
    }
    const l = data.log;
    const logged: Log = {
      id: l.id, meal: l.meal, title: l.title, source: l.source, kcal: l.kcal, proteinG: l.proteinG, confidence: l.confidence,
      tip: l.micros?.tip ?? null, items: l.items.map((i: { name: string; portion: string }) => `${i.name}, ${i.portion}`), demo: l.model === "mock",
      lang: langTag(l.micros?.lang, l.title),
    };
    setLast(logged);
    setRun((r) => (r ? { ...r, state: "done", result: { title: logged.title, kcal: logged.kcal, proteinG: logged.proteinG, tip: logged.tip, demo: logged.demo } } : r));
    setText("");
    setPhoto(null);
    setMode(null);
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    const r = await send(`/api/food/${id}`, { method: "DELETE" });
    setRemoving(null);
    if (!r.ok) return setError(r.offline ? `That meal wasn't deleted. ${OFFLINE}` : "That meal wasn't deleted. Try again.");
    if (last?.id === id) setLast(null);
    startTransition(() => router.refresh());
  }

  async function saveTypical() {
    setTypicalBusy(true);
    setRun({ kind: "typical", startedAt: clock(), state: "running" });
    const res = await fetch("/api/food/typical", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: typicalText }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setTypicalBusy(false);
    if (res?.ok) {
      setEditingTypical(false);
      setRun((r) => (r ? { ...r, state: "done", patterns: data.day?.patterns ?? [] } : r));
      startTransition(() => router.refresh());
    } else {
      const message =
        data.message ||
        (!res
          ? "No connection. Check your signal and try again."
          : data.error === "rate_limited"
            ? "That's a lot of tries in an hour. Try again a bit later."
            : data.error === "ai_off"
              ? "Food reading isn't switched on yet on this server."
              : "Tell us a little more about a normal day, then save.");
      setRun((r) => (r ? { ...r, state: "error", error: message } : r));
      setError(message);
    }
  }

  const sorted = [...logs].sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal));
  const kcalOver = overBy(totals.kcal, targets.kcal);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      {run && <MealOrbit run={run} facts={facts} categories={categories} onClose={() => setRun(null)} />}
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Fuel</h1>

      <section className={`mt-8 flex flex-wrap items-center gap-8 ${refreshing ? "opacity-70" : ""}`} aria-label="Today so far">
        <div className="relative">
          <Plate totals={totals} target={targets.kcal} />
          <div className="absolute inset-0 grid place-items-center text-center">
            <div className="max-w-28">
              <p className="display-num text-3xl">{Math.round(totals.kcal).toLocaleString("en-IN")}</p>
              <p className="mt-1 text-sm leading-tight text-graphite">of {targets.kcal.toLocaleString("en-IN")} kcal</p>
              {kcalOver > 0 && <p className="text-sm font-semibold leading-tight">{kcalOver.toLocaleString("en-IN")} over</p>}
            </div>
          </div>
        </div>
        <dl className="grid min-w-56 flex-1 gap-4">
          {[
            { k: "Protein", v: totals.proteinG, t: targets.proteinG, o: 1, ring: true },
            { k: "Carbs", v: totals.carbsG, t: targets.carbsG, o: 0.7, ring: true },
            { k: "Fat", v: totals.fatG, t: targets.fatG, o: 0.45, ring: true },
            { k: "Fibre", v: totals.fibreG, t: targets.fibreG, o: 1, ring: false },
          ].map((x) => {
            const extra = overBy(x.v, x.t);
            return (
              <div key={x.k}>
                <div className="flex justify-between gap-3 text-sm">
                  <dt className="flex items-center gap-2">
                    {/* Squares are slices of the ring; fibre isn't in it, so it gets a dash. */}
                    <span aria-hidden className={x.ring ? "h-2.5 w-2.5 bg-paper" : "h-0.5 w-2.5 bg-paper"} style={{ opacity: x.o }} />
                    {x.k}
                  </dt>
                  <dd className="text-right">
                    <span className="font-bold">{Math.round(x.v)}</span> <span className="text-graphite">/ {x.t} g</span>
                    {extra > 0 && <span className="font-semibold">, {extra} over</span>}
                  </dd>
                </div>
                <TargetBar value={x.v} target={x.t} opacity={x.o} />
              </div>
            );
          })}
        </dl>
      </section>

      {/* Log a meal */}
      <section className="mt-12" aria-labelledby="log">
        <h2 id="log" className="text-2xl font-bold semiwide">
          Log a meal
        </h2>
        <PlanLine plan={plan} kind="meal" />
        {aiOff && <p className="error-mark mt-3 text-sm">Food reading isn&apos;t switched on yet on this server.</p>}
        {plan.mealBlock ? (
          <Paywall plan={plan} refusal={plan.mealBlock} />
        ) : (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  quiet();
                  camera.current?.click();
                }}
                className={`flex min-h-24 flex-col items-start justify-between border p-4 text-left ${mode === "photo" ? "border-paper" : "border-line-strong"}`}
              >
                <span className="text-lg font-bold semiwide">Snap</span>
                <span className="text-xs text-graphite">A photo of your plate</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("voice");
                  if (voiceOk && !listening) listen(spoken);
                }}
                className={`flex min-h-24 flex-col items-start justify-between border p-4 text-left ${mode === "voice" ? "border-paper" : "border-line-strong"}`}
              >
                <span className="text-lg font-bold semiwide">Say</span>
                <span className="text-xs text-graphite">Tell us what you ate</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  quiet();
                  setMode("text");
                }}
                className={`flex min-h-24 flex-col items-start justify-between border p-4 text-left ${mode === "text" ? "border-paper" : "border-line-strong"}`}
              >
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
                {mode === "voice" && voiceOk && (
                  // min-w-0: a fieldset otherwise grows to fit its widest row, which would widen the page.
                  <fieldset className="min-w-0">
                    <legend className="mb-2 text-sm text-graphite">Speaking in</legend>
                    {/* One row that scrolls sideways on phones, inside its own box; it wraps on wider screens.
                        relative: the hidden radios are absolutely placed, and would otherwise widen the page. */}
                    <div ref={langRow} className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
                      <div className="flex w-max gap-2 pb-1 sm:w-auto sm:flex-wrap">
                        {SPOKEN.map((s) => (
                          <label
                            key={s.id}
                            className="choice shrink-0"
                            lang={s.translateFrom ?? "en"}
                            dir={s.id === "ur" ? "rtl" : undefined}
                            data-picked={spoken.id === s.id ? "" : undefined}
                          >
                            <input type="radio" name="spoken" className="sr-only" checked={spoken.id === s.id} onChange={() => pickSpoken(s)} />
                            {s.label}
                          </label>
                        ))}
                      </div>
                    </div>
                    {heardProblem && (
                      <p role="alert" className="error-mark mt-3 text-sm">
                        {heardProblem}
                      </p>
                    )}
                    {/* A quiet offer, never a switch: with English picked, Hindi comes out in Latin letters. */}
                    {suggestHindi && (
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-graphite">
                        Sounds like Hindi?
                        <button type="button" className="link-quiet min-h-11 text-paper" onClick={() => pickSpoken(spokenById("hi"), true)}>
                          Listen in <span lang="hi">हिंदी</span>
                        </button>
                      </p>
                    )}
                    {/* True for Chrome and most phones: speech recognition runs on the browser maker's servers. */}
                    <p className="mt-2 text-xs text-graphite">Your browser turns your voice into words; some browsers use their maker&apos;s servers for this. We only receive the words.</p>
                  </fieldset>
                )}
                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm text-graphite">
                    {mode === "voice" && listening && <VoiceMeter active activity={activity} />}
                    {mode === "photo"
                      ? "Anything the photo won't show? (optional)"
                      : mode === "voice"
                        ? listening
                          ? `Listening in ${spoken.name}… speak naturally`
                          : "What you said"
                        : "What did you eat?"}
                  </span>
                  <textarea
                    ref={box}
                    value={text}
                    onChange={(e) => {
                      // Their typing wins: stop listening, and don't log by itself.
                      if (listening) quiet();
                      else drive({ type: "hold" });
                      setText(e.target.value);
                    }}
                    maxLength={MEAL_WORDS_MAX}
                    dir="auto"
                    lang={mode === "voice" && voiceOk ? (spoken.translateFrom ?? undefined) : undefined}
                    className="textarea"
                    placeholder={mode === "photo" ? "e.g. cooked in ghee, 2 rotis under the dal" : "e.g. 2 rotis, dal, bhindi sabzi and a katori of curd"}
                  />
                </label>
                {mode === "voice" && voiceOk && (
                  <div className="flex flex-wrap gap-3">
                    {autoView.kind === "counting" ? (
                      // Here, not only on the Log button: on a phone that button is below the fold.
                      <div className="w-full">
                        <p className="text-sm font-semibold">Logging in {autoView.left}…</p>
                        {/* With reduced motion the countdown is the words alone. */}
                        {!reduced && (
                          <span aria-hidden className="mt-2 block h-0.5 w-full bg-line">
                            <span ref={drain} className="block h-full origin-left bg-paper" />
                          </span>
                        )}
                        <div className="mt-3 flex gap-3">
                          <button type="button" onClick={keepTalking} className="button-ghost h-11">
                            Keep talking
                          </button>
                          <button type="button" onClick={editWords} className="button-ghost h-11">
                            Edit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={listening ? stop : () => listen(spoken)} className="button-ghost h-11">
                        {listening ? "Stop listening" : "Talk again"}
                      </button>
                    )}
                  </div>
                )}
                <p role="status" className="sr-only">
                  {counting ? `Logging this meal in ${COUNTDOWN_MS / 1000} seconds. Choose Keep talking or Edit to stop it.` : ""}
                </p>
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
                  <button
                    type="button"
                    onClick={submit}
                    disabled={busy || (!text.trim() && !(mode === "photo" && photo))}
                    className="button-primary h-13 flex-1 sm:flex-none sm:px-10"
                  >
                    {busy ? "Reading your meal…" : counting ? "Log now" : "Log this meal"}
                  </button>
                  <button
                    type="button"
                    className="button-ghost h-13"
                    onClick={() => {
                      quiet();
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
          </>
        )}
        {error && (
          <p role="alert" className="error-mark mt-4 text-sm">
            {error}
          </p>
        )}

        {last && (
          <article className="fact-in mt-6 border border-paper p-5" aria-live="polite">
            <p className="text-sm text-graphite">Logged{last.demo ? " (demo estimate)" : ""}</p>
            <h3 lang={last.lang} className="mt-1 text-xl font-bold">
              {last.title}
            </h3>
            <p className="mt-2">
              <span className="display-num text-3xl">{Math.round(last.kcal)}</span> <span className="text-graphite">kcal</span>
              <span className="ml-5 display-num text-3xl">{Math.round(last.proteinG)}</span> <span className="text-graphite">g protein</span>
            </p>
            <p className="mt-2 text-sm text-graphite">{last.items.join("; ")}</p>
            {last.tip && (
              <p lang={last.lang} className="mt-3">
                {last.tip}
              </p>
            )}
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
                  {/* Titles in an Indian script get their language; the rest inherit the page's. */}
                  <p lang={langTag(scriptLanguage(l.title), l.title)} className="font-semibold">
                    {l.title}
                  </p>
                  <p className="truncate text-sm text-graphite">{l.items.join("; ")}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{Math.round(l.kcal)} kcal</p>
                  <p className="text-sm text-graphite">{Math.round(l.proteinG)} g protein</p>
                  <button type="button" className="link-quiet min-h-11 text-sm" onClick={() => remove(l.id)} disabled={!!removing} aria-label={`Delete ${l.title}`}>
                    {removing === l.id ? "Deleting…" : "Delete"}
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
