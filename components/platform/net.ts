// One way to call our API from the browser. It never throws: a dropped
// connection or a request that hangs comes back as { offline: true }, so every
// button can let go of its busy state and say what happened.

export type Reply<T = Record<string, unknown>> = { ok: boolean; status: number; offline: boolean; data: Partial<T> & { error?: string } };

export async function send<T = Record<string, unknown>>(
  url: string,
  { method = "POST", body, timeoutMs = 20_000, keepalive }: { method?: string; body?: unknown; timeoutMs?: number; keepalive?: boolean } = {},
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
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, offline: false, data };
  } catch {
    return { ok: false, status: 0, offline: true, data: {} };
  } finally {
    clearTimeout(timer);
  }
}

export const OFFLINE = "No connection. Check your signal and try again.";
