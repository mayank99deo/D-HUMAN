"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const MESSAGES: Record<string, string> = {
  invalid_email: "That email doesn't look right.",
  rate_limited: "Too many tries. Wait a few minutes, then ask for a new code.",
  unavailable: "We couldn't send the email just now. Try again in a minute.",
  invalid: "That code doesn't match. Check the latest email.",
  expired: "That code has expired. Ask for a new one.",
  locked: "Too many wrong tries for this code. Ask for a new one.",
};

export function SignInForm() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await post("/api/auth/code", { email });
    setBusy(false);
    if (!ok) return setError(MESSAGES[data.error] ?? MESSAGES.unavailable);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await post("/api/auth/verify", { email, code });
    if (!ok) {
      setBusy(false);
      return setError(MESSAGES[data.error] ?? MESSAGES.invalid);
    }
    router.replace(data.next ?? "/home");
    router.refresh();
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
        onChange={(e) => setEmail(e.target.value)}
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
        aria-describedby={error ? "signin-error" : undefined}
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
        <button type="button" className="link-quiet min-h-11" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
          Use another email
        </button>
        <button type="button" className="link-quiet min-h-11" onClick={() => sendCode()} disabled={busy}>
          Send a new code
        </button>
      </div>
    </form>
  );
}
