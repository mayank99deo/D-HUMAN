// Applies the SQL migrations in ./drizzle to the Postgres database (DATABASE_URL, or
// POSTGRES_URL from Vercel's Supabase integration). Runs before `next build`,
// so every deploy brings the database up to date. Skips quietly when no Postgres URL
// is set (local dev migrates its embedded database on first use instead).
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { databaseUrl } from "../lib/db/url.mjs";

const url = databaseUrl();
if (!url) {
  console.log("[db] No Postgres connection string (DATABASE_URL or POSTGRES_URL); skipping migrations.");
  process.exit(0);
}
const client = postgres(url, { max: 1, prepare: false });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("[db] Migrations applied.");
} finally {
  await client.end();
}
