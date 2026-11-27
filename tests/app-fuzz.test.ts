// Contract fuzzing for the apps' routes (backend test engineer, hunt 1). Requests are generated
// from docs/api/openapi.json itself (the request schemas, as JSON Schema): valid ones, boundary
// ones and malformed ones, from a seeded generator so every failure names a seed that repeats
// it. Every answer, for every route, is checked against the contract:
//   - its status is one the route lists, and never a 500 (the AI here never fails);
//   - its body parses against that status's schema, and a refusal carries only documented keys;
//   - it's private, no-store (or the route's public/web header), sets no cookie, has no CORS;
//   - its JSON holds no lone surrogate (Swift's JSONDecoder refuses the whole answer for one);
//   - a request the contract calls valid isn't refused as malformed (400 invalid).
// Then every screen is read again for the people the fuzz wrote to, so stored oddities can't
// break a later read. FUZZ_SEED and FUZZ_RUNS (cases per route and mode) repeat or widen it:
//   FUZZ_SEED=123 FUZZ_RUNS=200 node --test tests/app-fuzz.test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
const g = globalThis as unknown as { __headers?: Headers; __after: (() => unknown)[] };
g.__after = [];

allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: () => undefined, set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/email/send": "export const sendFounderAlert = async () => ({ status: 'sent' });",
  "@/lib/auth/email": "export const sendSignInCode = async () => true;",
});
// The AI in mock mode: meals, usual days and wraps run their whole path, store included.
delete process.env.ANTHROPIC_API_KEY;
process.env.D_HUMAN_AI_MOCK = "1";
const removeDatabase = tempDatabase();

const { APP_ROUTES, openapi } = await import("../lib/api/openapi.ts");
const { person, meal } = await import("./support/app-people.ts");
const { optionsJson } = await import("../lib/api/views/app.ts");

after(async () => {
  await removeDatabase();
});

const SEED = Number(process.env.FUZZ_SEED ?? 20261126);
const RUNS = Number(process.env.FUZZ_RUNS ?? 10);
const SITE = "https://www.d-human.fit";
type Route = (typeof APP_ROUTES)[number];
type Js = Record<string, unknown> & {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: Js[];
  properties?: Record<string, Js>;
  required?: string[];
  items?: Js;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
};
const doc = openapi() as unknown as { paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: Js }> } }>> };
const handlers = new Map<string, Handler>();
for (const r of APP_ROUTES) handlers.set(`${r.method} ${r.path}`, (await import(`../${r.file}`))[r.method.toUpperCase()] as Handler);

// ── A seeded generator ───────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

// Real words people type: Latin, Devanagari, Tamil, Bengali, Urdu, emoji (outside the BMP), and
// marks that are legal text (a zero-width joiner, a right-to-left mark, a combining accent).
const WORDS = ["dal", "roti", "chawal", "2 eggs", "दो रोटी", "दाल", "சாதம்", "ভাত", "چاول", "🍛", "👍🏽", "café", "é", "a‍b", "‏", "100g", "1/2 katori", "chai ☕"];
const text = (r: Rng, min: number, max: number) => {
  let s = "";
  const want = int(r, min, Math.max(min, Math.min(max, min + 60)));
  while ([...s].length < want) s += `${pick(r, WORDS)} `;
  // Trimmed, as every route trims words before it counts them.
  const out = [...s.trim().padEnd(want, "x")].slice(0, want).join("");
  return /\s$/.test(out) ? `${out.slice(0, -1)}x` : out;
};
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const keyOf = (r: Rng, n = int(r, 16, 64)) => Array.from({ length: n }, () => ALNUM[Math.floor(r() * ALNUM.length)]).join("");
let emails = 0;

/** A value the schema allows. `edge`: at the schema's bounds where it has them. */
function valid(r: Rng, s: Js, edge = false): unknown {
  if (s.const !== undefined) return s.const;
  if (s.enum) return pick(r, s.enum);
  if (s.anyOf) return valid(r, pick(r, s.anyOf), edge);
  const type = Array.isArray(s.type) ? pick(r, s.type) : s.type;
  if (type === "null") return null;
  if (type === "boolean") return r() < 0.5;
  if (type === "integer" || type === "number") {
    const lo = s.minimum ?? -1000;
    const hi = Math.min(s.maximum ?? 1000, 10_000);
    return edge ? pick(r, [lo, hi]) : int(r, lo, hi);
  }
  if (type === "array") return Array.from({ length: edge ? (s.maxItems ?? 3) : int(r, 0, Math.min(s.maxItems ?? 3, 3)) }, () => valid(r, s.items ?? { type: "string" }, edge));
  if (type === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties ?? {})) if (s.required?.includes(k) || edge || r() < 0.5) out[k] = valid(r, v, edge);
    return out;
  }
  // Strings.
  if (s.format === "email") return `fuzz${++emails}@example.com`;
  if (s.format === "uuid") return randomUUID();
  if (s.format === "date-time") return new Date(Date.now() - (edge ? pick(r, [48 * 3600_000 - 2000, -4 * 60_000]) : int(r, 0, 47 * 3600_000))).toISOString();
  if (s.pattern === "^[A-Za-z0-9_-]{16,64}$") return keyOf(r, edge ? pick(r, [16, 64]) : undefined);
  if (s.pattern === "^\\d+$") return String(int(r, 1, 40));
  // Lengths in JSON Schema count code points; generate at the bound in code points.
  const lo = s.minLength ?? 0;
  const hi = s.maxLength ?? 80;
  return edge ? text(r, hi, hi) : text(r, lo, hi);
}

