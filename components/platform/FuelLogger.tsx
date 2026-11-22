"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { MEAL_ORDER, type MealView } from "@/lib/domain/meals";
import type { PlanView } from "@/lib/domain/plan";
import { MEAL_ENGLISH_MAX, MEAL_WORDS_MAX, langTag, spokenById, spokenForAppLanguage, translateSource, type SpokenId } from "@/lib/domain/speech";
import { ASK_COPY } from "./ask-copy";
import { gapsPrefill, mealPrefill } from "./ask-starters";
import { AskAbout } from "./AskAbout";
import { mealForm, sameTry, sendFailure, type MealTry } from "./meal-send";
import { MealOrbit, type MealRun } from "./MealOrbit";
import { MealRow } from "./MealRow";
import { OFFLINE, postResending, send, tryKey } from "./net";
import { Paywall, PlanLine } from "./Paywall";
import { overBy, TargetBar } from "./Target";
import type { OrbitFact } from "./Orbit";
import { SayCard, type SayHandle, type SayLeave } from "./SayCard";
import { PHOTO_ACCEPT, PHOTO_COPY, PROBLEM_CLEARANCE, readMealPhoto, revealProblem } from "./meal-photo";
import { useSpokenPick } from "./spoken-pick";
import { toEnglish } from "./translate";
import { useSpeechSupported } from "./useRecognizer";
import { SAY_COPY } from "./voice-copy";

type Totals = { kcal: number; proteinG: number; carbsG: number; fatG: number; fibreG: number };
type Log = MealView;
type Mode = "photo" | "voice" | "text";
type Meal = "" | "breakfast" | "lunch" | "dinner" | "snack";

const MEALS: { id: Meal; label: string }[] = [
  { id: "", label: "Guess from the time" },
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
];

const TYPICAL_ERRORS: Record<string, string> = {
  rate_limited: "That's a lot of tries in an hour. Try again a bit later.",
  ai_off: "Food reading isn't switched on yet on this server.",
  failed: "We couldn't save your usual day. Try again.",
};

/** A meal as /api/food sends it back (a food_logs row). */
type LoggedMeal = {
  id: string;
  meal: string;
  title: string;
  source: string;
  kcal: number;
  proteinG: number;
  confidence: string | null;
  model: string | null;
  items: { name: string; portion: string }[];
  micros?: { tip?: string | null; lang?: string };
};

