// One way to call our API from the browser. It never throws: a dropped
// connection or a request that hangs comes back as { offline: true }, so every
// button can let go of its busy state and say what happened.

export type Reply<T = Record<string, unknown>> = { ok: boolean; status: number; offline: boolean; data: Partial<T> & { error?: string } };

export async function send<T = Record<string, unknown>>(
  url: string,
  {
    method = "POST",
    body,
    timeoutMs = 20_000,
    keepalive,
    wholeAnswer = false,
  }: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
    keepalive?: boolean;
    /** An answer cut off on the way counts as offline, not as an empty answer (for sends the caller may resend). */
    wholeAnswer?: boolean;
  } = {},
): Promise<Reply<T>> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
      keepalive,
    });
    let data: Reply<T>["data"] = {};
    if (wholeAnswer) {
      // Reading the text rejects when the connection drops mid-answer (caught below as offline);
      // an answer that arrives whole but isn't JSON (a gateway's page) is still an answer.
      const raw = await res.text();
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Reply<T>["data"];
      } catch {}
    } else data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, offline: false, data };
  } catch {
    return { ok: false, status: 0, offline: true, data: {} };
  } finally {
    clearTimeout(timer);
  }
}

export const OFFLINE = "No connection. Check your signal and try again.";

// ── Sends that may go twice ───────────────────────────────────────────────
// iPhone's WebKit never resends a POST that dies on a connection the network quietly dropped
// while the page sat idle (Apple: "POST requests are not idempotent so they cannot be retried",
// developer.apple.com/forums/thread/796906). It fails with "Load failed" and the next request
// opens a fresh connection. So for a POST the server can safely receive twice (a meal carries
// its try's key: app/api/food/route.ts), the browser resends it once, itself.

/** What one send of a request came to, for the grey support line: "Load failed after 9.7 s". */
export type Tried = { what: string; ms: number };
export type Sent = { res: Response | null; data: Record<string, unknown> & { error?: string; message?: string }; tries: Tried[] };
export type SendDeps = { fetch: typeof fetch; now: () => number; sleep: (ms: number) => Promise<void> };
const realDeps = (): SendDeps => ({ fetch: (...a) => fetch(...a), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });

/** Wait before the one resend: long enough for the dead connection to be gone, short enough not to be felt. */
export const RESEND_AFTER_MS = 1_000;
/** No answer after this long: give up. The meal route stops at 120 s (maxDuration), so nothing is coming. */
export const SEND_GIVE_UP_MS = 125_000;

const failureText = (e: unknown) => {
  const s = e instanceof Error ? e.message || e.name : String(e);
  return s.replace(/\s+/g, " ").trim().slice(0, 80) || "Network error";
};

/**
 * POST, and when the connection fails (fetch rejects, or the answer is cut off mid-way) send
 * the same request once more after RESEND_AFTER_MS. Only for requests the server makes safe to
 * repeat. Never resends after an HTTP status (the server answered), or after SEND_GIVE_UP_MS
 * of silence (a whole wait has passed: the person decides). `body` is called once per send.
 */
export async function postResending(
  url: string,
  body: () => BodyInit,
  { headers, deps = realDeps(), resendAfterMs = RESEND_AFTER_MS, giveUpMs = SEND_GIVE_UP_MS }: { headers?: HeadersInit; deps?: SendDeps; resendAfterMs?: number; giveUpMs?: number } = {},
): Promise<Sent> {
  const tries: Tried[] = [];
  for (let n = 0; n < 2; n++) {
    if (n) await deps.sleep(resendAfterMs);
    const started = deps.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), giveUpMs);
    try {
      const res = await deps.fetch(url, { method: "POST", headers, body: body(), signal: abort.signal });
      // Read the body as text first: a connection cut mid-answer rejects here (and is resent),
      // while an answer that isn't JSON (a gateway's error page) is still an answer.
      const raw = await res.text();
      let data: Sent["data"] = {};
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Sent["data"];
      } catch {}
      if (!res.ok) tries.push({ what: `HTTP ${res.status}`, ms: deps.now() - started });
      return { res, data, tries };
    } catch (e) {
      const gaveUp = abort.signal.aborted;
      tries.push({ what: gaveUp ? "No answer" : failureText(e), ms: deps.now() - started });
      if (gaveUp) break;
    } finally {
      clearTimeout(timer);
    }
  }
  return { res: null, data: {}, tries };
}

/** The grey line under a failure, for Mayank's screenshots: "Load failed after 9.7 s, then Load failed after 0.3 s". */
export function triesLine(tries: Tried[]): string | null {
  if (!tries.length) return null;
  return tries.map((t) => `${t.what} after ${(t.ms / 1000).toFixed(1)} s`).join(", then ");
}

/** A key for one try at something the server dedupes: random, URL-safe, the same for every resend of that try. */
export function tryKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // randomUUID needs a secure context (https or localhost); getRandomValues doesn't.
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
}