// Strings that break things: NUL and other C0 controls, a lone surrogate, a huge string, prototype keys.
const NASTY = ["\u0000", "a\u0000b", "\u0001\u001f", "\ud800", "x\udfffy", "￿", "  ", "%00", "' or 1=1 --", "<script>", "$where", "{}", "x".repeat(70_000)];
/** A malformed version of a valid body: a missing or retyped field, a value past its bound, nasty text, or no object at all. */
function malformed(r: Rng, s: Js): { json?: unknown; raw?: string } {
  const base = valid(r, s) as Record<string, unknown>;
  const props = Object.entries(s.properties ?? {});
  switch (int(r, 0, 9)) {
    case 0:
      return { raw: pick(r, ["", "{", "null", "[]", "1", '"x"', "{\"a\":", "\u0000", "{}".repeat(5000)]) };
    case 1: {
      const [k] = pick(r, props.length ? props : [["x", {}]]);
      delete base[k as string];
      return { json: base };
    }
    case 2: {
      const [k] = pick(r, props.length ? props : [["x", {}]]);
      return { json: { ...base, [k as string]: pick(r, [null, 0, -1, 1e308, true, [], {}, "", [[[[["deep"]]]]], { $gt: "" }]) } };
    }
    case 3: {
      const [k, v] = pick(r, props.length ? props : [["x", {} as Js]]);
      const over = typeof v.maxLength === "number" ? "y".repeat(v.maxLength + 1) : typeof v.maximum === "number" ? v.maximum + 1 : typeof v.minimum === "number" ? v.minimum - 1 : "z";
      return { json: { ...base, [k as string]: over } };
    }
    case 4:
    case 5: {
      // Nasty text in each string field the schema has (or a new field).
      const out: Record<string, unknown> = { ...base };
      for (const [k, v] of props) if (v.type === "string" || (Array.isArray(v.type) && v.type.includes("string")) || v.anyOf) out[k] = `${typeof out[k] === "string" ? out[k] : ""}${pick(r, NASTY)}`;
      return { json: out };
    }
    case 6:
      return { json: { ...base, __proto__: { admin: true }, constructor: { prototype: { x: 1 } }, [pick(r, NASTY)]: 1 } };
    case 7:
      return { json: pick(r, [[base], "string", 42, null]) };
    case 8: {
      let deep: unknown = base;
      for (let i = 0; i < 2000; i++) deep = { a: deep };
      return { json: deep };
    }
    default:
      return { json: { ...base, extra: pick(r, NASTY), userId: randomUUID(), id: randomUUID() } };
  }
}

// ── Calling a route, and checking its answer ─────────────────────────────────

const ERROR_KEYS = new Set(["error", "message", "refusal", "version", "switch", "issues", "minVersion", "updateUrl"]);
type Seen = { route: string; status: number; label: string; problem: string };
const problems: Seen[] = [];
let ipN = 0;

type Sent = { token?: string; json?: unknown; raw?: string; form?: FormData; params?: Record<string, string>; headers?: Record<string, string>; query?: string };
async function send(route: Route, o: Sent) {
  const headers = new Headers({ "x-forwarded-for": `10.9.${Math.floor(++ipN / 250) % 250}.${ipN % 250}`, ...o.headers });
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.raw !== undefined || o.json !== undefined) {
    body = o.raw ?? JSON.stringify(o.json);
    headers.set("content-type", "application/json");
  }
  g.__headers = headers;
  const url = route.path.replace(/\{(\w+)\}/g, (_m, k: string) => encodeURIComponent(o.params?.[k] ?? "x"));
  const res = await handlers.get(`${route.method} ${route.path}`)!(new Request(`${SITE}${url}${o.query ?? ""}`, { method: route.method.toUpperCase(), headers, body }), o.params ? { params: Promise.resolve(o.params) } : undefined);
  const textBody = await res.text();
  return { res, text: textBody };
}

const LONE = /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f][0-9a-f]{2})|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i;

