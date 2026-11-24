// Makes or drops one throwaway database on a real Postgres, for tempDatabase() in
// tests/support/app.ts when TEST_DATABASE_URL is set. Run as a child process, so the
// test file's setup can stay synchronous:
//   node tests/support/pg-database.mjs create <admin url> <name>   (then migrates it)
//   node tests/support/pg-database.mjs drop <admin url> <name>
// The new database runs in UTC, as Supabase does.
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const [action, adminUrl, name] = process.argv.slice(2);
if (!/^dh_test_[a-z0-9_]+$/.test(name ?? "")) throw new Error(`refusing database name "${name}"`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });
try {
  if (action === "create") {
    await admin.unsafe(`create database ${name}`);
    await admin.unsafe(`alter database ${name} set timezone to 'UTC'`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    const client = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
    try {
      await migrate(drizzle(client), { migrationsFolder: path.join(root, "drizzle") });
    } finally {
      await client.end({ timeout: 1 });
    }
  } else if (action === "drop") {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
  } else {
    throw new Error(`unknown action "${action}"`);
  }
} finally {
  await admin.end({ timeout: 1 });
}
