"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CAPS } from "@/lib/email/types";
import { saveSwitch, switchOn, type EmailSwitch, type EmailSwitches } from "./email-prefs";
import { send } from "./net";

// Settings → Emails: the weekly wrap and questions from the team, each on or off, saved as
// soon as it's tapped. Same words as the stop page (app/(email)/email/stop/StopPanel.tsx).
// Every email links here as /settings#emails.

const ROWS: { key: EmailSwitch; label: string; hint: string }[] = [
  { key: "weekly", label: "Weekly wrap", hint: "Sunday evenings, only after a week with something in it." },
  { key: "questions", label: "Questions from the team", hint: "A few taps, at most once every 3 months." },
];

export function EmailSettings({ initial }: { initial: EmailSwitches }) {
  const [prefs, setPrefs] = useState(initial);
  // The switch being saved, shown in its new position until the server answers.
  const [pending, setPending] = useState<{ key: EmailSwitch; on: boolean } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const section = useRef<HTMLElement>(null);

  // Opened from an email (/settings#emails). The screen's own scroll reset runs first on
  // phones (ScrollReset), so the section is brought into view after it.
  useEffect(() => {
    if (window.location.hash === "#emails") section.current?.scrollIntoView({ block: "start" });
  }, []);

  async function change(key: EmailSwitch, on: boolean) {
    setPending({ key, on });
    setStatus(null);
    const result = await saveSwitch(send, key, on);
    setPending(null);
    if (!result.ok) return setStatus({ ok: false, text: result.message });
    setPrefs(result.prefs);
    setStatus({ ok: true, text: "Saved." });
  }

  return (
    <section ref={section} id="emails" className="mt-14 scroll-mt-20 border-t border-line pt-6" aria-labelledby="emails-title">
      <h2 id="emails-title" className="text-xl font-bold semiwide">
        Emails
      </h2>
      <ul className="mt-4">
        {ROWS.map((row) => {
          const on = pending?.key === row.key ? pending.on : switchOn(prefs, row.key);
          const paused = row.key === "weekly" && prefs.weekly && prefs.weeklyPaused && pending?.key !== "weekly";
          return (
            <li key={row.key} className="flex items-start justify-between gap-4 border-t border-line py-5 first:border-t-0">
              <div>
                <p className="font-semibold">{row.label}</p>
                <p id={`email-${row.key}-hint`} className="mt-1 text-sm text-graphite">
                  {row.hint}
                </p>
                {paused && (
                  <p className="mt-2 text-sm text-graphite">
                    Paused: the last {CAPS.pauseWeeklyAfterUntapped} weren&apos;t opened from the email. Your wraps are still here. Turn it on to start again.
                  </p>
                )}
              </div>
              <label className="choice w-18 shrink-0 justify-center">
                <input
                  type="checkbox"
                  role="switch"
                  className="sr-only"
                  checked={on}
                  disabled={pending !== null}
                  onChange={() => change(row.key, !on)}
                  aria-label={`${row.label} emails`}
                  aria-describedby={`email-${row.key}-hint`}
                />
                {on ? "On" : "Off"}
              </label>
            </li>
          );
        })}
      </ul>
      <p role="status" className={status && !status.ok ? "error-mark text-sm" : "text-sm text-graphite"}>
        {status?.text ?? ""}
      </p>
      <p className="mt-4 text-sm text-graphite">
        Sign-in codes and payment receipts always come; your account needs them. The welcome email comes once, when you join.
      </p>
      <Link href="/feedback" className="button-ghost mt-4 h-12">
        Tell us what to build
      </Link>
    </section>
  );
}