/** Every rule an answer must keep. Records each breach with what was sent; never throws. */
function check(route: Route, label: string, res: Response, body: string, o: { validRequest?: boolean; allow400?: string[] } = {}) {
  const name = `${route.method.toUpperCase()} ${route.path}`;
  const note = (problem: string) => problems.push({ route: name, status: res.status, label, problem });
  if (!(res.status in route.responses)) note(`status ${res.status} isn't in the contract (${Object.keys(route.responses).join(",")})`);
  if (res.status >= 500) note(`a ${res.status}: ${body.slice(0, 160)}`);
  const want = route.web ? null : route.publicFor ? `public, max-age=${route.publicFor}` : "private, no-store";
  if (res.headers.get("cache-control") !== want && !(route.web && res.status >= 500)) note(`cache-control ${res.headers.get("cache-control")}, not ${want}`);
  if (res.headers.get("set-cookie")) note("sets a cookie");
  for (const k of res.headers.keys()) if (k.startsWith("access-control-")) note(`sends ${k}`);
  if (LONE.test(body)) note(`a lone surrogate in the JSON: ${body.match(LONE)?.[0]}`);
  const schema = route.responses[res.status];
  if (schema === null) {
    if (body !== "") note("a 304 with a body");
  } else if (schema) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      note(`not JSON: ${body.slice(0, 80)}`);
      return;
    }
    const ok = schema.safeParse(parsed);
    if (!ok.success) note(`doesn't parse: ${ok.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    if (res.status >= 400 && parsed && typeof parsed === "object") {
      const extra = Object.keys(parsed).filter((k) => !ERROR_KEYS.has(k));
      if (extra.length) note(`refusal keys the contract doesn't name: ${extra.join(",")}`);
      if (o.validRequest && res.status === 400 && !(o.allow400 ?? []).includes((parsed as { error: string }).error))
        note(`a valid request refused: ${(parsed as { error: string; message?: string }).error} ${(parsed as { message?: string }).message ?? ""}`);
    }
  }
}

// ── People, rotated so per-person limits don't hide the paths behind them ────

type P = Awaited<ReturnType<typeof person>>;
const fuzzed: P[] = [];
const wrote = new Set<P>();
async function fresh(extra: Record<string, unknown> = {}) {
  const p = await person(`fz-${randomUUID()}@example.com`, { healthCheckedAt: new Date(), ...extra });
  fuzzed.push(p);
  return p;
}
const reqSchema = (route: Route): Js | null => {
  const rb = doc.paths[route.path]?.[route.method]?.requestBody;
  return rb ? Object.values(rb.content)[0].schema : null;
};

// Files the routes read: the smallest real JPEG, PNG and PDF, and bytes that are none.
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AP//Z", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const fileOf = (r: Rng, kind: "jpeg" | "pdf" | "junk", name = "report.pdf") => new File([kind === "jpeg" ? JPEG : kind === "pdf" ? PDF : Buffer.from(keyOf(r))], name);

