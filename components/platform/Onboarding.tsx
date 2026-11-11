"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Wordmark } from "@/components/brand/Logo";
import { ACTIVITIES, CONDITIONS, DIETS, GOALS, LANGUAGES, LEVELS, SEXES, labelOf } from "@/lib/domain/options";
import { personaOf } from "@/lib/domain/persona";
import { birthYearOk, MIN_AGE } from "./age";
import { Bib } from "./Bib";
import { send } from "./net";

export type Draft = {
  name: string;
  birthYear: string;
  sex: string | null;
  heightCm: string;
  weightKg: string;
  city: string;
  activities: string[];
  primaryActivity: string | null;
  level: string | null;
  sessionsPerWeek: number | null;
  goals: string[];
  eventInMind: string;
  diet: string | null;
  conditions: string[];
  medications: string;
  currentSupplements: string;
  language: string;
  consent: boolean;
};

const EMPTY: Draft = {
  name: "", birthYear: "", sex: null, heightCm: "", weightKg: "", city: "", activities: [], primaryActivity: null,
  level: null, sessionsPerWeek: null, goals: [], eventInMind: "", diet: null, conditions: [], medications: "",
  currentSupplements: "", language: "en", consent: false,
};

const thisYear = new Date().getFullYear();
const NO_EVENTS = new Set(["yoga", "starting"]);
// D-Human is for adults. A birth year can't prove 18 to the day, so consent also asks.
const yearOk = (y: string) => /^\d{4}$/.test(y) && birthYearOk(+y, thisYear);
function yearProblem(y: string) {
  if (!y || yearOk(y)) return null;
  if (y.length < 4) return y.length === 2 ? "Use all four digits, like 1994." : null;
  if (+y > thisYear - MIN_AGE && +y <= thisYear) return `D-Human is for adults, so you need to be ${MIN_AGE} or over.`;
  return "Check the year: four digits, like 1994.";
}

type Step = {
  id: string;
  ask: (d: Draft) => string;
  help?: string;
  ok: (d: Draft) => boolean;
  skip?: (d: Draft) => boolean;
  optional?: boolean;
};

// Consent comes first, so nothing about your health is saved before you've
// agreed. Then the language, so every question after it is in context.
const STEPS: Step[] = [
  { id: "consent", ask: () => "Your data stays yours.", help: "Before any questions, here's what we do with your answers.", ok: (d) => d.consent },
  {
    id: "language", ask: () => "Which language for your reads?",
    help: "Your report reads, food notes and wraps will be written in it. Buttons and labels stay in English for now.",
    ok: (d) => !!d.language,
  },
  { id: "name", ask: () => "What should we call you?", help: "Your first name is enough. It goes on your bib.", ok: (d) => d.name.trim().length > 0 },
  {
    id: "born", ask: (d) => `${d.name.trim() || "Hi"}, when were you born?`,
    help: "Year and sex at birth set the right lab ranges for you. Haemoglobin, ferritin and more differ by sex.",
    ok: (d) => yearOk(d.birthYear) && !!d.sex,
  },
  { id: "body", ask: () => "Height and weight?", help: "Used for your protein and calorie targets. Skip if you'd rather not.", ok: (d) => validBody(d), optional: true },
  { id: "city", ask: () => "Where are you based?", help: "Your town or city. We use it to find events near you.", ok: (d) => d.city.trim().length > 1 },
  { id: "move", ask: () => "How do you move?", help: "Pick everything you do. Not much yet is a fine answer.", ok: (d) => d.activities.length > 0 },
  { id: "main", ask: () => "Which one matters most?", help: "Your bib, your metrics and your verdict lean towards this one.", ok: (d) => !!d.primaryActivity, skip: (d) => d.activities.length < 2 },
  { id: "level", ask: () => "How seriously?", ok: (d) => !!d.level, skip: (d) => primary(d) === "starting" },
  { id: "goals", ask: () => "What are you after?", help: "Up to three.", ok: (d) => d.goals.length > 0 },
  {
    id: "event", ask: (d) => `Got a ${eventWord(primary(d))} in mind?`,
    help: "Name it if you have one, like “HYROX Mumbai” or “Hampta Pass”. We'll find dates and aim your verdict at it.",
    ok: () => true, optional: true, skip: (d) => NO_EVENTS.has(primary(d) ?? ""),
  },
  { id: "diet", ask: () => "How do you eat?", ok: (d) => !!d.diet },
  { id: "health", ask: () => "Anything we should know?", help: "All optional. It keeps suggestions safe for you.", ok: () => true, optional: true },
];

