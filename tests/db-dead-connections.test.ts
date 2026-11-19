// Production's Postgres client (lib/db with DATABASE_URL set) against connections that die
// silently, as they do on Vercel: a function instance sleeps between requests with its
// pooled connections open, its timers don't run, and the network forgets the idle flow.
// The next query used to be written into the dead socket and wait for ever (MEMORY.md,
// 2026-11-19, "/write Import stuck on Loading…").
//
// The database is the embedded PGlite behind a real Postgres wire endpoint, reached through
// a proxy that can turn every open connection into a black hole (tests/support/pg-wire.ts).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { allowAppImports } from "./support/app.ts";
import { blackholeProxy, pgWireServer, type BlackholeProxy, type WireServer } from "./support/pg-wire.ts";

allowAppImports();

let server: WireServer;
let proxy: BlackholeProxy;
let url: string;

/** Rejects if `job` hasn't settled after `ms`: a hang fails the test instead of stalling it. */
function within<T>(ms: number, job: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms);
  });
  return Promise.race([Promise.resolve(job), late]).finally(() => clearTimeout(timer));
}

/** Moves the wall clock on by `ms` while timers stay where they were: a frozen function. */
function sleepFunction(ms: number): () => void {
  const realNow = Date.now;
  Date.now = () => realNow() + ms;
  return () => {
    Date.now = realNow;
  };
}

const rows = (result: unknown) => result as Array<Record<string, unknown>>;

before(async () => {
  server = await pgWireServer();
  proxy = await blackholeProxy(server.port);
  url = `postgres://postgres@127.0.0.1:${proxy.port}/postgres`;
  process.env.DATABASE_URL = url;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  await server.db.exec("create table notes (id serial primary key, body text not null)");
});

after(async () => {
  await proxy.close();
  await server.close();
});

describe("a connection that died while the function slept", () => {
  it("isn't reused: the next read gets a fresh connection at once", async () => {
    const { db } = await import("../lib/db/index.ts");
    const d = await db();
    assert.equal(rows(await d.execute(sql`select 1 as x`))[0].x, 1);
    assert.ok(proxy.open >= 1);

    proxy.drop(); // the network forgets the pooled connection…
    const wake = sleepFunction(7 * 60_000); // …while the function sleeps for 7 minutes
    try {
      const started = performance.now();
      const result = await within(3_000, d.execute(sql`select 2 as x`));
      assert.equal(rows(result)[0].x, 2);
      assert.ok(performance.now() - started < 1_000, "answered without waiting for a timeout");
    } finally {
      wake();
    }
  });

  it("isn't reused for a write either, so the write runs once", async () => {
    const { db } = await import("../lib/db/index.ts");
    const d = await db();
    await d.execute(sql`select 1`);

    proxy.drop();
    const wake = sleepFunction(10 * 60_000);
    try {
      await within(3_000, d.execute(sql`insert into notes (body) values ('after a sleep')`));
    } finally {
      wake();
    }
    const saved = await server.db.query<{ n: number }>("select count(*)::int as n from notes where body = 'after a sleep'");
    assert.equal(saved.rows[0].n, 1);
  });

  it("isn't reused by a transaction", async () => {
    const { db } = await import("../lib/db/index.ts");
    const d = await db();
    await d.execute(sql`select 1`);

    proxy.drop();
    const wake = sleepFunction(10 * 60_000);
    try {
      const n = await within(3_000, d.transaction(async (tx) => {
        await tx.execute(sql`insert into notes (body) values ('in a transaction')`);
        return rows(await tx.execute(sql`select count(*)::int as n from notes where body = 'in a transaction'`))[0].n;
      }));
      assert.equal(n, 1);
    } finally {
      wake();
    }
  });

  it("leaves a connection used a moment ago alone", async () => {
    const { db } = await import("../lib/db/index.ts");
    const d = await db();
    await d.execute(sql`select 1`);
    const open = proxy.open;
    await d.execute(sql`select 2`);
    assert.equal(proxy.open, open, "no reconnect between two quick queries");
  });

  it("answers a dozen queries at once, one at a time per connection", async () => {
    const { db } = await import("../lib/db/index.ts");
    const d = await db();
    const results = await within(5_000, Promise.all(Array.from({ length: 12 }, (_, i) => d.execute(sql`select ${i}::int as i`))));
    assert.deepEqual(
      results.map((r) => rows(r)[0].i),
      Array.from({ length: 12 }, (_, i) => i),
    );
  });
});

describe("a connection that dies while the function is awake", () => {
  // Nothing tells the client the connection is gone, so only a deadline can end the wait.
  // Short timeouts here; production's are in lib/db/pool.ts.
  async function client() {
    const { createPool } = await import("../lib/db/pool.ts");
    const pool = createPool(url, { query_timeout: 1, cancel_timeout: 1 });
    return { d: drizzle(pool), end: () => pool.end({ timeout: 0 }) };
  }

  it("a read gives up within its deadline and is answered on a fresh connection", async () => {
    const { d, end } = await client();
    try {
      await d.execute(sql`select 1`);
      proxy.drop();
      const started = performance.now();
      const result = await within(6_000, d.execute(sql`select 3 as x`));
      assert.equal(rows(result)[0].x, 3);
      const waited = performance.now() - started;
      assert.ok(waited >= 1_000 && waited < 4_000, `waited ${Math.round(waited)} ms`);
    } finally {
      await end();
    }
  });

  it("a write fails within its deadline and isn't tried again", async () => {
    const { d, end } = await client();
    try {
      await d.execute(sql`select 1`);
      proxy.drop();
      const error = await within(6_000, d.execute(sql`insert into notes (body) values ('lost write')`)).then(
        () => null,
        (e: unknown) => e,
      );
      const cause = (error as { cause?: { code?: string } } | null)?.cause;
      assert.equal(cause?.code, "QUERY_TIMEOUT");
      const saved = await server.db.query<{ n: number }>("select count(*)::int as n from notes where body = 'lost write'");
      assert.equal(saved.rows[0].n, 0, "the dropped write never reached the server and wasn't sent again");
      // The pool recovers: the next query opens a fresh connection.
      assert.equal(rows(await within(3_000, d.execute(sql`select 4 as x`)))[0].x, 4);
    } finally {
      await end();
    }
  });
});
