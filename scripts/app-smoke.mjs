// A read-only smoke test of the apps' API on a live deployment, for the orchestrator to run after
// each deploy (backend test engineer). It never signs anyone up or in, never logs a meal, uploads,
// sends an email or sets off an AI call: every request is either public (config, options) or is
// refused before anything is written (no token, a malformed one, a random well-formed one, a
// page's Origin, an old app version, a browser at the token route). What it checks:
//   - public reads: 200 with their schema, public max-age, an ETag, and 304 for it;
//   - every signed-in route: 401 signed_out for no or a dead token, 426 for an old app, all
//     `private, no-store`, never a cookie, never an Access-Control-Allow-* header (CORS stays shut);
//   - the token route refuses a browser; a preflight approves nothing;
//   - functions answer from Mumbai (x-vercel-id names bom1).
//
//   node scripts/app-smoke.mjs [--base https://www.d-human.fit] [--big]
// --big also sends one 5 MB body with a dead token, to see what the edge answers past 4.5 MB.
// Exits 1 on any failure and prints each check.
import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { parseArgs } from "node:util";
import { APP_ROUTES } from "../lib/api/openapi.ts";
import { ConfigResponse, ErrorResponse, OptionsResponse } from "../lib/api/schemas.ts";

const { values: args } = parseArgs({ options: { base: { type: "string" }, big: { type: "boolean" } } });
const BASE = (args.base ?? "https://www.d-human.fit").replace(/\/$/, "");
const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
const deadToken = () => `dht_${randomBytes(32).toString("base64url")}`;
const UA = { "user-agent": "d-human-app-smoke/1 (read-only)" };

