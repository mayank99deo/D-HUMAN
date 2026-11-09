// Applies the SQL migrations in ./drizzle to DATABASE_URL. Runs before `next build`,
// so every deploy brings the database up to date. Skips quietly when no Postgres URL
// is set (local dev migrates its embedded database on first use instead).
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.log("[db] DATABASE_URL is not a Postgres URL; skipping migrations.");
  process.exit(0);
}
const client = postgres(url, { max: 1, prepare: false });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("[db] Migrations applied.");
} finally {
  await client.end();
}
