"use client";

import { useState, useSyncExternalStore } from "react";
import { clearHandedOffEmail, readHandedOffEmail } from "@/lib/signin-handoff";
import { send } from "./net";

const MESSAGES: Record<string, string> = {
  invalid_email: "That email doesn't look right.",
  rate_limited: "Too many tries. Wait a few minutes, then ask for a new code.",
  unavailable: "We couldn't send the email just now. Try again in a minute.",
  invalid: "That code doesn't match. Check the latest email.",
  expired: "That code has expired. Ask for a new one.",
  locked: "Too many wrong tries for this code. Ask for a new one.",
  offline: "We couldn't reach D-Human. Check your connection and try again.",
};

// sessionStorage doesn't announce changes in the same tab, so there is nothing to subscribe to.
const noChanges = () => () => {};

// The screen to return to after sign-in (/signin?next=…), read when the code is checked,
// so the page itself stays static. A #fragment the browser kept through the redirect (an
// email's /settings#emails) goes along. The server decides whether the path is allowed.
function returnPath(): string | undefined {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return undefined;
  return next.includes("#") ? next : `${next}${window.location.hash}`;
}

export function SignInForm() {
  const [step, setStep] = useState<"email" | "code">("email");
  // The email typed on the landing page, if any. Empty on the server, filled
  // in on the client, so hydration matches. What the person types wins.
  const handedOff = useSyncExternalStore(noChanges, readHandedOffEmail, () => "");
  const [typed, setTyped] = useState<string | null>(null);
  const email = typed ?? handedOff;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Our records say mail to this address bounced or was marked as spam, so the code may not
  // arrive: the code route's "suppressed" notice, with its own words.
  const [notice, setNotice] = useState<string | null>(null);

  async function post(url: string, body: unknown) {
    const r = await send<{ error: string; next: string; notice: string; message: string }>(url, { body });
    return { ok: r.ok, data: r.offline ? { error: "offline" } : r.data };
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setTyped(email); // fixed from here, even once the hand-off is cleared
    const { ok, data } = await post("/api/auth/code", { email });
    setBusy(false);
    if (!ok) return setError(MESSAGES[data.error ?? ""] ?? MESSAGES.unavailable);
    if (data.notice === "suppressed" && data.message) setNotice(data.message);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await post("/api/auth/verify", { email, code, next: returnPath() });
    if (!ok) {
      setBusy(false);
      return setError(MESSAGES[data.error ?? ""] ?? MESSAGES.invalid);
    }
    clearHandedOffEmail();
    // A full page load: the new session is read once, fresh, with nothing cached from before sign-in.
    window.location.assign(data.next ?? "/home");
  }

  return step === "email" ? (
    <form onSubmit={sendCode} className="mt-8 space-y-3" noValidate>
      <label htmlFor="email" className="block text-sm text-graphite">
        Email
      </label>
      <input
        id="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        enterKeyHint="send"
        required
        value={email}
        onChange={(e) => setTyped(e.target.value)}
        className="field h-13"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "signin-error" : undefined}
      />
      <button type="submit" disabled={busy || !email} className="button-primary h-13 w-full">
        {busy ? "Sending…" : "Send code"}
      </button>
      {error && (
        <p id="signin-error" role="alert" className="error-mark text-sm">
          {error}
        </p>
      )}
    </form>
  ) : (
    <form onSubmit={verify} className="mt-8 space-y-3" noValidate>
      <label htmlFor="code" className="block text-sm text-graphite">
        Code sent to <span className="text-paper">{email}</span>
      </label>
      {notice && (
        <p id="signin-notice" role="alert" className="error-mark text-sm">
          {notice}
        </p>
      )}
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        enterKeyHint="go"
        pattern="[0-9 ]*"
        maxLength={7}
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="field h-16 text-center text-3xl tracking-[0.4em] display-num"
        aria-invalid={error ? true : undefined}
        aria-describedby={[error && "signin-error", notice && "signin-notice"].filter(Boolean).join(" ") || undefined}
      />
      <button type="submit" disabled={busy || code.replace(/\D/g, "").length !== 6} className="button-primary h-13 w-full">
        {busy ? "Checking…" : "Sign in"}
      </button>
      {error && (
        <p id="signin-error" role="alert" className="error-mark text-sm">
          {error}
        </p>
      )}
      <div className="flex justify-between pt-2 text-sm">
        <button type="button" className="link-quiet min-h-11" onClick={() => { setStep("email"); setCode(""); setError(null); setNotice(null); }}>
          Use another email
        </button>
        <button type="button" className="link-quiet min-h-11" onClick={() => sendCode()} disabled={busy}>
          Send a new code
        </button>
      </div>
    </form>
  );
}
