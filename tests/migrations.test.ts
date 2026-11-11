// Migrations on fresh embedded databases, the way production meets them: the
// deploy's migrator and a paste into Supabase's SQL editor, in either order, any
// number of times; and 0002 on a database that already holds duplicate events.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../lib/db/schema.ts";

const FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
type Journal = { entries: { tag: string }[] };
const journal = JSON.parse(readFileSync(path.join(FOLDER, "meta/_journal.json"), "utf8")) as Journal;
const files = journal.entries.map((e) => readFileSync(path.join(FOLDER, `${e.tag}.sql`), "utf8"));

// Supabase's SQL editor runs a whole file as one script; PGlite's exec does the same.
async function paste(pg: PGlite, upTo = files.length) {
  for (const text of files.slice(0, upTo)) await pg.exec(text);
}

// The deploy's migrator, optionally with only the first `upTo` migrations released.
async function deploy(pg: PGlite, upTo = files.length) {
  const db = drizzle(pg);
  if (upTo === files.length) return migrate(db, { migrationsFolder: FOLDER });
  const dir = mkdtempSync(path.join(tmpdir(), "dhuman-migrations-"));
  try {
    cpSync(FOLDER, dir, { recursive: true });
    const partial = { ...journal, entries: journal.entries.slice(0, upTo) };
    writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(partial));
    await migrate(db, { migrationsFolder: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function one<T>(pg: PGlite, query: string): Promise<T> {
  return (await pg.query<T>(query)).rows[0];
}

async function assertCurrentShape(pg: PGlite) {
  const col = await pg.query(`select table_name, column_name, is_nullable, column_default from information_schema.columns
    where (table_name, column_name) in (('reports','started_at'), ('events','query'), ('profiles','tour_done_at'))`);
  assert.equal(col.rows.length, 3, "started_at, query and tour_done_at exist");

  const key = await one<{ nnd: boolean; cols: string }>(pg, `select i.indnullsnotdistinct as nnd, pg_get_indexdef(i.indexrelid) as cols
    from pg_constraint c join pg_index i on i.indexrelid = c.conindid where c.conname = 'events_unique'`);
  assert.equal(key?.nnd, true, "events_unique treats NULL dates as equal");
  assert.match(key.cols, /\(activity, region, query, name, starts_on\)/);
  assert.equal((await one<{ r: string | null }>(pg, `select to_regclass('public.events_unique_idx')::text as r`)).r, null, "old index gone");

  for (const name of ["analyses_user_idx", "report_files_report_idx", "stacks_report_idx", "user_events_event_idx"]) {
    assert.notEqual((await one<{ r: string | null }>(pg, `select to_regclass('public.${name}')::text as r`)).r, null, `${name} exists`);
  }

  const fks = await pg.query<{ del: string }>(`select confdeltype as del from pg_constraint
    where conrelid = 'public.stacks'::regclass and contype = 'f' and confrelid = 'public.reports'::regclass`);
  assert.deepEqual(fks.rows, [{ del: "c" }], "one stacks → reports key, ON DELETE CASCADE");

  const noRls = await pg.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
  assert.deepEqual(noRls.rows, [], "every table keeps row-level security");
}

describe("migrations", () => {
  // Drizzle runs the migrations newer than the last one applied, by these times; one out of
  // order would be skipped on every database that already has a later one.
  it("are dated in order", () => {
    const when = journal.entries.map((e) => (e as unknown as { when: number }).when);
    assert.ok(when.every((w, i) => i === 0 || w > when[i - 1]), `journal times out of order: ${when.join(", ")}`);
  });
  it("deploy, then paste (twice)", async () => {
    const pg = new PGlite();
    await deploy(pg);
    await paste(pg);
    await paste(pg);
    await assertCurrentShape(pg);
    await pg.close();
  });

  it("paste, then deploy (twice)", async () => {
    const pg = new PGlite();
    await paste(pg);
    await deploy(pg);
    await deploy(pg);
    await assertCurrentShape(pg);
    await pg.close();
  });

  // Only people who finish onboarding after the tour ships see it: 0006 marks everyone
  // already onboarded as done, once, and a later re-run never marks anyone new.
  for (const order of ["deploy then paste", "paste then deploy"] as const) {
    it(`0006 marks the tour seen for people already onboarded, once (${order})`, async () => {
      const at = journal.entries.findIndex((e) => e.tag.startsWith("0006_"));
      assert.ok(at > 0, "0006 is in the journal");
      const pg = new PGlite();
      await deploy(pg, at); // production before the tour
      await pg.exec(`
        insert into users (id, email) values ('old', 'old@x'), ('mid', 'mid@x');
        insert into profiles (user_id, onboarded_at) values ('old', now() - interval '3 days');
        insert into profiles (user_id) values ('mid');
      `);
      const done = async () =>
        Object.fromEntries((await pg.query<{ user_id: string; seen: boolean }>(`select user_id, tour_done_at is not null as seen from profiles order by user_id`)).rows.map((r) => [r.user_id, r.seen]));
      if (order === "deploy then paste") {
        await deploy(pg);
        await paste(pg);
      } else {
        await paste(pg);
        await deploy(pg);
      }
      assert.deepEqual(await done(), { mid: false, old: true }, "onboarded before: seen; mid-onboarding: not yet");

      // Someone finishes onboarding after the release; running the migrations again must not hide their tour.
      await pg.exec(`update profiles set onboarded_at = now() where user_id = 'mid'`);
      await paste(pg);
      await deploy(pg);
      assert.deepEqual(await done(), { mid: false, old: true });
      await pg.close();
    });
  }

  for (const order of ["deploy then paste", "paste then deploy"] as const) {
    it(`0002 on live data (${order}): merges duplicate events and keeps picks`, async () => {
      const pg = new PGlite();
      await deploy(pg, 2); // production before this change
      await pg.exec(`
        insert into users (id, email) values ('u1', 'a@x'), ('u2', 'b@x');
        insert into events (id, activity, region, name, starts_on, fetched_at) values
          ('e1', 'runner', 'nagpur', 'Nagpur Half', null, now() - interval '3 weeks'),
          ('e2', 'runner', 'nagpur', 'Nagpur Half', null, now() - interval '2 weeks'),
          ('e3', 'runner', 'nagpur', 'Nagpur Half', null, now() - interval '1 week'),
          ('e4', 'runner', 'nagpur', 'Nagpur 10K', '2027-01-10', now());
        insert into user_events (user_id, event_id) values ('u1', 'e1'), ('u2', 'e2'), ('u2', 'e3');
        insert into reports (id, user_id) values ('r1', 'u1');
        insert into analyses (report_id, user_id, read, event_id) values ('r1', 'u1', '{}', 'e2');
        insert into stacks (id, user_id, report_id) values ('s1', 'u1', 'r1');
      `);
      if (order === "deploy then paste") {
        await deploy(pg);
        await paste(pg);
      } else {
        await paste(pg);
        await deploy(pg);
      }
      await assertCurrentShape(pg);

      const left = await pg.query<{ id: string }>(`select id from events order by id`);
      assert.deepEqual(left.rows.map((r) => r.id), ["e3", "e4"], "newest copy kept");
      const picks = await pg.query(`select user_id, event_id from user_events order by user_id`);
      assert.deepEqual(picks.rows, [{ user_id: "u1", event_id: "e3" }, { user_id: "u2", event_id: "e3" }]);
      assert.equal((await one<{ event_id: string }>(pg, `select event_id from analyses`)).event_id, "e3");

      // The upsert in lib/platform/events.ts: an undated event stays one row.
      const db = drizzle(pg, { schema });
      for (const details of ["first", "second"]) {
        await db
          .insert(schema.events)
          .values({ id: crypto.randomUUID(), activity: "runner", region: "nagpur", query: "", name: "Nagpur Half", startsOn: null, details })
          .onConflictDoUpdate({
            target: [schema.events.activity, schema.events.region, schema.events.query, schema.events.name, schema.events.startsOn],
            set: { details: sql`excluded.details`, fetchedAt: new Date() },
          });
      }
      const half = await db.select().from(schema.events).where(eq(schema.events.name, "Nagpur Half"));
      assert.equal(half.length, 1);
      assert.equal(half[0].id, "e3");
      assert.equal(half[0].details, "second");
      // Someone's named search may hold the same event as its own row.
      await db.insert(schema.events).values({ id: "e5", activity: "runner", region: "nagpur", query: "nagpur half", name: "Nagpur Half" });

      // A stack goes with its report.
      await pg.exec(`delete from reports where id = 'r1'`);
      assert.equal((await pg.query(`select 1 from stacks`)).rows.length, 0);
      await pg.close();
    });
  }
});