// node:https, not fetch: Node's fetch adds Sec-Fetch-Mode, which makes every request look like a
// browser's, and the routes refuse a token from one before any lookup (lib/auth/app-token.ts).
// The apps send no such header, so neither does this.
function hit(method, path, headers = {}, body) {
  const started = performance.now();
  const url = new URL(`${BASE}${path}`);
  const send = url.protocol === "http:" ? http.request : https.request;
  return new Promise((resolve, reject) => {
    const req = send(url, { method, headers: { ...UA, ...headers, ...(body ? { "content-length": Buffer.byteLength(body) } : {}) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {}
        resolve({ status: res.statusCode, headers: new Headers(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)])), text, json, ms: Math.round(performance.now() - started) });
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout: ${method} ${path}`)));
    if (body) req.write(body);
    req.end();
  });
}
const PRIVATE = "private, no-store";
const noCors = (r) => ![...r.headers.keys()].some((k) => k.startsWith("access-control-allow"));
const region = (r) => r.headers.get("x-vercel-id") ?? "";
const fill = (path) => path.replace(/\{(\w+)\}/g, "00000000-0000-4000-8000-000000000000");

// ── Public reads ─────────────────────────────────────────────────────────────
for (const [path, schema, maxAge] of [
  ["/api/app/config", ConfigResponse, 300],
  ["/api/app/options", OptionsResponse, 3600],
]) {
  const r = await hit("GET", path);
  ok(`GET ${path}: 200`, r.status === 200, `${r.status}`);
  ok(`GET ${path}: matches the contract`, r.json && schema.safeParse(r.json).success, r.json ? schema.safeParse(r.json).error?.issues?.[0]?.message ?? "" : r.text.slice(0, 80));
  ok(`GET ${path}: public, max-age=${maxAge}`, r.headers.get("cache-control") === `public, max-age=${maxAge}`, r.headers.get("cache-control"));
  const etag = r.headers.get("etag");
  ok(`GET ${path}: an ETag`, !!etag, etag ?? "none");
  if (etag) {
    const again = await hit("GET", path, { "if-none-match": etag });
    ok(`GET ${path}: 304 for its ETag, no body`, again.status === 304 && again.text === "", `${again.status}`);
  }
  ok(`GET ${path}: no cookie, no CORS`, !r.headers.get("set-cookie") && noCors(r));
  ok(`GET ${path}: served from bom1`, region(r).includes("bom1"), region(r));
  if (path === "/api/app/config" && r.json) ok("config: apiBase is the canonical host", r.json.apiBase === "https://www.d-human.fit", r.json.apiBase);
}

// ── Every signed-in route: refused, privately, before anything runs ─────────
const signedIn = APP_ROUTES.filter((r) => r.auth === "bearer");
for (const route of signedIn) {
  const m = route.method.toUpperCase();
  const path = fill(route.path);
  const label = `${m} ${route.path}`;
  // A random, well-formed token: one session lookup that finds nothing. Writes nothing.
  const dead = await hit(m, path, { authorization: `Bearer ${deadToken()}`, ...(m === "POST" ? { "content-type": "application/json" } : {}) }, m === "POST" ? "{}" : undefined);
  ok(`${label}: a dead token is 401 signed_out`, dead.status === 401 && dead.json?.error === "signed_out" && ErrorResponse.safeParse(dead.json).success, `${dead.status} ${dead.text.slice(0, 60)}`);
  ok(`${label}: private, no-store`, dead.headers.get("cache-control") === PRIVATE, dead.headers.get("cache-control"));
  ok(`${label}: no cookie, no CORS`, !dead.headers.get("set-cookie") && noCors(dead));
  // Malformed, and with a page's Origin: refused by the header check alone, no lookup.
  const bad = await hit(m, path, { authorization: "Bearer dht_short" });
  ok(`${label}: a malformed token is 401`, bad.status === 401, `${bad.status}`);
  const page = await hit(m, path, { authorization: `Bearer ${deadToken()}`, origin: "https://www.d-human.fit" });
  ok(`${label}: a token with a page's Origin is 401`, page.status === 401, `${page.status}`);
}

// An app below the oldest version served: 426 before any lookup, on a route that checks it.
for (const path of ["/api/me", "/api/home", "/api/fuel"]) {
  const r = await hit("GET", path, { authorization: `Bearer ${deadToken()}`, "x-dhuman-client": "ios/0.0.1 (1)" });
  ok(`GET ${path}: 426 update_required for ios/0.0.1`, r.status === 426 && r.json?.error === "update_required" && typeof r.json?.minVersion === "string", `${r.status} ${r.text.slice(0, 80)}`);
  ok(`GET ${path}: the 426 is private`, r.headers.get("cache-control") === PRIVATE, r.headers.get("cache-control"));
}
// The functions themselves answer from Mumbai.
const me = await hit("GET", "/api/me", { authorization: `Bearer ${deadToken()}` });
ok("GET /api/me: the function runs in bom1", /bom1::.*bom1/.test(region(me)) || region(me).split("::").filter((x) => x === "bom1").length >= 2, region(me));

// ── Sign-in and CORS ─────────────────────────────────────────────────────────
const browser = await hit("POST", "/api/auth/token", { "content-type": "application/json", origin: "https://www.d-human.fit" }, JSON.stringify({ email: "smoke@example.com", code: "000000" }));
ok("POST /api/auth/token: a browser is refused (not_for_browsers)", browser.status === 400 && browser.json?.error === "not_for_browsers", `${browser.status} ${browser.text.slice(0, 60)}`);
ok("POST /api/auth/token: its refusal is private and sets no cookie", browser.headers.get("cache-control") === PRIVATE && !browser.headers.get("set-cookie"));
const malformed = await hit("POST", "/api/auth/token", { "content-type": "application/json" }, "{");
ok("POST /api/auth/token: malformed JSON is 400 invalid", malformed.status === 400 && malformed.json?.error === "invalid", `${malformed.status}`);
for (const path of ["/api/me", "/api/food", "/api/auth/token"]) {
  const pre = await hit("OPTIONS", path, { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization" });
  ok(`OPTIONS ${path}: a preflight approves nothing`, noCors(pre), [...pre.headers.keys()].filter((k) => k.startsWith("access-control")).join(","));
}
// A NUL in the path: Vercel's edge refuses it (400, no function), so lib/api/clean.ts's guard is a
// second line only. A 5xx here, or a function answering it, is the thing to look into.
const nul = await hit("GET", "/api/reports/%00", { authorization: `Bearer ${deadToken()}` });
ok("GET /api/reports/%00: refused (the edge's 400, or our 401), never a 5xx", nul.status === 400 || nul.status === 401, `${nul.status} ${region(nul)}`);

if (args.big) {
  const big = await hit("POST", "/api/food", { authorization: `Bearer ${deadToken()}`, "content-type": "application/octet-stream" }, Buffer.alloc(5 * 1024 * 1024));
  ok("POST /api/food, 5 MB: refused (the edge's 413, or our 401)", big.status === 413 || big.status === 401, `${big.status} ${big.headers.get("content-type")} ${big.text.slice(0, 60)}`);
}

// ── Report ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "ok  " : "FAIL"} ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length} of ${results.length} passed against ${BASE}`);
process.exit(failed.length ? 1 : 0);
