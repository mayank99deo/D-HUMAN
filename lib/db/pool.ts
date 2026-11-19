// The production Postgres client (postgres.js, through Supabase's pooler), made safe for
// Vercel functions that sleep between requests.
//
// The bug this exists for (MEMORY.md, 2026-11-19): a function instance is suspended
// between requests with its pooled connections open. While it sleeps its timers don't run,
// so `idle_timeout` never closes them, and the network path forgets the idle connection
// (the live probe hung after a 7-minute gap, never after 5.5 minutes; AWS load balancers
// and NAT forget idle TCP flows after 350 s). On waking, the next query was written into
// the dead socket. Nothing answers and nothing closes it, and postgres.js had no deadline,
// so the page waited until Vercel killed the function. Vercel and Supabase both describe
// this: vercel.com/guides/connection-pooling-with-functions ("Idle connection timeouts
// don't run while suspended") and Supabase's "Troubleshooting CONNECT_TIMEOUT or hanging
// queries in Serverless Functions". Vercel's fix, attachDatabasePool, doesn't support
// postgres.js (@vercel/functions 3.11 throws "Unsupported database pool type").
//
// Three guards:
// 1. Before a query or transaction starts, any connection that has been silent for longer
//    than idle_timeout is destroyed, measured by the wall clock, which keeps moving while
//    the function sleeps. An awake process closes such connections itself on time, so one
//    still open proves the timers were frozen: it's presumed dead and never written to.
// 2. Every query has a deadline (query_timeout). If the server doesn't answer the cancel
//    that follows, the connection is destroyed and the query fails instead of hanging.
// 3. A read that failed because its connection died is run once more on a fresh one.
//    Writes are never retried: whether they ran is unknown.
//
// Also one query at a time per connection (max_pipeline: 1): Supavisor before 2.10
// "could release the backend too early or leave the client hanging" on pipelined
// batches (its 2.10.0 release notes; the postgres.js README says the same).
import "server-only";
import net from "node:net";
import postgres from "postgres";

/** postgres.js settings, in seconds. */
export const POOL = {
  max: 5,
  // prepare:false keeps it working behind transaction poolers (Supabase on 6543).
  prepare: false,
  // A warm instance keeps idle connections 2 minutes, so someone reading a page and
  // tapping on doesn't wait for a fresh TLS connection each time.
  idle_timeout: 120,
  // A stuck connect fails into the error screen instead of the driver's 30 s.
  connect_timeout: 10,
  max_lifetime: 30 * 60,
  // The app's queries take milliseconds; the largest (a 4 MB report file) well under a
  // second. 10 s is slow enough for a busy database and short enough to end a dead wait,
  // which then takes at most query_timeout + cancel_timeout.
  query_timeout: 10,
  cancel_timeout: 2,
  // A transaction waiting for a free connection gives up too, without having started.
  queue_timeout: 10,
  max_pipeline: 1,
} satisfies postgres.Options;

type Overrides = { query_timeout?: number; cancel_timeout?: number; queue_timeout?: number; idle_timeout?: number };

// Errors that mean the connection died under a query. QUERY_TIMEOUT counts only when the
// server didn't answer the cancel either; one it answered was a slow query, not a dead line.
const LOST = new Set(["CONNECTION_CLOSED", "CONNECTION_DESTROYED", "ECONNRESET", "EPIPE", "ETIMEDOUT"]);
function connectionLost(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  if (!e) return false;
  return (e.code === "QUERY_TIMEOUT" && e.cause?.code === "CANCEL_UNANSWERED") || LOST.has(e.code ?? "");
}

// Safe to run twice: a plain select that locks nothing and changes nothing.
const SELECT = /^\s*select\b/i;
const SIDE_EFFECT = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b|pg_advisory|nextval|setval|pg_notify/i;
export const isRead = (text: string) => SELECT.test(text) && !SIDE_EFFECT.test(text);

type Activity = { bytes: number; heardAt: number; checkedAt: number };

/**
 * A postgres.js client for drizzle (`drizzle(createPool(url))`), with the guards above.
 * `overrides` is for tests.
 */
