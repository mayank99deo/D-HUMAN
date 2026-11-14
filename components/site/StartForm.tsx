"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useSilkTether } from "@/components/waitlist/useSilkTether";
import { handOffEmail } from "@/lib/signin-handoff";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What starting free gets you, not what it costs later (Mayank, 2026-11-14): the pass and
// its price are shown in the app, on the paywall, before anyone pays. "Free to start", never
// "free": the free reads and meal logs have limits (lib/domain/plan.ts).
const FREE_LEAD = "Free to start.";
const FREE_REST = " AI reads your blood report marker by marker and counts the calories and protein in your meals. No card needed, just your email.";

// Open mode's answer to the waitlist form: same shape, but it starts the
// account. The email rides over to /signin in sessionStorage. The input has no
// name, so if the page's script hasn't loaded, the form still goes to /signin
// without the address in the URL.
export function StartForm() {
  const id = useId();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useSilkTether(buttonRef);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = (inputRef.current?.value ?? "").trim().toLowerCase();
    if (email && !EMAIL_PATTERN.test(email)) {
      setError("Enter an email address like name@example.com.");
      return;
    }
    if (email) handOffEmail(email);
    startTransition(() => router.push("/signin"));
  }

  return (
    <form action="/signin" method="get" noValidate onSubmit={onSubmit} className="w-full">
      <label htmlFor={`${id}-email`} className="sr-only">
        Email address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id={`${id}-email`}
          type="email"
          inputMode="email"
          enterKeyHint="go"
          autoComplete="email"
          placeholder="Your email"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-message ${id}-free`}
          onChange={() => error && setError(null)}
          className="field h-14 min-w-0 sm:flex-1"
        />
        <button ref={buttonRef} type="submit" disabled={pending} className="button-primary h-14 shrink-0">
          {pending ? "Opening…" : "Start free"}
        </button>
      </div>
      <p id={`${id}-message`} role="alert" className="text-sm font-medium text-paper">
        {error && <span className="error-mark mt-3 block">{error}</span>}
      </p>
      <p id={`${id}-free`} className="mt-3 max-w-[56ch] text-sm text-pretty text-graphite">
        <span className="font-semibold text-paper">{FREE_LEAD}</span>
        {FREE_REST}
      </p>
    </form>
  );
}
