// Lets a test import the app's server modules in plain Node: "server-only" becomes
// an empty module, "@/…" resolves from the repo root, extensionless imports find
// their .ts file, and named modules can be swapped for stubs. Node's test runner
// gives each test file its own process, so the hooks never leak into other files.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Resolved = { url: string; shortCircuit?: boolean };
type ResolveHook = (specifier: string, context: object, next: (specifier: string, context?: object) => Resolved) => Resolved;
// module.registerHooks is in Node 24; this repo's @types/node predates it.
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const asModule = (code: string) => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });

export function allowAppImports(stubs: Record<string, string> = {}) {
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier in stubs) return asModule(stubs[specifier]);
      if (specifier === "server-only") return asModule("export {}");
      const target = specifier.startsWith("@/") ? pathToFileURL(path.join(root, specifier.slice(2))).href : specifier;
      const local = target.startsWith(".") || target.startsWith("file:");
      if (local && !/\.(m?js|tsx?|json)$/.test(target)) {
        for (const ext of [".ts", ".tsx", "/index.ts"]) {
          try {
            return next(target + ext, context);
          } catch {}
        }
      }
      return next(target, context);
    },
  });
}

type OpenDb = { $client: { close?: () => Promise<void>; end?: (o?: { timeout?: number }) => Promise<void>; closed?: boolean } };

/** Closes the database lib/db opened in this process, whichever driver it used. */
export async function closeAppDatabase() {
  const open = (globalThis as unknown as { __dhumanDb?: Promise<OpenDb> }).__dhumanDb;
  if (!open) return;
  const d = await open.catch(() => null);
  const client = d?.$client;
  if (!client) return;
  if (typeof client.end === "function") await client.end({ timeout: 1 });
  else if (typeof client.close === "function" && !client.closed) await client.close();
}

/**
 * A fresh database for this test file, used by lib/db on first call. Returns an async
 * function that closes lib/db's connection and deletes the database.
 *
 * By default an embedded PGlite in a temporary folder, with lib/db's guard that refuses
 * what production's driver refuses (lib/db/params.ts).
 *
 * With TEST_DATABASE_URL set to a Postgres you can create databases on, a new database
 * there instead (migrated, in UTC like Supabase), reached the way production reaches
 * Supabase: lib/db's pool, postgres.js and drizzle's postgres-js driver. Then the same
 * tests prove the code against production's driver and real concurrency:
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres node --test tests/email-*.test.ts
 */
export function tempDatabase(): () => Promise<void> {
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  const admin = process.env.TEST_DATABASE_URL;
  if (admin) {
    const name = `dh_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const helper = path.join(root, "tests/support/pg-database.mjs");
    const run = (action: "create" | "drop") => {
      const r = spawnSync(process.execPath, [helper, action, admin, name], { cwd: root, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`test database ${action} failed: ${r.stderr || r.stdout}`);
    };
    run("create");
    const url = new URL(admin);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    delete process.env.PGLITE_DIR;
    return async () => {
      await closeAppDatabase();
      run("drop");
    };
  }
  const dir = mkdtempSync(path.join(tmpdir(), "dhuman-test-"));
  process.env.PGLITE_DIR = path.join(dir, "pglite");
  delete process.env.DATABASE_URL;
  return async () => {
    await closeAppDatabase();
    rmSync(dir, { recursive: true, force: true });
  };
}
