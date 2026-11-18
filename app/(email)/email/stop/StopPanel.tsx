"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { send } from "@/components/platform/net";
import type { EmailCategory } from "@/lib/email/types";

// The stop page's body. Every action is a real form posting to /api/email/prefs, so it
// works without JavaScript (the server answers 303 back here). With JavaScript the page
// stops the email itself once it is showing on screen, so one tap in the email is enough;
// opening the link alone (what mail scanners do) changes nothing, because the server
// render only reads.

type Prefs = { weekly: boolean; questions: boolean; weeklyPaused: boolean };
type Phase = "ready" | "stopping" | "stopped" | "restarted";

const COPY: Record<EmailCategory, { label: string; hint: string; confirm: string; done: string; after: string; back: string }> = {
  weekly: {
    label: "Weekly wrap",
    hint: "Sunday evenings, only after a week with something in it.",
    confirm: "Stop weekly wraps",
    done: "Done. No more weekly wraps by email.",
    after: "Your wraps are still in the app whenever you want them.",
    back: "Weekly wraps are back on.",
  },
  questions: {
    label: "Questions from the team",
    hint: "A few taps, at most once every 3 months.",
    confirm: "Stop questions from the team",
    done: "Done. No more questions from the team.",
    after: "You can still tell us what to build from Settings, any time.",
    back: "Questions from the team are back on.",
  },
};

const OTHER: Record<EmailCategory, EmailCategory> = { weekly: "questions", questions: "weekly" };

function PrefForm({
  token,
  changes,
  onSubmit,
  disabled,
  className,
  label,
  children,
}: {
  token: string;
  changes: Partial<Record<EmailCategory, boolean>>;
  onSubmit: (changes: Partial<Record<EmailCategory, boolean>>) => void;
  disabled?: boolean;
  className: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      method="post"
      action="/api/email/prefs"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(changes);
      }}
    >
      <input type="hidden" name="t" value={token} />
      {Object.entries(changes).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v ? "on" : "off"} />
      ))}
      <button type="submit" className={className} disabled={disabled} aria-label={label}>
        {children}
      </button>
    </form>
  );
}

export function StopPanel({ token, category, initial }: { token: string; category: EmailCategory; initial: Prefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [phase, setPhase] = useState<Phase>(initial[category] ? "ready" : "stopped");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const copy = COPY[category];
  const other = OTHER[category];

  async function change(changes: Partial<Record<EmailCategory, boolean>>, next?: Phase) {
    const before = phase;
    setBusy(true);
    setFailed(false);
    if (next === "stopped") setPhase("stopping");
    const r = await send<Prefs>("/api/email/prefs", { body: { t: token, ...changes } });
    setBusy(false);
    if (!r.ok || typeof r.data.weekly !== "boolean" || typeof r.data.questions !== "boolean") {
      // Nothing changed: show where they were, with the button to try again.
      setPhase(before === "stopping" ? "ready" : before);
      setFailed(true);
      return;
    }
    setPrefs({ weekly: r.data.weekly, questions: r.data.questions, weeklyPaused: Boolean(r.data.weeklyPaused) });
    if (next) setPhase(next);
  }

  // Stop on arrival, but only once the page is actually on screen: a tab opened in the
  // background waits until someone looks at it.
  useEffect(() => {
    if (!initial[category] || started.current) return;
    const go = () => {
      if (started.current || document.visibilityState !== "visible") return;
      started.current = true;
      document.removeEventListener("visibilitychange", go);
      void change({ [category]: false }, "stopped");
    };
    document.addEventListener("visibilitychange", go);
    go();
    return () => document.removeEventListener("visibilitychange", go);
    // Runs once for the page's first settings; later changes come from the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heading = phase === "stopped" ? copy.done : phase === "restarted" ? copy.back : phase === "stopping" ? "Stopping…" : copy.confirm;
  // A paused weekly email counts as off here; turning it on clears the pause.
  const otherOn = prefs[other] && !(other === "weekly" && prefs.weeklyPaused);

  return (
    <div>
      <h1 className="headline text-[clamp(2rem,7vw,2.75rem)]" aria-live="polite">
        {heading}
      </h1>

      {phase === "ready" && (
        <div className="mt-6">
          <p className="text-graphite">One tap and it stops. Nothing else about your account changes.</p>
          <div className="mt-6">
            <PrefForm token={token} changes={{ [category]: false }} onSubmit={(c) => change(c, "stopped")} disabled={busy} className="button-primary h-13 w-full">
              {copy.confirm}
            </PrefForm>
          </div>
        </div>
      )}

      {phase === "stopped" && (
        <div className="mt-6">
          <p className="text-graphite">{copy.after}</p>
          <div className="mt-6">
            <PrefForm token={token} changes={{ [category]: true }} onSubmit={(c) => change(c, "restarted")} disabled={busy} className="button-ghost h-11" label={`Undo: keep getting ${copy.label.toLowerCase()} emails`}>
              Undo
            </PrefForm>
          </div>
        </div>
      )}

      {phase === "restarted" && (
        <div className="mt-6">
          <p className="text-graphite">{copy.hint}</p>
          <div className="mt-6">
            <PrefForm token={token} changes={{ [category]: false }} onSubmit={(c) => change(c, "stopped")} disabled={busy} className="button-ghost h-11">
              {copy.confirm}
            </PrefForm>
          </div>
        </div>
      )}

      {failed && (
        <p role="alert" className="error-mark mt-4 text-sm">
          We couldn&apos;t save that. Check your connection and try again.
        </p>
      )}

      <section className="mt-12 border-t border-line pt-6" aria-labelledby="other-emails">
        <h2 id="other-emails" className="text-sm font-semibold uppercase tracking-[0.2em] text-graphite">
          Other emails
        </h2>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold">{COPY[other].label}</p>
            <p className="mt-1 text-sm text-graphite">{COPY[other].hint}</p>
            {other === "weekly" && prefs.weekly && prefs.weeklyPaused && (
              <p className="mt-1 text-sm text-graphite">Paused: the last few weren&apos;t opened from the email. Turn it on again to restart.</p>
            )}
          </div>
          <PrefForm
            token={token}
            changes={{ [other]: !otherOn }}
            onSubmit={(c) => change(c)}
            disabled={busy}
            className="button-ghost h-11 shrink-0"
            label={`${otherOn ? "Turn off" : "Turn on"} ${COPY[other].label.toLowerCase()}`}
          >
            {otherOn ? "On" : "Off"}
          </PrefForm>
        </div>
        <p className="mt-6 text-sm text-graphite">Sign-in codes and payment receipts always come; your account needs them.</p>
        <p className="mt-2 text-sm">
          <Link href="/settings#emails" className="link-quiet inline-flex min-h-11 items-center">
            All email settings
          </Link>
        </p>
      </section>
    </div>
  );
}