export function createPool(url: string, overrides: Overrides = {}) {
  const options = { ...POOL, ...overrides };
  // A connection presumed dead: silent for longer than its idle timer allows.
  const staleMs = (options.idle_timeout + 5) * 1000;
  const sockets = new Map<net.Socket, Activity>();

  // Our own TCP socket per connection, so we can watch it and destroy it. postgres.js still
  // does TLS on top. The byte counters keep counting under TLS (checked on Node 24).
  function socket(_parsed: unknown, host: string, port: number) {
    return new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host, port });
      // postgres.js can't destroy a socket of ours that never connected, so we do.
      const timer = setTimeout(() => s.destroy(new Error(`connect to ${host}:${port} timed out`)), options.connect_timeout * 1000);
      const failed = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      s.once("error", failed);
      s.once("connect", () => {
        clearTimeout(timer);
        s.off("error", failed);
        s.setNoDelay(true);
        const now = Date.now();
        sockets.set(s, { bytes: 0, heardAt: now, checkedAt: now });
        s.once("close", () => sockets.delete(s));
        resolve(s);
      });
    });
  }

  /**
   * Destroys every connection silent for longer than staleMs. Activity is read from the byte
   * counters at each check, so a socket that moved bytes since the last check is credited
   * with the time of that check, never later: a check can only underrate how fresh it is.
   * Returns a promise once the pool has let go of the destroyed connections, else null.
   */
  function sweep(): Promise<void> | null {
    const now = Date.now();
    const dead: net.Socket[] = [];
    let idle = 0;
    for (const [s, seen] of sockets) {
      const bytes = s.bytesRead + s.bytesWritten;
      if (bytes !== seen.bytes) {
        seen.bytes = bytes;
        seen.heardAt = seen.checkedAt;
      }
      seen.checkedAt = now;
      if (now - seen.heardAt > staleMs) {
        dead.push(s);
        idle = Math.max(idle, now - seen.heardAt);
      }
    }
    if (!dead.length) return null;
    console.warn(`[db] dropping ${dead.length} connection(s) silent for ${Math.round(idle / 1000)} s; the function slept with them open`);
    return Promise.all(dead.map((s) => new Promise<void>((resolve) => (s.once("close", () => resolve()), s.destroy())))).then(
      // postgres.js handles the close in the same turn; one more lets it settle first.
      () => new Promise<void>((resolve) => setImmediate(resolve)),
    );
  }

  // A net.Socket is what postgres.js makes itself; its types only describe the parts it uses.
  const sql = postgres(url, { ...options, socket: socket as unknown as postgres.Options["socket"] });

  // drizzle runs every statement through unsafe() (awaited, or with .values()) and every
  // transaction through begin(). Statements inside a transaction run on its own connection.
  function unsafe(...args: Parameters<typeof sql.unsafe>) {
    const read = isRead(args[0]);
    let values = false;
    let result: Promise<unknown> | undefined;
    const attempt = () => {
      const query = sql.unsafe(...args);
      return values ? query.values() : query;
    };
    const run = async () => {
      const swept = sweep();
      if (swept) await swept;
      try {
        return await attempt();
      } catch (error) {
        if (!connectionLost(error)) throw error;
        const code = (error as { code?: string }).code;
        if (!read) {
          console.warn(`[db] connection lost under a write (${code}); not retried, as it may have run`);
          throw error;
        }
        console.warn(`[db] connection lost under a read (${code}); trying it once more`);
        const again = sweep();
        if (again) await again;
        return await attempt();
      }
    };
    const pending = {
      values() {
        values = true;
        return pending;
      },
      then<A = unknown, B = never>(ok?: ((value: unknown) => A | PromiseLike<A>) | null, fail?: ((reason: unknown) => B | PromiseLike<B>) | null) {
        result ??= run();
        return result.then(ok, fail);
      },
    };
    return pending;
  }

  async function begin(...args: unknown[]) {
    const swept = sweep();
    if (swept) await swept;
    return (sql.begin as (...a: unknown[]) => Promise<unknown>)(...args);
  }

  return new Proxy(sql, {
    get: (target, key, receiver) => (key === "unsafe" ? unsafe : key === "begin" ? begin : Reflect.get(target, key, receiver)),
  });
}