// Handlers and timers read the time through this. They never run during render, but
// the React compiler's purity check can't always tell, and flags Date.now() in them.
const clock = () => Date.now();

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
  stackReady,
  focusUsual,
  ask = false,
}: {
  /** No report and no stack yet, and their meals are now enough to build one. */
  stackReady: boolean;
  /** Opened from the Stack screen to describe a usual day: start at that section. */
  focusUsual: boolean;
  /** Ask is open to this person: the meal just logged and the gaps get "Ask about this". */
  ask?: boolean;
  aiOff: boolean;
  targets: Totals & { basis: string[]; estimated: boolean };
  totals: Totals;
  /** A share of daily need, or IU for vitamin D, which mostly comes from sun. */
  micros: ({ label: string; pct: number } | { label: string; iu: number })[];
  logs: Log[];
  /** `short`: too light to count as a day's food, so the stack doesn't use it yet. */
  typical: { description: string; patterns: string[]; short: boolean } | null;
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
  // The grey support line for a failed send, shown only under the error it belongs to.
  const [errorNote, setErrorNote] = useState<{ error: string; note: string } | null>(null);
  const [last, setLast] = useState<Log | null>(null);
  const voiceOk = useSpeechSupported();
  // "Speaking in": this screen's pick, else the one remembered here, else the app language.
  // The saved pick is read after hydration, so server and browser render the same.
  const { spoken, saved, pick: pickSpoken } = useSpokenPick(spokenForAppLanguage(language));
  // The language the words in the box were heard in, when they came from the Say card.
  const [heardIn, setHeardIn] = useState<SpokenId | null>(null);
  // Two file inputs: the camera (capture) and the gallery (no capture). Laptops ignore
  // capture, so there both open the file picker and the photo tile uses the gallery one.
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  // A picked photo is being shrunk (a big one takes a moment on a phone).
  const [opening, setOpening] = useState(false);
  // Only the newest pick lands; the preview's object URL is freed when it's replaced.
  const picks = useRef(0);
  const shown = useRef<string | null>(null);
  // Why the last pick couldn't be used, shown beside the photo controls rather than under Log,
  // which can be off screen on a phone. Tied to the photo it left in place, so it goes once that
  // photo is logged, swapped or cancelled.
  const [photoTrouble, setPhotoTrouble] = useState<{ text: string; kept: typeof photo } | null>(null);
  const trouble = photoTrouble && photoTrouble.kept === photo ? photoTrouble.text : null;
  const box = useRef<HTMLTextAreaElement>(null);
  // One meal log at a time, however it was started.
  const inFlight = useRef(false);
  // The last try that didn't get logged, kept so sending it again reuses its key (meal-send.ts).
  const lastTry = useRef<MealTry | null>(null);
  const [typicalText, setTypicalText] = useState(typical?.description ?? "");
  // Opened from the Stack screen (?usual=1) with a usual day too light to count: straight to the editor, with what they wrote.
  const [editingTypical, setEditingTypical] = useState(!typical || (focusUsual && typical.short));
  const [typicalBusy, setTypicalBusy] = useState(false);
  const [run, setRun] = useState<MealRun | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // The Say card (SayCard.tsx): it listens, shows what it hears, and logs after a pause or a
  // tap, with a 3, 2, 1 to stop it. Its words land in this form's box whichever way it closes.
  const sayCard = useRef<SayHandle>(null);

  // The card closed. Edit and Type instead focus the box here, inside the same tap, so
  // iPhone opens the keyboard; Close leaves focus on Say, where the dialog puts it back.
  function leaveSay(how: SayLeave, lang: SpokenId | null) {
    setHeardIn(lang);
    if (how === "type") setMode("text");
    if (how === "close") return;
    const b = box.current;
    if (!b) return;
    b.focus();
    b.setSelectionRange(b.value.length, b.value.length);
  }

  // The photo tile: the camera where a finger is the main pointer (the same test as the
  // labels' `touch` variant, so what it says and what it does always agree), the file picker elsewhere.
  const openPhoto = () => (matchMedia("(pointer: coarse)").matches ? camera : gallery).current?.click();

  // Either input. Cleared each time, so picking the same photo again still counts.
  // Cancelling the picker fires nothing, so the photo already chosen stays.
  function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    void pickPhoto(f);
  }

  async function pickPhoto(f: File | undefined) {
    if (!f) return;
    const pick = ++picks.current;
    setError(null);
    setPhotoTrouble(null);
    setOpening(true);
    const read = await readMealPhoto(f);
    if (pick !== picks.current) return;
    setOpening(false);
    // A photo that won't open leaves the one already chosen in place.
    if ("problem" in read) return setPhotoTrouble({ text: PHOTO_COPY.problems[read.problem], kept: photo });
    if (shown.current) URL.revokeObjectURL(shown.current);
    shown.current = URL.createObjectURL(read.file);
    setPhoto({ file: read.file, url: shown.current });
    setMode("photo");
  }

  /** Log the meal. The Say card passes the words it heard and their language; the form uses its box. */
  async function submit(said?: string, lang?: SpokenId | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await logNow(said, lang);
    } finally {
      inFlight.current = false;
    }
  }

  /** Try again, from the orbit: the very same try (words, photo and key), so a meal that did land isn't logged twice. */
  async function retryMeal() {
    const t = lastTry.current;
    if (!t || inFlight.current) return;
    inFlight.current = true;
    try {
      await sendMeal(t);
    } finally {
      inFlight.current = false;
    }
  }

  async function logNow(said?: string, lang?: SpokenId | null) {
    const words = (said ?? text).trim();
    // The language they spoke in, for words that came from the Say card; typed words go by their script.
    const speaking = said != null ? (lang ?? null) : mode === "voice" ? heardIn : null;
    const source = mode === "photo" ? "photo" : mode === "voice" ? "voice" : "text";
    const file = mode === "photo" && photo ? photo.file : null;
    // The same meal as a try that didn't get logged: send that try again, with its key.
    const again = sameTry(lastTry.current, { words, speaking, source, meal, photo: file }, clock());
    if (again) return sendMeal(again);
    setBusy(true);
    setError(null);
    setRun({ kind: "meal", startedAt: clock(), state: "running" });
    // Into English on this device when the browser can; if not, their words go as they are.
    // The server answers in the language they spoke either way.
    const english = await toEnglish(words, translateSource(words, speaking), { maxLength: MEAL_ENGLISH_MAX });
    const t: MealTry = { key: tryKey(), at: clock(), words, english, speaking, source, meal, photo: file };
    lastTry.current = t;
    await sendMeal(t);
  }

  async function sendMeal(t: MealTry) {
    setBusy(true);
    setError(null);
    // Keeps the orbit already turning for this try; starts it again for Try again, or after Close.
    setRun((r) => (r?.kind === "meal" && r.state === "running" ? r : { kind: "meal", startedAt: clock(), state: "running" }));
    // One resend if the connection fails (net.ts); the key makes it safe.
    const sent = await postResending("/api/food", () => mealForm(t));
    const { res, data } = sent;
    setBusy(false);
    if (res?.status === 402) {
      // Out of meal logs: the refreshed page shows the paywall in place of the buttons.
      lastTry.current = null;
      setRun(null);
      setMode(null);
      return startTransition(() => router.refresh());
    }
    const l = res?.ok ? (data.log as LoggedMeal | undefined) : undefined;
    if (!l) {
      const f = sendFailure(sent);
      setRun((r) => (r ? { ...r, state: "error", error: f.message, detail: f.detail, retry: f.retry } : r));
      setErrorNote(f.detail ? { error: f.message, note: f.detail } : null);
      return setError(f.message);
    }
    lastTry.current = null;
    const logged: Log = {
      id: l.id, meal: l.meal, title: l.title, source: l.source, kcal: l.kcal, proteinG: l.proteinG, confidence: l.confidence,
      tip: l.micros?.tip ?? null, items: l.items.map((i) => `${i.name}, ${i.portion}`), demo: l.model === "mock",
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
    setError(null);
    setRun({ kind: "typical", startedAt: clock(), state: "running" });
    const description = typicalText;
    // Safe to send twice: it replaces the one saved usual day, and the server hands back a save
    // of the same words from moments ago instead of reading it again (saveTypicalDay).
    const sent = await postResending("/api/food/typical", () => JSON.stringify({ description }), { headers: { "content-type": "application/json" } });
    const { res, data } = sent;
    setTypicalBusy(false);
    const day = res?.ok ? (data.day as { patterns?: string[] } | undefined) : undefined;
    if (day) {
      setEditingTypical(false);
      setRun((r) => (r ? { ...r, state: "done", patterns: day.patterns ?? [] } : r));
      startTransition(() => router.refresh());
    } else {
      // A 4xx we don't name (too short, refused without a message) asks for more words.
      const f = sendFailure(sent, "Tell us a little more about a normal day, then save.", TYPICAL_ERRORS);
      setRun((r) => (r ? { ...r, state: "error", error: f.message, detail: f.detail, retry: f.retry } : r));
      setErrorNote(f.detail ? { error: f.message, note: f.detail } : null);
      setError(f.message);
    }
  }

  // After the screen's own reset to the top (ScrollReset), so this wins.
  useEffect(() => {
    if (focusUsual) document.getElementById("typical")?.scrollIntoView({ block: "start" });
  }, [focusUsual]);

  const sorted = [...logs].sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal));
  const kcalOver = overBy(totals.kcal, targets.kcal);

  return (
    // Laptops: today's ring and macros stay in view on the left while meals are logged on the
    // right, so each one lands where you can see it. One column on phones and tablets.
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:grid lg:max-w-6xl lg:grid-cols-12 lg:gap-x-12 lg:pt-12">
      {run && (
        <MealOrbit
          run={run}
          facts={facts}
          categories={categories}
          onClose={() => setRun(null)}
          onRetry={() => void (run.kind === "meal" ? retryMeal() : saveTypical())}
        />
      )}
      {voiceOk && !plan.mealBlock && (
        <SayCard
          handle={sayCard}
          words={text}
          setWords={setText}
          spoken={spoken}
          pickSpoken={pickSpoken}
          firstTime={saved == null}
          allowed={!aiOff}
          onLog={(words, lang) => {
            setHeardIn(lang);
            void submit(words, lang);
          }}
          onLeave={leaveSay}
        />
      )}
      <div className="lg:col-span-5">
        <div className="lg:sticky lg:top-20">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Fuel</h1>
            <Link href="/fuel/past" className="link-quiet min-h-11 shrink-0 whitespace-nowrap py-2 text-sm">
              Past meals
            </Link>
          </div>

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
        </div>
      </div>

      <div className="lg:col-span-7">
        {/* Log a meal */}
        <section className="mt-12 lg:mt-0" aria-labelledby="log">
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
                {/* Snap on phones and tablets, Photo on laptops (meal-photo.ts). */}
                <button
                  type="button"
                  onClick={openPhoto}
                  aria-busy={opening || undefined}
                  className={`flex min-h-24 flex-col items-start justify-between border p-4 text-left ${mode === "photo" ? "border-paper" : "border-line-strong"}`}
                >
                  <span className="text-lg font-bold semiwide">
                    <span className="hidden touch:inline">{PHOTO_COPY.snap.title}</span>
                    <span className="touch:hidden">{PHOTO_COPY.file.title}</span>
                  </span>
                  <span className="text-xs text-graphite">
                    {opening ? (
                      PHOTO_COPY.opening
                    ) : (
                      <>
                        <span className="hidden touch:inline">{PHOTO_COPY.snap.note}</span>
                        <span className="touch:hidden">{PHOTO_COPY.file.note}</span>
                      </>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("voice");
                    setPhotoTrouble(null);
                    // Open the card and start listening inside this tap: iPhone needs that.
                    if (voiceOk) sayCard.current?.open();
                  }}
                  className={`flex min-h-24 flex-col items-start justify-between border p-4 text-left ${mode === "voice" ? "border-paper" : "border-line-strong"}`}
                >
                  <span className="text-lg font-bold semiwide">Say</span>
                  <span className="text-xs text-graphite">Tell us what you ate</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("text");
                    setPhotoTrouble(null);
                  }}
                  className={`flex min-h-24 flex-col items-start justify-between border p-4 text-left ${mode === "text" ? "border-paper" : "border-line-strong"}`}
                >
                  <span className="text-lg font-bold semiwide">Type</span>
                  <span className="text-xs text-graphite">A few words is enough</span>
                </button>
              </div>
              {/* One tap from the tiles to the gallery, on phones and tablets. Laptops' photo tile already picks a file.
                  Gone once a photo is showing: the swap under it takes over. */}
              {!aiOff && !(mode === "photo" && photo) && (
                <button type="button" onClick={() => gallery.current?.click()} className="link-quiet mt-1 hidden min-h-11 items-center text-sm touch:inline-flex">
                  {PHOTO_COPY.gallery}
                </button>
              )}
              {trouble && !(mode === "photo" && photo) && (
                <p ref={revealProblem} role="alert" className={`error-mark mt-2 text-sm ${PROBLEM_CLEARANCE}`}>
                  {trouble}
                </p>
              )}
              <input ref={camera} type="file" accept={PHOTO_ACCEPT} capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={picked} />
              <input ref={gallery} type="file" accept={PHOTO_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={picked} />
              <p role="status" className="sr-only">
                {opening ? PHOTO_COPY.opening : ""}
              </p>

              {mode && (
                <div className="mt-5 space-y-4">
                  {mode === "photo" && photo && (
                    <div>
                      {/* Whole, not cropped: a screenshot or a tall plate shows as the AI will see it. */}
                      <div className="relative border border-line bg-lift">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt={PHOTO_COPY.alt}
                          className={`max-h-72 w-full object-contain transition-opacity motion-reduce:transition-none ${opening ? "opacity-30" : ""}`}
                        />
                        {opening && (
                          <p aria-hidden className="absolute inset-0 grid place-items-center text-sm font-semibold">
                            {PHOTO_COPY.opening}
                          </p>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-6">
                        <button type="button" onClick={() => camera.current?.click()} className="link-quiet hidden min-h-11 items-center text-sm touch:inline-flex">
                          {PHOTO_COPY.retake}
                        </button>
                        <button type="button" onClick={() => gallery.current?.click()} className="link-quiet hidden min-h-11 items-center text-sm touch:inline-flex">
                          {PHOTO_COPY.regallery}
                        </button>
                        <button type="button" onClick={() => gallery.current?.click()} className="link-quiet inline-flex min-h-11 items-center text-sm touch:hidden">
                          {PHOTO_COPY.another}
                        </button>
                      </div>
                      {trouble && (
                        <p ref={revealProblem} role="alert" className={`error-mark mt-1 text-sm ${PROBLEM_CLEARANCE}`}>
                          {trouble}
                        </p>
                      )}
                    </div>
                  )}
                  {mode === "voice" && !voiceOk && <p className="text-sm text-graphite">This browser can&apos;t listen. Use the mic on your keyboard in the box below instead.</p>}
                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-sm text-graphite">
                      {mode === "photo" ? "Anything the photo won't show? (optional)" : mode === "voice" ? "What you said" : "What did you eat?"}
                    </span>
                    <textarea
                      ref={box}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      maxLength={MEAL_WORDS_MAX}
                      dir="auto"
                      lang={mode === "voice" && heardIn ? (spokenById(heardIn).translateFrom ?? undefined) : undefined}
                      className="textarea"
                      placeholder={mode === "photo" ? "e.g. cooked in ghee, 2 rotis under the dal" : "e.g. 2 rotis, dal, bhindi sabzi and a katori of curd"}
                    />
                  </label>
                  {mode === "voice" && voiceOk && (
                    // Reopens the card; what it hears goes after these words.
                    <button type="button" onClick={() => sayCard.current?.open()} className="button-ghost h-11">
                      {SAY_COPY.talkAgain}
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
                    <button
                      type="button"
                      onClick={() => void submit()}
                      disabled={busy || (!text.trim() && !(mode === "photo" && photo))}
                      className="button-primary h-13 flex-1 sm:flex-none sm:px-10"
                    >
                      {busy ? "Reading your meal…" : "Log this meal"}
                    </button>
                    <button
                      type="button"
                      className="button-ghost h-13"
                      onClick={() => {
                        setMode(null);
                        setPhoto(null);
                        setText("");
                        setHeardIn(null);
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
          {error && errorNote?.error === error && <p className="mt-1 text-xs text-graphite">{errorNote.note}</p>}

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
              {ask && <AskAbout prefill={mealPrefill(last)} label={ASK_COPY.aboutMeal} className="mt-2" />}
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
                <MealRow key={l.id} meal={l} deleting={removing === l.id} disabled={!!removing} onDelete={() => remove(l.id)} />
              ))}
            </ul>
          )}
          {sorted.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-graphite">Micronutrients today, as a share of your daily need; vitamin D in IU</h3>
              <p className="mt-1 text-sm text-graphite">This is today so far. Your stack goes by your average across days, not one meal.</p>
              <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                {micros.map((m) => (
                  <li key={m.label}>
                    <div className="flex justify-between text-sm">
                      <span>{m.label}</span>
                      <span className="text-graphite">{"iu" in m ? `${m.iu} IU` : `${m.pct}%`}</span>
                    </div>
                    {"iu" in m ? (
                      <p className="mt-1 text-xs text-graphite">Most vitamin D comes from sun; a blood test shows your level.</p>
                    ) : (
                      <div className="mt-1 h-1 bg-line" aria-hidden>
                        <div className="h-1 bg-paper" style={{ width: `${Math.min(100, m.pct)}%` }} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {stackReady && (
          <section className="mt-10 border border-line-strong p-5" aria-labelledby="stack-ready">
            <h2 id="stack-ready" className="text-xl font-bold semiwide">
              Your meals are enough for a stack
            </h2>
            <p className="mt-2 text-graphite">See what your food runs short of, measured against your body and training. No report needed.</p>
            <Link href="/stack" className="button-ghost mt-4 h-12">
              Build my stack
            </Link>
          </section>
        )}

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
            {ask && <AskAbout prefill={gapsPrefill(ASK_COPY.gapsChip)} label={ASK_COPY.aboutGaps} className="mt-2" />}
          </section>
        )}

        {/* Typical day */}
        <section className="mt-12 border border-line-strong p-5" aria-labelledby="typical">
          <h2 id="typical" className="text-2xl font-bold semiwide">
            How you usually eat
          </h2>
          {typical?.short && <p className="mt-2 text-sm text-graphite">This looks lighter than a full day, so your stack doesn&apos;t use it yet.</p>}
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
      </div>
    </main>
  );
}
