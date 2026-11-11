"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACTIVITIES, CONDITIONS, DIETS, GOALS, LANGUAGES, LEVELS, SEXES } from "@/lib/domain/options";
import type { PlanView } from "@/lib/domain/plan";
import { birthYearOk, MIN_AGE } from "./age";
import { OFFLINE, send } from "./net";
import { PlanCard, type PaidPass } from "./Paywall";

type P = {
  name: string; birthYear: string; sex: string | null; heightCm: string; weightKg: string; city: string;
  activities: string[]; primaryActivity: string | null; level: string | null; sessionsPerWeek: number | null;
  goals: string[]; eventInMind: string; diet: string | null; conditions: string[]; medications: string;
  currentSupplements: string; language: string;
};

function Chips({ name, options, value, multi, onChange, max }: { name: string; options: readonly { id: string; label: string }[]; value: string[] | string | null; multi?: boolean; onChange: (v: string) => void; max?: number }) {
  const has = (id: string) => (Array.isArray(value) ? value.includes(id) : value === id);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.id} className="choice">
          <input
            type={multi ? "checkbox" : "radio"}
            name={name}
            className="sr-only"
            checked={has(o.id)}
            disabled={multi && max != null && !has(o.id) && Array.isArray(value) && value.length >= max}
            onChange={() => onChange(o.id)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-5">
      <p className="mb-3 text-sm font-semibold">{label}</p>
      {children}
    </div>
  );
}

