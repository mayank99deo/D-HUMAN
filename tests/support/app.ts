// Lets a test import the app's server modules in plain Node: "server-only" becomes
// an empty module, "@/…" resolves from the repo root, extensionless imports find
// their .ts file, and named modules can be swapped for stubs. Node's test runner
// gives each test file its own process, so the hooks never leak into other files.
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

// A fresh embedded database in a temporary folder, used by lib/db on first call.
// Returns a function that deletes the folder.
export function tempDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), "dhuman-test-"));
  process.env.PGLITE_DIR = path.join(dir, "pglite");
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  return () => rmSync(dir, { recursive: true, force: true });
}
