// Static guards over every Ask file that exists (contract §17, threats spec D12–D13): no
// cache APIs (a cached pack would miss a new urgent flag), no HTML injection or markdown
// libraries, no query strings (the question never travels in a URL), no logging of the
// question, answer or data, and the route's config as Next 16 and vercel.json need it.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const inDir = (dir: string, match: RegExp) =>
  existsSync(path.join(ROOT, dir)) ? readdirSync(path.join(ROOT, dir)).filter((f) => match.test(f)).map((f) => path.join(ROOT, dir, f)) : [];

const ASK_FILES = [
  ...walk(path.join(ROOT, "lib/ask")),
  ...walk(path.join(ROOT, "app/api/ask")),
  ...["lib/platform/ask.ts", "lib/ai/ask.ts"].map((f) => path.join(ROOT, f)).filter(existsSync),
  ...inDir("lib/domain", /^ask-.*\.tsx?$/),
  ...inDir("components/platform", /^(Ask.*|ask-.*)\.tsx?$/),
].filter((f) => /\.tsx?$/.test(f));
const text = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(ROOT, f);

describe("Ask's files", () => {
  it("are found", () => {
    for (const f of ["lib/ask/types.ts", "lib/platform/ask.ts", "app/api/ask/route.ts", "app/api/ask/consent/route.ts", "lib/ai/ask.ts"]) {
      assert.ok(ASK_FILES.includes(path.join(ROOT, f)), f);
    }
  });

  it("use no cache APIs, no dangerouslySetInnerHTML and no markdown library", () => {
    const banned = [/["']use cache["']/, /\bunstable_cache\b/, /\bcacheLife\b/, /\bcacheTag\b/, /dangerouslySetInnerHTML/, /react-markdown/, /\bfrom\s+["']marked["']/, /markdown-it/, /\binnerHTML\b/];
    for (const f of ASK_FILES) for (const b of banned) assert.doesNotMatch(text(f), b, `${rel(f)}: ${b}`);
  });

  it("never log the question, the answer, the person's data or an error's message", () => {
    const owned = ASK_FILES.filter((f) => /lib\/platform\/ask\.ts$|app\/api\/ask\//.test(f));
    for (const f of owned) {
      const calls = text(f).match(/console\.\w+\([^;]*\)/g) ?? [];
      for (const call of calls) {
        assert.doesNotMatch(call, /\b(question|answer|body|raw|data|input|load|profile|reply\.answer|turn)\b(?!\s*=)/, `${rel(f)}: ${call}`);
        assert.doesNotMatch(call, /\.message\b|, error\)|,\s*e\)/, `${rel(f)}: ${call}`);
      }
    }
  });

  it("read no query string: the question travels only in the POST body", () => {
    for (const f of walk(path.join(ROOT, "app/api/ask"))) {
      assert.doesNotMatch(text(f), /searchParams|nextUrl|new URL\(request\.url\)/, rel(f));
    }
  });

  it("give the route a literal maxDuration of 30 and no runtime or region export", () => {
    const route = text(path.join(ROOT, "app/api/ask/route.ts"));
    assert.match(route, /^export const maxDuration = 30;$/m);
    assert.doesNotMatch(route, /export const (runtime|preferredRegion|dynamic|revalidate)\b/);
    assert.match(route, /export async function (GET|POST|DELETE)\b/g);
    for (const method of ["GET", "POST", "DELETE"]) assert.match(route, new RegExp(`export async function ${method}\\b`));
  });

  it("reach the AI only through askPreCheck and answerAsk", () => {
    for (const f of ASK_FILES.filter((x) => !x.endsWith("lib/ai/ask.ts"))) {
      const imports = text(f).match(/import\s+\{([^}]*)\}\s+from\s+["']@\/lib\/ai\/ask["']/);
      if (imports) assert.deepEqual(imports[1].split(",").map((s) => s.trim()).filter(Boolean).sort(), ["answerAsk", "askPreCheck"], rel(f));
    }
    assert.doesNotMatch(text(path.join(ROOT, "lib/platform/ask.ts")), /@\/lib\/ai\/ask["']/, "the data layer never calls the AI");
  });
});
