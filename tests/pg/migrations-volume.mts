// Migrations 0012–0018 on a production-shaped database (opt-in; not part of npm test). Builds a
// database at 0011 (the schema production had before the app backend), fills it at many times
// production's volume (users, profiles, cookie sessions, meals, the usage ledger, reports), then:
//   1. runs 0012–0018 the way the deploy does (scripts/db-migrate.mjs: one transaction, the
//      advisory lock, lock_timeout 15s), timing it, while a second connection keeps doing what the
//      live web does (a sign-in insert, a session lookup, a meal read), timing how long each waits;
//   2. checks what it left: every old session is a cookie with its own public id, every table has
//      row-level security on, the new constraints exist, and no old row changed;
//   3. runs it all again, both ways (the deploy's migrator, and a paste of each file into Supabase's
//      SQL editor): nothing to do, no error;
//   4. checks the old code's writes still work on the new schema (the rollback path): a cookie
//      session, a meal and a report inserted as the pre-app code inserts them.
//
//   TEST_DATABASE_URL=postgres://user:pass@host:5432/postgres [MIG_USERS=20000] node tests/pg/migrations-volume.mts
// Without TEST_DATABASE_URL it says so and exits 0. It makes its own database and drops it after.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";

const admin = process.env.TEST_DATABASE_URL;
if (!admin) {
  console.log("skipped: set TEST_DATABASE_URL to a Postgres you can create databases on");
  process.exit(0);
}
const USERS = Number(process.env.MIG_USERS ?? 20_000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const all = readMigrationFiles({ migrationsFolder: path.join(root, "drizzle") });
const firstApp = all.findIndex((m) => m.sql.join("\n").includes('"sessions" ADD COLUMN IF NOT EXISTS "kind"'));
assert.ok(firstApp > 0, "found 0012");
const before = all.slice(0, firstApp);
const app = all.slice(firstApp);
assert.equal(app.length, 7, "0012 to 0018");

const name = `dh_mig_${process.pid}`;
const a = postgres(admin, { max: 1, onnotice: () => {} });
await a.unsafe(`drop database if exists ${name} with (force)`);
await a.unsafe(`create database ${name}`);
await a.unsafe(`alter database ${name} set timezone to 'UTC'`);
const url = new URL(admin);
url.pathname = `/${name}`;
const sql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
const probe = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });

