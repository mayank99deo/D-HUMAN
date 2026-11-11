// Applies the SQL migrations in ./drizzle to the Postgres database (DATABASE_URL, or
// POSTGRES_URL from Vercel's Supabase integration). Runs before `next build`.
// - On Vercel, only production builds migrate. Preview builds share the variables
//   and would otherwise change the live database from an unmerged branch.
// - Locally and elsewhere it migrates whenever a Postgres URL is set, and skips
//   quietly when none is (local dev migrates its embedded database on first use).
//
// It does what drizzle's migrator does, with the same bookkeeping table
// (drizzle.__drizzle_migrations), but inside one transaction that first takes an
// advisory lock, so two builds at once take turns instead of racing. The lock is
// transaction-scoped on purpose: behind Supabase's transaction pooler a session
// lock could stay held on a pooled connection after we disconnect.
import postgres from "postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { databaseUrl } from "../lib/db/url.mjs";

if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  console.log(`[db] ${process.env.VERCEL_ENV || "non-production"} build on Vercel; skipping migrations (only production builds migrate).`);
  process.exit(0);
}

const url = databaseUrl();
if (!url) {
  console.log("[db] No Postgres connection string (DATABASE_URL or POSTGRES_URL); skipping migrations.");
  process.exit(0);
}

const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  const applied = await client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('d-human:migrations'))`;
    // Fail fast rather than queue behind live traffic while holding table locks.
    await tx`set local lock_timeout = '15s'`;
    await tx`create schema if not exists drizzle`;
    await tx`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
    const done = (await tx`select created_at from drizzle.__drizzle_migrations`).map((r) => Number(r.created_at));
    const last = done.length ? Math.max(...done) : -Infinity;

    // drizzle only applies migrations newer than the newest one applied, so one
    // generated on a branch and merged after a newer one would be skipped for good.
    const skipped = migrations.filter((m) => m.folderMillis < last && !done.includes(m.folderMillis));
    if (skipped.length) {
      throw new Error(
        `[db] ${skipped.length} migration(s) are older than the newest one applied and would never run. ` +
          "Regenerate them so they sort last (delete the file and its journal entry, then `npm run db:generate`).",
      );
    }

    let count = 0;
    for (const m of migrations) {
      if (m.folderMillis <= last) continue;
      for (const statement of m.sql) {
        if (statement.trim()) await tx.unsafe(statement);
      }
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${m.hash}, ${m.folderMillis})`;
      count++;
    }
    return count;
  });
  console.log(applied ? `[db] Applied ${applied} migration(s).` : "[db] Database is up to date.");
} finally {
  await client.end();
}
