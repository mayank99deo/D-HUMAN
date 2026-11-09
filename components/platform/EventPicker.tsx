"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Ev = { id: string; name: string; startsOn: string | null; city: string | null; url: string | null; details: string | null };

const dateText = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)) : "Dates to be announced";

export function EventPicker({ events, pickedId, targetId }: { events: Ev[]; pickedId: string | null; targetId: string | null }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [choice, setChoice] = useState(pickedId ?? targetId);

  async function pick(id: string | null) {
    setChoice(id);
    await fetch("/api/events/target", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: id }) });
    startTransition(() => router.refresh());
  }

  return (
    <ul className={busy ? "opacity-60" : ""}>
      {events.map((e) => {
        const on = choice === e.id;
        return (
          <li key={e.id} className="flex items-start gap-4 border-t border-line py-4">
            <button
              type="button"
              onClick={() => pick(on ? null : e.id)}
              aria-pressed={on}
              className={`mt-0.5 grid h-11 w-11 shrink-0 place-items-center border ${on ? "border-paper bg-paper text-ink" : "border-line-strong"}`}
              aria-label={on ? `Stop aiming at ${e.name}` : `Aim at ${e.name}`}
            >
              {on ? "✓" : ""}
            </button>
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{e.name}</p>
              <p className="text-sm text-graphite">
                {dateText(e.startsOn)}
                {e.city ? `, ${e.city}` : ""}
              </p>
              {e.details && <p className="mt-1 text-sm text-graphite">{e.details}</p>}
              {e.url && (
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="link-quiet mt-1 inline-block min-h-11 py-2 text-sm">
                  Event page
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
