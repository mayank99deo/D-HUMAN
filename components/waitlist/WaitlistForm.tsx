"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { sendPulse } from "@/components/signal-field/SignalField";
import {
  PLAN_LABELS,
  PLAN_VALUES,
  TRAINING_LABELS,
  TRAINING_VALUES,
  type SourceValue,
} from "@/lib/waitlist/options";
import { setSignup, takeFocus, useSignup } from "./store";
import { useSilkTether } from "./useSilkTether";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_HINT = "Enter an email address like name@example.com.";

export function WaitlistForm({ source }: { source: SourceValue }) {
  const signup = useSignup();

  switch (signup.phase) {
    case "none":
      return <JoinForm source={source} />;
    case "exists":
      return (
        <Notice source={source} title="You're already on the list.">
          {signup.email} is on the waitlist. We&apos;ll email you when early access opens.
        </Notice>
      );
    case "done":
      return (
        <Notice
          source={source}
          title={signup.saved && signup.firstName ? `Thanks, ${signup.firstName}.` : "You're on the list."}
        >
          {signup.saved
            ? "Your answers are saved. We'll email you when early access opens."
            : "We'll email you when early access opens."}
        </Notice>
      );
    case "joined":
      return signup.token ? (
        <Details source={source} email={signup.email} token={signup.token} />
      ) : (
        <Notice source={source} title="You're on the list.">
          We&apos;ll email you when early access opens.
        </Notice>
      );
  }
}

function useFocusOnArrival<T extends HTMLElement>(source: SourceValue) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (takeFocus(source)) ref.current?.focus();
  }, [source]);
  return ref;
}

function JoinForm({ source }: { source: SourceValue }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useSilkTether(buttonRef);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      setError(EMAIL_HINT);
      return;
    }

    setPending(true);
    setError(null);
    const params = new URLSearchParams(window.location.search);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source,
          utmSource: params.get("utm_source") ?? undefined,
          utmMedium: params.get("utm_medium") ?? undefined,
          utmCampaign: params.get("utm_campaign") ?? undefined,
          referrer: document.referrer || undefined,
          company: form.get("company") || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { status?: string; token?: string };

      if (response.ok && data.status === "created") {
        if (buttonRef.current) sendPulse(buttonRef.current);
        setSignup({ phase: "joined", email, token: data.token }, source);
      } else if (response.ok && data.status === "exists") {
        setSignup({ phase: "exists", email }, source);
      } else if (response.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
      } else if (response.status === 400) {
        setError(EMAIL_HINT);
      } else {
        setError("Couldn't add you just now. Try again in a minute.");
      }
    } catch {
      setError("Couldn't reach D-Human. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="w-full">
      <label htmlFor={`${id}-email`} className="sr-only">
        Email address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          enterKeyHint="send"
          autoComplete="email"
          placeholder="Your email"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-message`}
          onChange={() => error && setError(null)}
          className="field h-14 min-w-0 sm:flex-1"
        />
        <button ref={buttonRef} type="submit" disabled={pending} className="button-primary h-14 shrink-0">
          {pending ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {/* Honeypot: hidden from people and assistive tech, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Company
          <input name="company" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <p
        id={`${id}-message`}
        role={error ? "alert" : undefined}
        className={`mt-3 text-sm ${error ? "font-medium text-paper" : "text-graphite"}`}
      >
        {error ? <span className="error-mark">{error}</span> : "One email when early access opens, plus launch news. Unsubscribe anytime."}
      </p>
    </form>
  );
}

function Details({ source, email, token }: { source: SourceValue; email: string; token: string }) {
  const id = useId();
  const headingRef = useFocusOnArrival<HTMLHeadingElement>(source);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    const answers = {
      firstName: text("firstName"),
      city: text("city"),
      plan: text("plan"),
      training: form.getAll("training").map(String),
      whatsapp: text("whatsapp"),
    };
    const answered = Object.values(answers).some((v) => (Array.isArray(v) ? v.length > 0 : v));
    if (!answered) {
      setSignup({ phase: "done", email, saved: false }, source);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/waitlist/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, ...answers }),
      });
      const data = (await response.json().catch(() => ({}))) as { field?: string };
      if (response.ok) {
        setSignup({ phase: "done", email, firstName: answers.firstName, saved: true }, source);
      } else if (response.status === 400 && data.field === "whatsapp") {
        setError("Enter a WhatsApp number with country code, like +91 98765 43210.");
      } else if (response.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
      } else {
        setError("Couldn't save your answers. Try again in a minute.");
      }
    } catch {
      setError("Couldn't reach D-Human. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border border-paper/30 bg-ink p-5 sm:p-7">
      <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
        You&apos;re on the list.
      </h3>
      <p className="mt-1 text-graphite">
        We sent a confirmation to <span className="text-paper">{email}</span>.
      </p>

      <form noValidate onSubmit={onSubmit} className="mt-7 grid gap-6 border-t border-paper/15 pt-6">
        <p className="text-sm text-graphite">
          Optional: a few answers help us decide what to launch first, and where.
        </p>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Which plan fits you?</legend>
          <div className="flex flex-wrap gap-2">
            {PLAN_VALUES.map((value) => (
              <Choice key={value} type="radio" name="plan" value={value}>
                {PLAN_LABELS[value]}
              </Choice>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">What do you train for?</legend>
          <div className="flex flex-wrap gap-2">
            {TRAINING_VALUES.map((value) => (
              <Choice key={value} type="checkbox" name="training" value={value}>
                {TRAINING_LABELS[value]}
              </Choice>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField id={`${id}-name`} name="firstName" label="First name" autoComplete="given-name" />
          <TextField id={`${id}-city`} name="city" label="City" autoComplete="address-level2" />
        </div>
        <TextField
          id={`${id}-whatsapp`}
          name="whatsapp"
          label="WhatsApp number"
          hint="For launch updates only. Include your country code."
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+91"
        />

        {error && (
          <p role="alert" className="error-mark text-sm font-medium">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <button type="submit" disabled={pending} className="button-primary h-12">
            {pending ? "Saving…" : "Save answers"}
          </button>
          <button
            type="button"
            onClick={() => setSignup({ phase: "done", email, saved: false }, source)}
            className="link-quiet -my-2 py-2 text-sm"
          >
            Skip these questions
          </button>
        </div>
      </form>
    </div>
  );
}

function Choice({
  type,
  name,
  value,
  children,
}: {
  type: "radio" | "checkbox";
  name: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <label className="choice">
      <input type={type} name={name} value={value} className="sr-only" />
      {children}
    </label>
  );
}

function TextField({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} className="field h-12" {...input} />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-graphite">
          {hint}
        </p>
      )}
    </div>
  );
}

function Notice({ source, title, children }: { source: SourceValue; title: string; children: ReactNode }) {
  const headingRef = useFocusOnArrival<HTMLHeadingElement>(source);
  return (
    <div className="border-l-2 border-paper py-1 pl-5">
      <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
        {title}
      </h3>
      <p className="mt-1 text-graphite">{children}</p>
    </div>
  );
}
