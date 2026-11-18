// Lets a test import .tsx components in plain Node: each file is turned into JavaScript with
// the TypeScript compiler the repo already depends on (JSX for React's automatic runtime).
// Use with allowAppImports() for "@/…" paths. Each test file runs in its own process.
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type Loaded = { format: string; source: string; shortCircuit?: boolean };
type LoadHook = (url: string, context: object, next: (url: string, context?: object) => Loaded) => Loaded;
// module.registerHooks is in Node 24; this repo's @types/node predates it.
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { load: LoadHook }) => void };

export function allowTsx() {
  registerHooks({
    load(url, context, next) {
      if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context);
      const fileName = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
        fileName,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    },
  });
}
