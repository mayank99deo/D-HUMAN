import "server-only";
import path from "node:path";
import * as schema from "./schema";
import { databaseUrl } from "./url.mjs";

// Two ways to run:
// - DATABASE_URL (or POSTGRES_URL, from Vercel's Supabase or Neon integration) set
//   to a postgres:// URL: production on Supabase, Neon or any Postgres.
// - Neither set (local dev): an embedded Postgres (PGlite) in .data/pglite,
//   migrated automatically, so `npm run dev` works with no setup.
// Vercel has no writable disk, so there a connection string is required.

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __dhumanDb?: Promise<Db> };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

async function connect(): Promise<Db> {
  const url = databaseUrl();
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare:false keeps it working behind transaction poolers (Neon, Supabase).
    const client = postgres(url, { max: 5, prepare: false });
    return drizzle(client, { schema }) as unknown as Db;
  }
  if (process.env.VERCEL) {
    throw new Error("No database: set DATABASE_URL (or connect Supabase, which sets POSTGRES_URL) in Vercel.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.dirname(dir), { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

export function db(): Promise<Db> {
  globalForDb.__dhumanDb ??= connect().catch((err) => {
    globalForDb.__dhumanDb = undefined;
    throw err;
  });
  return globalForDb.__dhumanDb;
}

export { schema };