/** A form from a generated object: strings as fields; the route's file field as a file. */
function formOf(r: Rng, value: Record<string, unknown>, fileField: "photo" | "files", fileName?: string) {
  const f = new FormData();
  for (const [k, v] of Object.entries(value)) {
    if (k === fileField) continue;
    if (v !== undefined) f.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  if (fileField === "files" || value.photo !== undefined) f.append(fileField, fileOf(r, fileField === "files" ? pick(r, ["pdf", "jpeg"]) : "jpeg", fileName));
  return f;
}

// Codes a request the contract calls valid may still get, for reasons the contract states in words.
const SEMANTIC_400: Record<string, string[]> = {
  "/api/auth/token": ["invalid", "wrong_code", "no_code", "expired", "too_many_tries"],
  "/api/food": ["empty", "bad_time"],
  "/api/food/{id}/again": ["bad_time"],
};

describe("contract fuzzing: every app route, from the contract's own request schemas", () => {
  it(`valid, boundary and malformed requests (seed ${SEED}, ${RUNS} a mode): documented answers only, never a 500`, { timeout: 600_000 }, async () => {
    const r = mulberry32(SEED);
    const options = optionsJson();
    for (const route of APP_ROUTES) {
      const s = reqSchema(route);
      const name = `${route.method} ${route.path}`;
      // Sign-out and delete end the session they're sent with: one person each.
      const oneShot = route.path === "/api/auth/signout" || route.path === "/api/account/delete";
      let p = await fresh();
      for (const mode of ["valid", "edge", "malformed"] as const) {
        for (let i = 0; i < RUNS; i++) {
          if (oneShot || i % 4 === 0) p = await fresh();
          const label = `${name} ${mode} #${i} (seed ${SEED})`;
          const params: Record<string, string> = {};
          if (route.path.includes("{id}")) {
            const own = route.path.startsWith("/api/food") ? await meal(p, { daysAgo: int(r, 0, 2) }) : randomUUID();
            params.id = mode === "malformed" ? pick(r, ["\u0000", "x".repeat(5000), "../../etc", "%", "😀", "' or '1'='1", own]) : own;
          }
          if (route.path.includes("{publicId}")) params.publicId = mode === "malformed" ? pick(r, ["\u0000", "", "x".repeat(3000)]) : randomUUID();
          const sent: Sent = { token: route.auth === "bearer" ? p.token : undefined, params: Object.keys(params).length ? params : undefined };
          if (route.path === "/api/reports" && route.method === "post") sent.headers = { prefer: "respond-async" };
          if (route.path === "/api/wraps" && route.method === "get") sent.query = mode === "malformed" ? pick(r, ["?week=\u0000", "?week=9999-99-99", "?period=%00", `?week=${"1".repeat(4000)}`]) : pick(r, ["", "?period=week", `?week=${new Date().toISOString().slice(0, 10)}`]);
          if (mode === "malformed" && r() < 0.15) sent.headers = { ...sent.headers, "x-dhuman-client": pick(r, ["ios/", "ios/x", "ios/1e309", `ios/${"9".repeat(400)}.0`, "android/0.1", "ios/1..2"]) };
          if (s) {
            let value: unknown;
            if (mode === "malformed") {
              const m = malformed(r, s);
              value = m.json;
              if (m.raw !== undefined && !route.form) sent.raw = m.raw;
            } else {
              value = valid(r, s, mode === "edge");
              // The profile's ids come from GET /api/app/options, as the contract says.
              if (route.path === "/api/profile") value = { ...(value as object), ...profileFrom(r, options) };
            }
            if (route.form) {
              const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { junk: String(value) };
              sent.form = formOf(r, v, route.path === "/api/reports" ? "files" : "photo", mode === "malformed" ? pick(r, ["a\u0000b.pdf", "\ud800.pdf", "x".repeat(400), "r.pdf"]) : undefined);
            } else if (sent.raw === undefined) sent.json = value;
          }
          if (route.path === "/api/auth/token" && mode !== "malformed") sent.json = { ...(sent.json as object), email: p.email };
          let out;
          try {
            out = await send(route, sent);
          } catch (error) {
            problems.push({ route: name, status: 0, label, problem: `threw: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}` });
            continue;
          }
          check(route, label, out.res, out.text, { validRequest: mode !== "malformed", allow400: SEMANTIC_400[route.path] });
          if (route.method !== "get" && out.res.status < 300 && !oneShot) wrote.add(p);
        }
      }
    }
    // Then every screen again, for people the fuzz wrote to: stored oddities must not break a read.
    const reads = APP_ROUTES.filter((x) => x.method === "get");
    for (const p of [...wrote].filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 40)) === 0)) {
      for (const route of reads) {
        const out = await send(route, { token: p.token, params: route.path.includes("{") ? { id: randomUUID() } : undefined }).catch((error: Error) => ({ error }));
        if ("error" in out) problems.push({ route: `GET ${route.path}`, status: 0, label: `re-read for ${p.email}`, problem: `threw: ${out.error.message.slice(0, 160)}` });
        else check(route, `re-read for ${p.email}`, out.res, out.text);
      }
    }
    const byKind = new Map<string, Seen[]>();
    for (const x of problems) {
      const k = `${x.route} → ${x.status}: ${x.problem.replace(/[0-9a-f-]{36}/g, "<id>").slice(0, 120)}`;
      byKind.set(k, [...(byKind.get(k) ?? []), x]);
    }
    assert.equal(byKind.size, 0, [...byKind].map(([k, xs]) => `${k}  (×${xs.length}; e.g. ${xs[0].label})`).join("\n"));
  });
});

/** Profile answers with real ids, as onboarding and Settings send them. */
function profileFrom(r: Rng, o: ReturnType<typeof optionsJson>) {
  const some = <T,>(xs: readonly T[], max: number) => xs.filter(() => r() < 0.3).slice(0, max);
  const out: Record<string, unknown> = {
    name: text(r, 1, 60),
    birthYear: int(r, o.birthYears.min, o.birthYears.max),
    sex: pick(r, o.sexes).id,
    heightCm: int(r, 100, 250),
    weightKg: int(r, 25, 300),
    city: text(r, 1, 80),
    language: pick(r, o.languages).id,
    activities: some(o.activities.map((a) => a.id), 10),
    goals: some(o.goals.map((a) => a.id), 3),
    diet: pick(r, o.diets).id,
    medications: pick(r, [null, text(r, 1, 400)]),
    conditions: some(o.conditions.map((c) => c.id), 10),
    supplementBudget: pick(r, [null, ...o.budgets.map((b) => b.id)]),
  };
  return out;
}
