// A database reached through production's driver: lib/db's pool (lib/db/pool.ts), postgres.js
// and drizzle's postgres-js driver, as on Vercel. PGlite, which the other tests use, takes
// values that driver refuses (a Date outside a column: the daily email job's bug of
// 2026-11-24), so a test that must prove the production path uses this.
//
// - TEST_DATABASE_URL set: a fresh database on that real Postgres (tempDatabase in app.ts).
// - Otherwise, in the normal `npm test`: an in-memory PGlite, migrated, behind the wire
//   stand-in (tests/support/pg-wire.ts), so postgres.js connects to it as to Supabase.
//   The client side is production's own; the server is PGlite (one session handed to one
//   connection at a time, a millisecond clock).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { closeAppDatabase, tempDatabase } from "./app.ts";
import { pgWireServer } from "./pg-wire.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Call before lib/db's first db(). Returns an async function that closes and deletes it all. */
export async function driverDatabase(): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL) return tempDatabase();
  const pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: path.join(root, "drizzle") });
  const server = await pgWireServer(pg);
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${server.port}/postgres`;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  delete process.env.PGLITE_DIR;
  return async () => {
    await closeAppDatabase();
    await server.close();
  };
}