function validBody(d: Draft) {
  const h = d.heightCm ? +d.heightCm : null;
  const w = d.weightKg ? +d.weightKg : null;
  return (h == null || (h >= 100 && h <= 250)) && (w == null || (w >= 25 && w <= 300));
}
// Saves the answers so far. Never before consent: until then nothing leaves the phone.
function progressBody(d: Draft) {
  if (!d.consent) return null;
  const year = yearOk(d.birthYear) ? +d.birthYear : null;
  return {
    consent: true as const,
    name: d.name.trim() || null,
    birthYear: year,
    sex: d.sex,
    ...(validBody(d) ? { heightCm: d.heightCm ? +d.heightCm : null, weightKg: d.weightKg ? +d.weightKg : null } : {}),
    city: d.city.trim() || null,
    activities: d.activities,
    primaryActivity: d.primaryActivity,
    level: d.level,
    sessionsPerWeek: d.sessionsPerWeek,
    goals: d.goals.slice(0, 3),
    eventInMind: d.eventInMind.trim() || null,
    diet: d.diet,
    conditions: d.conditions,
    medications: d.medications.trim() || null,
    currentSupplements: d.currentSupplements.trim() || null,
    language: d.language,
  };
}

const primary = (d: Draft) => d.primaryActivity ?? d.activities[0] ?? null;
const eventWord = (a: string | null) =>
  ({ running: "race", hyrox: "race", trekking: "trek or trip", cycling: "ride", swimming: "swim", team: "tournament", walking: "walk" })[a ?? ""] ?? "event";