export function Settings({ email, profile, plan, passes }: { email: string; profile: P; plan: PlanView; passes: PaidPass[] }) {
  const router = useRouter();
  const [p, setP] = useState(profile);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [del, setDel] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const set = <K extends keyof P>(k: K, v: P[K]) => {
    setSaved("idle");
    setP((c) => ({ ...c, [k]: v }));
  };
  const toggle = (k: "activities" | "goals" | "conditions", v: string) =>
    set(k, p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v]);

  async function save() {
    const fail = (why: string) => {
      setSaved("error");
      setProblem(why);
    };
    if (p.birthYear && !(/^\d{4}$/.test(p.birthYear) && birthYearOk(+p.birthYear))) return fail(`Check the year of birth: four digits, and D-Human is for adults, ${MIN_AGE} and over.`);
    setSaved("saving");
    setProblem(null);
    const primary = p.activities.includes(p.primaryActivity ?? "") ? p.primaryActivity : p.activities[0] ?? null;
    const r = await send<{ issues: string[] }>("/api/profile", {
      body: {
        name: p.name.trim() || null,
        birthYear: p.birthYear ? +p.birthYear : null,
        sex: p.sex,
        heightCm: p.heightCm ? +p.heightCm : null,
        weightKg: p.weightKg ? +p.weightKg : null,
        city: p.city.trim() || null,
        activities: p.activities,
        primaryActivity: primary,
        level: p.level,
        sessionsPerWeek: p.sessionsPerWeek,
        goals: p.goals.slice(0, 3),
        eventInMind: p.eventInMind.trim() || null,
        diet: p.diet,
        conditions: p.conditions,
        medications: p.medications.trim() || null,
        currentSupplements: p.currentSupplements.trim() || null,
        language: p.language,
      },
    });
    if (r.ok) {
      setSaved("saved");
      return router.refresh();
    }
    const bad = r.data.issues ?? [];
    fail(
      r.offline
        ? `Not saved. ${OFFLINE} Your changes are still here.`
        : r.status === 429
          ? "That's a lot of saves. Wait a few minutes, then try again."
          : bad.includes("birthYear")
            ? `Check the year of birth. D-Human is for adults, ${MIN_AGE} and over.`
            : bad.some((k) => k === "heightCm" || k === "weightKg")
              ? "Check height (100 to 250 cm) and weight (25 to 300 kg)."
              : "Couldn't save. Check your answers and try again.",
    );
  }

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    const r = await send("/api/auth/signout");
    if (!r.ok) {
      setSigningOut(false);
      return setSignOutError(r.offline ? `You're still signed in. ${OFFLINE}` : "You're still signed in. Try again.");
    }
    router.replace("/signin");
    router.refresh();
  }

  async function deleteAll() {
    setDeleting(true);
    setDeleteError(null);
    const r = await send("/api/account/delete", { body: { confirm: del } });
    if (!r.ok) {
      setDeleting(false);
      // Never let a failed delete of health data look like it worked.
      return setDeleteError(r.offline ? `Nothing was deleted. ${OFFLINE}` : "Nothing was deleted. Try again in a minute.");
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-8 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">You</h1>
      <p className="mt-2 text-graphite">Signed in as {email}</p>

      <PlanCard plan={plan} passes={passes} />

      <section className="mt-10" aria-label="Profile">
        <Field label="Name">
          <input className="field h-12" value={p.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Born and sex at birth">
          <div className="flex flex-wrap items-center gap-3">
            <input className="field h-12 w-28" inputMode="numeric" maxLength={4} value={p.birthYear} onChange={(e) => set("birthYear", e.target.value.replace(/\D/g, ""))} aria-label="Year of birth" />
            <Chips name="sex" options={SEXES} value={p.sex} onChange={(v) => set("sex", v)} />
          </div>
        </Field>
        <Field label="Height and weight">
          <div className="flex gap-3">
            <label className="flex items-center gap-2">
              <input className="field h-12 w-24" inputMode="decimal" value={p.heightCm} onChange={(e) => set("heightCm", e.target.value.replace(/[^\d.]/g, ""))} />
              <span className="text-sm text-graphite">cm</span>
            </label>
            <label className="flex items-center gap-2">
              <input className="field h-12 w-24" inputMode="decimal" value={p.weightKg} onChange={(e) => set("weightKg", e.target.value.replace(/[^\d.]/g, ""))} />
              <span className="text-sm text-graphite">kg</span>
            </label>
          </div>
        </Field>
        <Field label="Town or city">
          <input className="field h-12" value={p.city} maxLength={80} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="How you move">
          <Chips name="activities" multi options={ACTIVITIES} value={p.activities} onChange={(v) => toggle("activities", v)} />
          {p.activities.length > 1 && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-graphite">Matters most</p>
              <Chips name="primary" options={ACTIVITIES.filter((a) => p.activities.includes(a.id))} value={p.primaryActivity} onChange={(v) => set("primaryActivity", v)} />
            </div>
          )}
        </Field>
        <Field label="How seriously">
          <Chips name="level" options={LEVELS} value={p.level} onChange={(v) => set("level", v)} />
        </Field>
        <Field label="Goals (up to three)">
          <Chips name="goals" multi max={3} options={GOALS} value={p.goals} onChange={(v) => toggle("goals", v)} />
        </Field>
        <Field label="Event in mind">
          <input className="field h-12" value={p.eventInMind} maxLength={120} onChange={(e) => set("eventInMind", e.target.value)} placeholder="e.g. HYROX Mumbai" />
        </Field>
        <Field label="How you eat">
          <Chips name="diet" options={DIETS} value={p.diet} onChange={(v) => set("diet", v)} />
        </Field>
        <Field label="Health">
          <Chips name="conditions" multi options={CONDITIONS} value={p.conditions} onChange={(v) => toggle("conditions", v)} />
          <input className="field mt-3 h-12" value={p.medications} maxLength={400} onChange={(e) => set("medications", e.target.value)} placeholder="Medicines you take" aria-label="Medicines you take" />
          <input className="field mt-3 h-12" value={p.currentSupplements} maxLength={400} onChange={(e) => set("currentSupplements", e.target.value)} placeholder="Supplements you take now" aria-label="Supplements you take now" />
        </Field>
        <Field label="Language for your reads">
          <Chips name="language" options={LANGUAGES} value={p.language} onChange={(v) => set("language", v)} />
        </Field>
        <div className="sticky bottom-20 z-10 flex items-center gap-4 border-t border-line bg-ink py-4 lg:bottom-0">
          <button type="button" onClick={save} disabled={saved === "saving"} className="button-primary h-12 px-8">
            {saved === "saving" ? "Saving…" : "Save changes"}
          </button>
          <span role="status" className={saved === "error" ? "error-mark text-sm" : "text-sm text-graphite"}>
            {saved === "saved" ? "Saved. New reads use these answers." : saved === "error" ? problem : ""}
          </span>
        </div>
      </section>

      <section className="mt-14 border-t border-line pt-6">
        <button type="button" onClick={signOut} disabled={signingOut} className="button-ghost h-12">
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        {signOutError && (
          <p role="alert" className="error-mark mt-3 text-sm">
            {signOutError}
          </p>
        )}
      </section>

      <section className="mt-14 border border-line-strong p-5" aria-labelledby="delete">
        <h2 id="delete" className="text-xl font-bold semiwide">
          Delete everything
        </h2>
        <p className="mt-2 text-sm text-graphite">Your account, reports, files, markers, food log, wraps, stacks and any pass you&apos;ve paid for are erased for good. Type DELETE to confirm.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <input className="field h-12 w-40" value={del} onChange={(e) => setDel(e.target.value)} aria-label="Type DELETE to confirm" autoComplete="off" />
          <button type="button" disabled={del !== "DELETE" || deleting} onClick={deleteAll} className="button-primary h-12">
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
        {deleteError && (
          <p role="alert" className="error-mark mt-3 text-sm">
            {deleteError}
          </p>
        )}
      </section>
    </main>
  );
}