/** scripts/db-migrate.mjs's loop, for a given list of migrations. Returns how many it applied. */
async function deploy(migrations: typeof all): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('d-human:migrations'))`;
    await tx`set local lock_timeout = '15s'`;
    await tx`create schema if not exists drizzle`;
    await tx`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
    const done = (await tx`select created_at from drizzle.__drizzle_migrations`).map((r) => Number(r.created_at));
    const last = done.length ? Math.max(...done) : -Infinity;
    let n = 0;
    for (const m of migrations) {
      if (m.folderMillis <= last) continue;
      for (const statement of m.sql) if (statement.trim()) await tx.unsafe(statement);
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${m.hash}, ${m.folderMillis})`;
      n++;
    }
    return n;
  }) as Promise<number>;
}

try {
  // ── The schema production had before the app backend, and its data ────────
  assert.equal(await deploy(before), before.length);
  const t0 = Date.now();
  await sql.unsafe(`
    insert into users (id, email, created_at) select 'u' || g, 'p' || g || '@example.com', now() - (g % 400) * interval '1 day' from generate_series(1, ${USERS}) g;
    insert into profiles (user_id, name, consent_at, onboarded_at, timezone) select 'u' || g, 'Person ' || g, now() - interval '30 days', case when g % 10 = 0 then null else now() - interval '29 days' end, 'Asia/Kolkata' from generate_series(1, ${USERS}) g;
    insert into sessions (id, user_id, expires_at, created_at) select md5('s' || g), 'u' || (g % ${USERS} + 1), now() + (g % 60 - 10) * interval '1 day', now() - (g % 30) * interval '1 day' from generate_series(1, ${USERS * 3}) g;
    insert into food_logs (id, user_id, local_date, meal, source, title, items, kcal, protein_g, carbs_g, fat_g, fibre_g, micros)
      select 'f' || g, 'u' || (g % ${USERS} + 1), (current_date - (g % 60))::date, 'lunch', 'text', 'Dal, two rotis', '[]'::jsonb, 420, 18, 60, 10, 8, '{}'::jsonb from generate_series(1, ${USERS * 20}) g;
    insert into usage (id, user_id, kind, ref_id, local_date) select 'm' || g, 'u' || (g % ${USERS} + 1), 'meal', 'f' || g, (current_date - (g % 60))::date from generate_series(1, ${USERS * 20}) g;
    insert into reports (id, user_id, status, file_name) select 'r' || g, 'u' || (g % ${USERS} + 1), 'ready', 'report.pdf' from generate_series(1, ${USERS}) g;
    insert into usage (id, user_id, kind, ref_id) select 'ur' || g, 'u' || (g % ${USERS} + 1), 'read', 'r' || g from generate_series(1, ${USERS}) g;
    analyze;
  `);
  const counts = (await sql`select (select count(*) from users) u, (select count(*) from sessions) s, (select count(*) from food_logs) f, (select count(*) from usage) us, (select count(*) from reports) r`)[0];
  console.log(`filled in ${Date.now() - t0} ms:`, counts);
  const fingerprint = async () =>
    (await sql`select md5(string_agg(id || user_id || expires_at::text || created_at::text, ',' order by id)) s from sessions`)[0].s +
    (await sql`select md5(string_agg(id || local_date::text || kcal::text, ',' order by id)) f from food_logs`)[0].f;
  const was = await fingerprint();

  // ── 1. The deploy's run, with the live web going on beside it ─────────────
  let stop = false;
  const waits: Record<string, number> = { signIn: 0, lookup: 0, meals: 0 };
  let probes = 0;
  const web = (async () => {
    while (!stop) {
      const time = async (k: string, q: () => Promise<unknown>) => {
        const s = performance.now();
        await q();
        waits[k] = Math.max(waits[k], performance.now() - s);
      };
      const id = `probe-${probes++}`;
      await time("signIn", () => probe`insert into sessions (id, user_id, expires_at) values (${id}, 'u1', now() + interval '30 days')`);
      await time("lookup", () => probe`select s.user_id from sessions s join users u on u.id = s.user_id where s.id = ${id} and s.expires_at > now()`);
      await time("meals", () => probe`select id, kcal from food_logs where user_id = 'u2' and local_date >= current_date - 1`);
    }
  })();
  await new Promise((r) => setTimeout(r, 200));
  const m0 = performance.now();
  assert.equal(await deploy(app), 7);
  const took = performance.now() - m0;
  await new Promise((r) => setTimeout(r, 200));
  stop = true;
  await web;
  console.log(`0012–0018 applied in ${took.toFixed(0)} ms; the web's longest waits meanwhile (ms):`, Object.fromEntries(Object.entries(waits).map(([k, v]) => [k, Math.round(v)])), `over ${probes} rounds`);

  // ── 2. What it left ───────────────────────────────────────────────────────
  const s = (await sql`select count(*)::int n, count(distinct public_id)::int ids, count(*) filter (where kind = 'cookie')::int cookies, count(*) filter (where last_used_at is not null or absolute_expires_at is not null or device_label is not null)::int touched from sessions`)[0];
  assert.deepEqual([s.ids, s.cookies, s.touched], [s.n, s.n, 0], "every old session: a cookie, its own public id, nothing else set");
  const noRls = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
  assert.deepEqual(noRls.map((r) => r.relname), [], "row-level security on for every table");
  for (const con of ["sessions_kind_check", "users_store_account_token_unique"]) assert.equal((await sql`select 1 from pg_constraint where conname = ${con}`).length, 1, con);
  for (const idx of ["sessions_public_id_idx", "reports_user_upload_key_idx"]) assert.notEqual((await sql`select to_regclass(${`public.${idx}`})::text r`)[0].r, null, idx);
  assert.equal((await sql`select count(*)::int n from food_logs where eaten_at is not null or input_raw is not null or repeat_of is not null`)[0].n, 0);
  assert.equal((await sql`select count(*)::int n from profiles where health_checked_at is not null or consent_first_at is not null`)[0].n, 0);
  await sql`delete from sessions where id like 'probe-%'`;
  assert.equal(await fingerprint(), was, "no old session or meal changed");

  // ── 3. Again, both ways ───────────────────────────────────────────────────
  assert.equal(await deploy(all), 0, "the deploy's migrator finds nothing to do");
  for (const m of app) await sql.unsafe(m.sql.join("\n"));
  for (const m of app) await sql.unsafe(m.sql.join("\n"));
  assert.equal(await fingerprint(), was, "pasting 0012–0018 twice more changed nothing");

  // ── 4. The old code's writes on the new schema (a rollback) ───────────────
  await sql`insert into sessions (id, user_id, expires_at) values ('old-code-cookie', 'u3', now() + interval '30 days')`;
  const [old] = await sql`select kind, public_id from sessions where id = 'old-code-cookie'`;
  assert.equal(old.kind, "cookie");
  assert.match(old.public_id, /^[0-9a-f-]{36}$/);
  await sql`insert into food_logs (id, user_id, local_date, meal, source, title, items, kcal, protein_g, carbs_g, fat_g, fibre_g, micros) values ('old-code-meal', 'u3', current_date, 'lunch', 'text', 'Poha', '[]', 300, 8, 50, 8, 4, '{}')`;
  await sql`insert into reports (id, user_id, file_name) values ('old-code-report', 'u3', 'r.pdf')`;
  await sql`insert into reports (id, user_id, file_name) values ('old-code-report-2', 'u3', 'r.pdf')`;
  console.log("ok: 0012–0018 at volume, again both ways, and the pre-app code's writes on the new schema");
} finally {
  await probe.end({ timeout: 1 });
  await sql.end({ timeout: 1 });
  await a.unsafe(`drop database if exists ${name} with (force)`);
  await a.end({ timeout: 1 });
}