export function Onboarding({ initial }: { initial: Partial<Draft> }) {
  const [d, setD] = useState<Draft>({ ...EMPTY, ...initial });
  const [i, setI] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastSaved = useRef<string | null>(null);

  function saveProgress() {
    const body = progressBody(d);
    if (!body) return;
    const text = JSON.stringify(body);
    if (text === lastSaved.current) return; // nothing new since the last save
    lastSaved.current = text;
    void send("/api/profile", { body, keepalive: true }).then((r) => {
      if (!r.ok) lastSaved.current = null; // try again on the next step
    });
  }

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [i]);

  const step = STEPS[i];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const toggle = (k: "activities" | "goals" | "conditions", v: string, max = 10) =>
    setD((cur) => {
      const list = cur[k].includes(v) ? cur[k].filter((x) => x !== v) : [...cur[k], v].slice(-max);
      const next = { ...cur, [k]: list };
      if (k === "activities") {
        if (v === "starting" && list.includes("starting")) next.activities = ["starting"];
        else next.activities = list.filter((x) => x !== "starting" || list.length === 1);
        if (!next.activities.includes(next.primaryActivity ?? "")) next.primaryActivity = next.activities.length === 1 ? next.activities[0] : null;
      }
      return next;
    });

  const visible = useMemo(() => STEPS.map((s, idx) => ({ s, idx })).filter(({ s }) => !s.skip?.(d)), [d]);
  const pos = visible.findIndex((v) => v.idx === i);

  function go(dir: 1 | -1) {
    setError(null);
    // Each answer is saved as you go, so a closed tab or a new phone picks up where you left off.
    if (dir === 1) saveProgress();
    let j = i + dir;
    while (j >= 0 && j < STEPS.length && STEPS[j].skip?.(d)) j += dir;
    if (j < 0) return;
    if (j >= STEPS.length) return finish();
    setI(j);
  }

  async function finish() {
    setSaving(true);
    setError(null);
    const p = primary(d);
    const body = {
      name: d.name.trim(),
      birthYear: +d.birthYear,
      sex: d.sex,
      heightCm: d.heightCm ? +d.heightCm : null,
      weightKg: d.weightKg ? +d.weightKg : null,
      city: d.city.trim(),
      country: "India",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      activities: d.activities,
      primaryActivity: p,
      level: p === "starting" ? "starting" : d.level,
      sessionsPerWeek: d.sessionsPerWeek,
      goals: d.goals,
      eventInMind: d.eventInMind.trim() || null,
      diet: d.diet,
      conditions: d.conditions,
      medications: d.medications.trim() || null,
      currentSupplements: d.currentSupplements.trim() || null,
      language: d.language,
      consent: true,
      complete: true,
    };
    const r = await send<{ issues: string[] }>("/api/profile", { body });
    setSaving(false);
    if (r.offline) return setError("No connection. Your answers are safe on this screen. Try again.");
    if (r.status === 429) return setError("That's a lot of saves. Wait a few minutes, then try again.");
    if (!r.ok) {
      const bad = r.data.issues ?? [];
      return setError(
        bad.includes("birthYear") ? `Check your year of birth. D-Human is for adults, ${MIN_AGE} and over.` : "We couldn't save that. Check your answers and try again.",
      );
    }
    setDone(true);
  }

  if (done) {
    const persona = personaOf({ name: d.name, birthYear: +d.birthYear, primaryActivity: primary(d), activities: d.activities, level: d.level, goals: d.goals });
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-8">
        <p className="text-graphite">Here&apos;s your bib, {persona.firstName}.</p>
        <Bib
          className="mt-6"
          number={persona.bib}
          name={persona.firstName}
          label={persona.label}
          archetype={persona.archetype}
          next={d.eventInMind.trim() ? `Aiming at ${d.eventInMind.trim()}` : "Next: your first blood report"}
          nextDetail="Upload a report and your bib gets its verdict."
        />
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Link href="/upload" className="button-primary h-13">
            Upload a blood report
          </Link>
          <Link href="/home" className="button-ghost h-13">
            Go to my dashboard
          </Link>
        </div>
      </main>
    );
  }

  const canGo = step.ok(d);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pb-6 pt-5">
      <div className="flex items-center justify-between">
        <Wordmark className="h-3 w-auto" />
        <span className="text-sm text-graphite">
          {pos + 1} of {visible.length}
        </span>
      </div>
      <div className="mt-4 h-px bg-line" aria-hidden>
        <div className="h-px bg-paper transition-[width] duration-500" style={{ width: `${((pos + 1) / visible.length) * 100}%` }} />
      </div>

      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (canGo) go(1);
        }}
      >
        <div key={step.id} className="fact-in pt-12 sm:pt-16">
          <h1 ref={heading} tabIndex={-1} className="headline text-[clamp(2rem,7vw,3rem)] outline-none">
            {step.ask(d)}
          </h1>
          {step.help && <p className="mt-3 max-w-prose text-graphite">{step.help}</p>}
          <div className="mt-8">
            <StepBody id={step.id} d={d} set={set} toggle={toggle} />
          </div>
        </div>

        <div className="mt-auto pt-10">
          {error && (
            <p role="alert" className="error-mark mb-3 text-sm">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            {pos > 0 && (
              <button type="button" onClick={() => go(-1)} className="button-ghost h-13 px-5">
                Back
              </button>
            )}
            <button type="submit" disabled={!canGo || saving} className="button-primary h-13 flex-1">
              {saving ? "Saving…" : step.id === "consent" ? "Agree and continue" : i === STEPS.length - 1 ? "Finish" : step.optional && isBlankOptional(step.id, d) ? "Skip" : "Continue"}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}

function isBlankOptional(id: string, d: Draft) {
  if (id === "body") return !d.heightCm && !d.weightKg;
  if (id === "event") return !d.eventInMind.trim();
  if (id === "health") return !d.conditions.length && !d.medications.trim() && !d.currentSupplements.trim();
  return false;
}

function Choice({ checked, onChange, type = "checkbox", name, children, hint }: { checked: boolean; onChange: () => void; type?: "checkbox" | "radio"; name: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="choice min-h-13 w-full justify-between gap-3 py-2 sm:w-auto sm:justify-start">
      <input type={type} name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span className="font-semibold">{children}</span>
      {hint && <span className="text-sm opacity-60">{hint}</span>}
    </label>
  );
}

function StepBody({
  id,
  d,
  set,
  toggle,
}: {
  id: string;
  d: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  toggle: (k: "activities" | "goals" | "conditions", v: string, max?: number) => void;
}) {
  switch (id) {
    case "name":
      return <input autoFocus autoComplete="given-name" enterKeyHint="next" maxLength={60} value={d.name} onChange={(e) => set("name", e.target.value)} className="field h-14 text-xl" aria-label="Your name" />;
    case "born":
      return (
        <div className="space-y-6">
          <div>
            <input
              inputMode="numeric"
              autoComplete="bday-year"
              placeholder={`e.g. ${thisYear - 32}`}
              maxLength={4}
              value={d.birthYear}
              onChange={(e) => set("birthYear", e.target.value.replace(/\D/g, ""))}
              className="field h-14 text-xl"
              aria-label="Year of birth"
              aria-invalid={yearProblem(d.birthYear) ? true : undefined}
              aria-describedby="born-problem"
            />
            <p id="born-problem" aria-live="polite" className={yearProblem(d.birthYear) ? "error-mark mt-2 text-sm" : "sr-only"}>
              {yearProblem(d.birthYear)}
            </p>
          </div>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-sm text-graphite">Sex at birth</legend>
            {SEXES.map((s) => (
              <Choice key={s.id} type="radio" name="sex" checked={d.sex === s.id} onChange={() => set("sex", s.id)}>
                {s.label}
              </Choice>
            ))}
          </fieldset>
        </div>
      );
    case "body":
      return (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-2 block text-sm text-graphite">Height (cm)</span>
            <input inputMode="decimal" value={d.heightCm} onChange={(e) => set("heightCm", e.target.value.replace(/[^\d.]/g, ""))} className="field h-14 text-xl" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-graphite">Weight (kg)</span>
            <input inputMode="decimal" value={d.weightKg} onChange={(e) => set("weightKg", e.target.value.replace(/[^\d.]/g, ""))} className="field h-14 text-xl" />
          </label>
          <p aria-live="polite" className={validBody(d) ? "sr-only" : "error-mark col-span-2 text-sm"}>
            {validBody(d) ? "" : "Height in centimetres (100 to 250, like 168) and weight in kilograms (25 to 300)."}
          </p>
        </div>
      );
    case "city":
      return <input autoComplete="address-level2" placeholder="e.g. Indore" maxLength={80} value={d.city} onChange={(e) => set("city", e.target.value)} className="field h-14 text-xl" aria-label="Town or city" />;
    case "move":
      return (
        <div className="flex flex-wrap gap-2">
          {ACTIVITIES.map((a) => (
            <Choice key={a.id} name="activities" checked={d.activities.includes(a.id)} onChange={() => toggle("activities", a.id)} hint={a.hint}>
              {a.label}
            </Choice>
          ))}
        </div>
      );
    case "main":
      return (
        <div className="flex flex-wrap gap-2">
          {d.activities.map((a) => (
            <Choice key={a} type="radio" name="primary" checked={d.primaryActivity === a} onChange={() => set("primaryActivity", a)}>
              {labelOf(ACTIVITIES, a)}
            </Choice>
          ))}
        </div>
      );
    case "level":
      return (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <Choice key={l.id} type="radio" name="level" checked={d.level === l.id} onChange={() => set("level", l.id)} hint={l.hint}>
                {l.label}
              </Choice>
            ))}
          </div>
          <label className="block">
            <span className="mb-2 block text-sm text-graphite">Sessions a week (optional)</span>
            <input inputMode="numeric" maxLength={2} value={d.sessionsPerWeek ?? ""} onChange={(e) => set("sessionsPerWeek", e.target.value ? Math.min(21, +e.target.value.replace(/\D/g, "")) : null)} className="field h-14 w-32 text-xl" />
          </label>
        </div>
      );
    case "goals":
      return (
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <Choice key={g.id} name="goals" checked={d.goals.includes(g.id)} onChange={() => toggle("goals", g.id, 3)}>
              {g.label}
            </Choice>
          ))}
        </div>
      );
    case "event":
      return <input maxLength={120} placeholder="Leave blank if not yet" value={d.eventInMind} onChange={(e) => set("eventInMind", e.target.value)} className="field h-14 text-xl" aria-label="Event in mind" />;
    case "diet":
      return (
        <div className="flex flex-wrap gap-2">
          {DIETS.map((x) => (
            <Choice key={x.id} type="radio" name="diet" checked={d.diet === x.id} onChange={() => set("diet", x.id)}>
              {x.label}
            </Choice>
          ))}
        </div>
      );
    case "health":
      return (
        <div className="space-y-6">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-sm text-graphite">Conditions you&apos;ve been told about</legend>
            {CONDITIONS.map((c) => (
              <Choice key={c.id} name="conditions" checked={d.conditions.includes(c.id)} onChange={() => toggle("conditions", c.id)}>
                {c.label}
              </Choice>
            ))}
          </fieldset>
          <label className="block">
            <span className="mb-2 block text-sm text-graphite">Medicines you take</span>
            <input maxLength={400} value={d.medications} onChange={(e) => set("medications", e.target.value)} className="field h-13" placeholder="e.g. thyroxine 50 mcg" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-graphite">Supplements you take now</span>
            <input maxLength={400} value={d.currentSupplements} onChange={(e) => set("currentSupplements", e.target.value)} className="field h-13" placeholder="e.g. vitamin D 60K weekly, whey" />
          </label>
        </div>
      );
    case "language":
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          {LANGUAGES.map((l) => (
            <label key={l.id} className="choice min-h-20 flex-col items-start justify-center gap-1 py-3">
              <input type="radio" name="language" checked={d.language === l.id} onChange={() => set("language", l.id)} className="sr-only" />
              <span className="text-lg font-bold">{l.label}</span>
              <span className="text-sm opacity-70">{l.sample}</span>
            </label>
          ))}
        </div>
      );
    case "consent":
      return (
        <div className="space-y-5 text-[0.9375rem]">
          <ul className="space-y-3 text-graphite">
            <li>D-Human is for adults, {MIN_AGE} and over.</li>
            <li>We use your reports and answers only to give you your reads, your food notes and your stack.</li>
            <li>
              Claude, an AI model made by Anthropic, reads your reports and meals for us. That processing happens outside India, on Anthropic&apos;s
              servers.
            </li>
            <li>We don&apos;t sell your data or share it with brands.</li>
            <li>Reads are AI, not a diagnosis. When a marker needs a doctor, we say so.</li>
            <li>You can delete everything, any time, from Settings.</li>
          </ul>
          <label className="choice min-h-14 w-full gap-3 py-3">
            <input type="checkbox" checked={d.consent} onChange={() => set("consent", !d.consent)} className="sr-only" />
            <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center border border-current text-xs">
              {d.consent ? "✓" : ""}
            </span>
            <span className="font-semibold">I&apos;m {MIN_AGE} or over, and I agree to D-Human processing my health data this way.</span>
          </label>
        </div>
      );
  }
  return null;
}
