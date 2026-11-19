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

  // 0009: the blog, lifecycle email, feedback answers, the job lease.
  const tables = (await pg.query<{ t: string }>(`select relname as t from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)).rows.map((r) => r.t);
  for (const t of BLOG_AND_EMAIL_TABLES) assert.ok(tables.includes(t), `${t} exists`);
  for (const name of BLOG_AND_EMAIL_INDEXES) {
    assert.notEqual((await one<{ r: string | null }>(pg, `select to_regclass('public.${name}')::text as r`)).r, null, `${name} exists`);
  }
  const partial = await pg.query<{ name: string; def: string }>(`select indexname as name, indexdef as def from pg_indexes
    where indexname in ('blog_posts_one_featured_idx', 'blog_posts_live_idx', 'email_sends_open_idx', 'feedback_answers_unsynced_idx')`);
  assert.equal(partial.rows.length, 4);
  for (const r of partial.rows) assert.match(r.def, / WHERE /, `${r.name} is partial`);
  const finished = await pg.query(`select 1 from information_schema.columns where table_name = 'wraps' and column_name = 'finished_at'`);
  assert.equal(finished.rows.length, 1, "wraps.finished_at exists");

  // 0010: the daily count of emails sent outside the lifecycle ledger, keyed by day and stream.
  const pk = await one<{ def: string }>(pg, `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'email_daily_counts_day_stream_pk'`);
  assert.equal(pk?.def, "PRIMARY KEY (day, stream)");

  // 0011: Ask's three tables (RLS is checked above for every table), their keys and indexes.
  for (const t of ["ask_turns", "ask_days", "ask_totals"]) assert.ok(tables.includes(t), `${t} exists`);
  const askPk = await one<{ def: string }>(pg, `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'ask_days_user_id_day_pk'`);
  assert.equal(askPk?.def, "PRIMARY KEY (user_id, day)");
  const askFks = await pg.query<{ t: string; del: string; ref: string }>(`select conrelid::regclass::text as t, confdeltype as del, confrelid::regclass::text as ref
    from pg_constraint where contype = 'f' and conrelid in ('public.ask_turns'::regclass, 'public.ask_days'::regclass, 'public.ask_totals'::regclass) order by 1`);
  assert.deepEqual(askFks.rows, [{ t: "ask_days", del: "c", ref: "users" }, { t: "ask_turns", del: "c", ref: "users" }], "user keys cascade; report_id has none");
  const askIdx = await pg.query<{ name: string; def: string }>(`select indexname as name, indexdef as def from pg_indexes where tablename = 'ask_turns' and indexname like 'ask_turns_%_idx' order by 1`);
  assert.deepEqual(askIdx.rows.map((r) => r.name), ["ask_turns_client_key_idx", "ask_turns_day_idx", "ask_turns_user_day_idx"]);
  assert.ok(askIdx.rows[0].def.includes("UNIQUE INDEX") && askIdx.rows[0].def.includes("(user_id, client_key)"), askIdx.rows[0].def);
  assert.ok(askIdx.rows[2].def.includes("(user_id, day, created_at)"), askIdx.rows[2].def);
  const consentCol = await pg.query(`select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'ask_consent_at' and data_type = 'timestamp with time zone'`);
  assert.equal(consentCol.rows.length, 1, "profiles.ask_consent_at exists");
}

const BLOG_AND_EMAIL_TABLES = [
  "blog_authors", "blog_posts", "blog_slugs", "blog_images", "blog_image_files", "blog_publishes", "blog_reviews",
  "email_prefs", "email_sends", "email_suppressions", "feedback_answers", "job_runs", "email_daily_counts",
];
const BLOG_AND_EMAIL_INDEXES = [
  "blog_posts_live_idx", "blog_posts_one_featured_idx", "blog_publishes_post_idx", "blog_reviews_post_idx",
  "email_sends_dedupe_idx", "email_sends_provider_idx", "email_sends_sent_idx", "email_sends_open_idx",
  "feedback_answers_question_idx", "feedback_answers_unsynced_idx",
];

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

  // Production before the blog, then only 0009 pasted into Supabase, then the deploy.
  it("0009 pasted onto production, then the deploy", async () => {
    const at = journal.entries.findIndex((e) => e.tag.startsWith("0009_"));
    assert.ok(at > 0, "0009 is in the journal");
    const pg = new PGlite();
    await deploy(pg, at);
    await pg.exec(`insert into users (id, email) values ('u1', 'a@x'); insert into wraps (id, user_id, period, starts_on, ends_on, stats, story) values ('w1', 'u1', 'week', '2026-11-16', '2026-11-22', '{}', '{}');`);
    await pg.exec(files[at]);
    await pg.exec(files[at]);
    await deploy(pg);
    await assertCurrentShape(pg);
    assert.equal((await one<{ n: number }>(pg, `select count(*)::int as n from wraps where finished_at is null`)).n, 1, "existing wraps kept");
    await pg.close();
  });

  // Production with 0009, then only 0010 pasted into Supabase (twice), then the deploy.
  it("0010 pasted onto production, then the deploy", async () => {
    const at = journal.entries.findIndex((e) => e.tag.startsWith("0010_"));
    assert.ok(at > 0, "0010 is in the journal");
    const pg = new PGlite();
    await deploy(pg, at);
    await pg.exec(files[at]);
    await pg.exec(`insert into email_daily_counts (day, stream, sent) values ('2026-11-18', 'waitlist_welcome', 2)`);
    await pg.exec(files[at]);
    await deploy(pg);
    await assertCurrentShape(pg);
    assert.equal((await one<{ n: number }>(pg, `select sent as n from email_daily_counts`)).n, 2, "counts kept");
    await pg.close();
  });

  // Production with 0010, then only 0011 pasted into Supabase (twice), then the deploy.
  it("0011 pasted onto production, then the deploy", async () => {
    const at = journal.entries.findIndex((e) => e.tag.startsWith("0011_"));
    assert.ok(at > 0, "0011 is in the journal");
    const pg = new PGlite();
    await deploy(pg, at);
    await pg.exec(`insert into users (id, email) values ('u1', 'a@x'); insert into profiles (user_id, consent_at, onboarded_at) values ('u1', now(), now());`);
    await pg.exec(files[at]);
    await pg.exec(`insert into ask_days (user_id, day, used, attempts) values ('u1', '2026-11-19', 2, 3)`);
    await pg.exec(files[at]);
    await deploy(pg);
    await assertCurrentShape(pg);
    assert.equal((await one<{ n: number }>(pg, `select used as n from ask_days`)).n, 2, "counts kept");
    assert.equal((await one<{ c: string | null }>(pg, `select ask_consent_at::text as c from profiles`)).c, null, "existing people see the one-time notice");
    await pg.close();
  });

  it("0011's keys: one question per client key a person, deletes cascade with the account, nobody but the owner reads Ask", async () => {
    const pg = new PGlite();
    await deploy(pg);
    await pg.exec(`
      insert into users (id, email) values ('u1', 'a@x'), ('u2', 'b@x');
      insert into ask_turns (id, user_id, client_key, day, question, report_id) values ('t1', 'u1', 'k', '2026-11-19', 'q', 'gone-report');
      insert into ask_turns (id, user_id, client_key, day, question) values ('t2', 'u2', 'k', '2026-11-19', 'q');
      insert into ask_days (user_id, day, used, attempts) values ('u1', '2026-11-19', 1, 1);
      insert into ask_totals (day, attempts) values ('2026-11-19', 2);
    `);
    await assert.rejects(pg.exec(`insert into ask_turns (id, user_id, client_key, day, question) values ('t3', 'u1', 'k', '2026-11-20', 'again')`), /ask_turns_client_key_idx/);
    assert.deepEqual(await one(pg, `select status, counted from ask_turns where id = 't2'`), { status: "pending", counted: true });

    // Supabase's Data API roles: row-level security on with no policies shows them nothing.
    await pg.exec(`do $$ begin create role anon_test nologin; exception when duplicate_object then null; end $$;
      grant usage on schema public to anon_test; grant select on ask_turns, ask_days, ask_totals to anon_test;`);
    await pg.exec(`set role anon_test`);
    const seen = await one(pg, `select (select count(*)::int from ask_turns) as t, (select count(*)::int from ask_days) as d, (select count(*)::int from ask_totals) as x`);
    await pg.exec(`reset role`);
    assert.deepEqual(seen, { t: 0, d: 0, x: 0 });

    await pg.exec(`delete from users where id = 'u1'`);
    const left = await one(pg, `select (select count(*)::int from ask_turns) as t, (select count(*)::int from ask_days) as d, (select count(*)::int from ask_totals) as x`);
    assert.deepEqual(left, { t: 1, d: 0, x: 1 }, "u1's questions and counts go; u2's and the totals stay");
    await pg.close();
  });

  it("0009's keys: one featured post, authors kept while they have posts, slugs retired, account data cascades, one send per key", async () => {
    const pg = new PGlite();
    await deploy(pg);
    await pg.exec(`
      insert into blog_authors (id, email, slug, name) values ('a1', 'm@x', 'mayank', 'Mayank');
      insert into blog_posts (id, slug, author_id, featured, status, published_at) values ('p1', 'roti-calories', 'a1', true, 'live', now());
      insert into blog_slugs (slug, post_id) values ('roti-calories', 'p1'), ('old-roti', 'p1');
    `);
    await assert.rejects(pg.exec(`insert into blog_posts (id, slug, author_id, featured) values ('p2', 'second', 'a1', true)`), /blog_posts_one_featured_idx/);
    await pg.exec(`insert into blog_posts (id, slug, author_id) values ('p2', 'second', 'a1')`);
    await assert.rejects(pg.exec(`delete from blog_authors where id = 'a1'`), /foreign key/);
    await pg.exec(`delete from blog_posts where id = 'p1'`);
    const slugs = await pg.query(`select slug, post_id from blog_slugs order by slug`);
    assert.deepEqual(slugs.rows, [{ slug: "old-roti", post_id: null }, { slug: "roti-calories", post_id: null }], "a deleted post's slugs stay retired");

    await pg.exec(`insert into users (id, email) values ('u1', 'a@x')`);
    const claim = `insert into email_sends (id, user_id, kind, dedupe_key, local_date) values ($1, 'u1', 'weekly', '2026-11-16', '2026-11-22')
      on conflict (user_id, kind, dedupe_key) do nothing returning id`;
    assert.equal((await pg.query(claim, ["s1"])).rows.length, 1);
    assert.equal((await pg.query(claim, ["s2"])).rows.length, 0, "a second claim for the same week sends nothing");
    await pg.exec(`
      insert into email_prefs (user_id, weekly) values ('u1', false);
      insert into feedback_answers (id, user_id, survey, question, answer, source) values ('f1', 'u1', 'fb-1', 'feel', 'very', 'page');
      insert into email_suppressions (email_hash, reason) values (encode(sha256(convert_to('a@x', 'UTF8')), 'hex'), 'bounce');
      delete from users where id = 'u1';
    `);
    const left = await one<{ p: number; s: number; f: number; x: number }>(pg, `select
      (select count(*)::int from email_prefs) as p, (select count(*)::int from email_sends) as s,
      (select count(*)::int from feedback_answers) as f, (select count(*)::int from email_suppressions) as x`);
    assert.deepEqual(left, { p: 0, s: 0, f: 0, x: 1 }, "account data goes; the hashed suppression stays");
    await pg.close();
  });

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
