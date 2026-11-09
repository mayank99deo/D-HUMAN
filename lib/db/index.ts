import "server-only";
import path from "node:path";
import * as schema from "./schema";

// Two ways to run:
// - DATABASE_URL set to a postgres:// URL (production: Neon, Supabase or any Postgres).
// - DATABASE_URL unset (local dev): an embedded Postgres (PGlite) in .data/pglite,
//   migrated automatically, so `npm run dev` works with no setup.
// Vercel has no writable disk, so there DATABASE_URL is required.

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __dhumanDb?: Promise<Db> };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare:false keeps it working behind transaction poolers (Neon, Supabase).
    const client = postgres(url, { max: 5, prepare: false });
    return drizzle(client, { schema }) as unknown as Db;
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Add a Postgres connection string in Vercel.");
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
