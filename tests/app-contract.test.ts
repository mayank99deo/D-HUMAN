// The apps' contract (docs/api/openapi.json, from lib/api/openapi.ts) and the routes agree.
// This fails when the committed file is stale, when a listed route is missing, when a route on
// the apps' path isn't listed, when a route answers with a status the contract doesn't list or
// a body that doesn't parse against it, and when the contract lists a status no route gives.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
type G = { __headers?: Headers; __cookie?: string; __after: (() => unknown)[]; __aiMode?: string; __meal?: "food" | "not_food" | "refuse" | "fail" };
const g = globalThis as unknown as G;
g.__after = [];

allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/email/send": "export const sendFounderAlert = async () => ({ status: 'sent' });",
  // The code route's email: sent, except to down@ (Resend failing).
  "@/lib/auth/email": "export const sendSignInCode = async (email) => !email.startsWith('down@');",
  // Claude, as each meal answer needs: off by default, as on a server with no key.
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => globalThis.__aiMode ?? "off";`,
  "@/lib/ai/food": `
    import { AiRefusalError } from "@/lib/ai/client";
    export const estimateMeal = async (input) => {
      const how = globalThis.__meal ?? "food";
      if (how === "refuse") throw new AiRefusalError("declined");
      if (how === "fail") throw new Error("AI hiccup");
      const item = { name: "Dal", portion: "1 bowl", grams: null, kcal: 180, protein_g: 9, carbs_g: 24, fat_g: 5, fibre_g: 6 };
      return { data: { is_food: how === "food", reply_language: input.words.reply.id, title: "Dal", meal_guess: null, items: [item], confidence: "high", tip: null }, model: "test" };
    };
    export const estimateUsualDay = async () => { throw new Error("not in this test"); };`,
});
const removeDatabase = tempDatabase();

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { issueCode } = await import("../lib/auth/codes.ts");
const { sha256 } = await import("../lib/auth/crypto.ts");
const { APP_ROUTES, openapi } = await import("../lib/api/openapi.ts");

after(async () => {
  await removeDatabase();
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.d-human.fit";
const routeOf = (method: string, p: string) => APP_ROUTES.find((r) => r.method === method && r.path === p)!;
const handlers = new Map<string, Handler>();
for (const r of APP_ROUTES) handlers.set(`${r.method} ${r.path}`, (await import(`../${r.file}`))[r.method.toUpperCase()] as Handler);

// Every (route, status) seen, checked against the contract as it happens.
const seen = new Set<string>();
let ip = 0;
async function call(
  method: "get" | "post" | "delete",
  p: string,
  o: { token?: string; cookie?: string; body?: unknown; form?: Record<string, string | Blob>; bad?: true; etag?: string; ip?: string; params?: Record<string, string> } = {},
) {
  const route = routeOf(method, p);
  const headers = new Headers({ "x-forwarded-for": o.ip ?? `10.1.${Math.floor(++ip / 250)}.${ip % 250}` });
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  if (o.etag) headers.set("if-none-match", o.etag);
  if (o.body !== undefined) headers.set("content-type", "application/json");
  // What the test sends is what the contract allows, unless it's a deliberately bad request.
  if (o.body !== undefined && route.request && !o.bad) route.request.parse(o.body);
  let body: string | FormData | undefined = o.body === undefined ? undefined : JSON.stringify(o.body);
  if (o.form) {
    assert.ok(route.form, `${p} takes JSON, not a form`);
    if (!o.bad) route.request!.parse(Object.fromEntries(Object.entries(o.form).map(([k, v]) => [k, typeof v === "string" ? v : "(file)"])));
    body = new FormData();
    for (const [k, v] of Object.entries(o.form)) body.append(k, v);
  }
  g.__headers = headers;
  g.__cookie = o.cookie;
  const url = p.replace(/\{(\w+)\}/g, (_m, k: string) => o.params?.[k] ?? "x");
  const res = await handlers.get(`${method} ${p}`)!(new Request(`${SITE}${url}`, { method: method.toUpperCase(), headers, body }), o.params ? { params: Promise.resolve(o.params) } : undefined);
  const text = await res.text();
  const label = `${method.toUpperCase()} ${p} → ${res.status}`;
  assert.ok(res.status in route.responses, `${label}: a status the contract doesn't list`);
  const schema = route.responses[res.status];
  if (schema) schema.parse(JSON.parse(text));
  else assert.equal(text, "", `${label}: no body`);
  // The apps' routes are private, no-store; the web's own route keeps the web's headers, unchanged.
  assert.equal(res.headers.get("cache-control"), route.web ? null : "private, no-store", label);
  seen.add(`${method} ${p} ${res.status}`);
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null, etag: res.headers.get("etag") ?? "" };
}

async function signIn(email: string, extra: Record<string, unknown> = {}) {
  const issued = await issueCode(email);
  assert.ok(issued.ok);
  const r = await call("post", "/api/auth/token", { body: { email, code: issued.code, device: { label: "iPhone18,1" }, ...extra } });
  assert.equal(r.status, 200);
  return r.body!.token as string;
}

describe("the apps' contract", () => {
  it("docs/api/openapi.json is what the schemas make (run node scripts/api-schema.mts)", () => {
    const committed = readFileSync(path.join(ROOT, "docs/api/openapi.json"), "utf8");
    assert.equal(committed, `${JSON.stringify(openapi(), null, 2)}\n`);
  });

  it("every listed route exists, and every route on the apps' path is listed", () => {
    for (const r of APP_ROUTES) assert.match(readFileSync(path.join(ROOT, r.file), "utf8"), new RegExp(`export async function ${r.method.toUpperCase()}\\(`), r.file);
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
    const appPath = walk(path.join(ROOT, "app/api"))
      .filter((f) => f.endsWith("route.ts") && /\b(authenticate|appActor|apiMember|apiSignedIn|startAppSession)\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    const listed = new Set(APP_ROUTES.map((r) => r.file));
    assert.deepEqual(appPath.filter((f) => !listed.has(f)), [], "routes that take app tokens but aren't in lib/api/openapi.ts");
  });

  it("each route's answers, for every status it gives, are what the contract says", async () => {
    // The code: 200 (and the suppressed notice), 400, 429, 503.
    await call("post", "/api/auth/code", { body: { email: "code@example.com" } });
    const { suppress } = await import("../lib/email/suppress.ts");
    await suppress("bounced@example.com", "bounce");
    const suppressed = await call("post", "/api/auth/code", { body: { email: "bounced@example.com" } });
    assert.equal(suppressed.body?.notice, "suppressed");
    await call("post", "/api/auth/code", { body: { email: "not an email" }, bad: true });
    await call("post", "/api/auth/code", { body: { email: "down@example.com" } });
    for (let i = 0; i < 9; i++) await call("post", "/api/auth/code", { ip: "203.0.113.10", body: { email: `ip${i}@example.com` } });

    // Sign-in: 200, 400 and 429.
    const t = await signIn("contract@example.com", { key: "contract-key-0123456789" });
    await call("post", "/api/auth/token", { body: { email: "contract@example.com", code: "000000" } });
    for (let i = 0; i < 21; i++) await call("post", "/api/auth/token", { ip: "203.0.113.9", body: { email: "x@example.com", code: "123456" } });

    // Me and Home: 200, 304, 401; Home's 409 before onboarding.
    const meFirst = await call("get", "/api/me", { token: t });
    await call("get", "/api/me", { token: t, etag: meFirst.etag });
    await call("get", "/api/me");
    const screens = ["/api/home", "/api/fuel", "/api/fuel/past", "/api/fuel/facts", "/api/plan", "/api/upload", "/api/reports", "/api/reports/{id}/read", "/api/stack"];
    const reportId = randomUUID();
    for (const p of screens) await call("get", p, { token: t, params: { id: reportId } });
    const d = await db();
    const user = (await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "contract@example.com")))[0].id;
    await d.update(schema.profiles).set({ name: "Asha", birthYear: 1990, primaryActivity: "running", activities: ["running"], consentAt: new Date(), onboardedAt: new Date() }).where(eq(schema.profiles.userId, user));
    for (const day of [0, -1]) {
      await d.insert(schema.foodLogs).values({
        id: randomUUID(), userId: user, localDate: new Date(Date.now() + day * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10), meal: "lunch", source: "text", title: "Dal, two rotis",
        items: [{ name: "Dal", portion: "1 bowl" }], kcal: 420, proteinG: 18, carbsG: 60, fatG: 10, fibreG: 8, micros: { iron_mg: 3, tip: "Add curd.", lang: "en" },
      });
    }
    // A read report, with one flagged marker.
    await d.insert(schema.reports).values({ id: reportId, userId: user, status: "ready", fileName: "r.pdf", collectedOn: "2026-11-02", model: "mock" });
    const markerId = randomUUID();
    await d.insert(schema.markers).values({ id: markerId, reportId, userId: user, key: "vitamin_d", name: "Vitamin D", value: 8, unit: "ng/mL", refLow: 30, refHigh: 100, rangeSource: "catalog", status: "low", flag: "doctor" });
    await d.insert(schema.analyses).values({
      reportId,
      userId: user,
      read: {
        headline: "One to fix", verdict: { level: "doctor_first", line: "Show a doctor first.", detail: "Vitamin D is very low." }, summary: "One low result.",
        focus: [{ marker_key: "vitamin_d", title: "Vitamin D", why: "It's low.", action: "Show a doctor." }], markers: [{ id: markerId, note: "Very low." }],
        wins: [], doctor_questions: ["Should I take vitamin D?"], retest: { weeks: 12, markers: ["vitamin_d"], why: "To see it move." }, test_tips: [],
      },
    });
    for (const p of screens) {
      const first = await call("get", p, { token: t, params: { id: reportId } });
      await call("get", p, { token: t, etag: first.etag, params: { id: reportId } });
      await call("get", p, { params: { id: reportId } });
    }
    await call("get", "/api/reports/{id}/read", { token: t, params: { id: "not-a-report" } }); // 404
    // A web cookie on the apps' reads: 403, still signed in.
    const webCookie = randomUUID();
    await d.insert(schema.sessions).values({ id: sha256(webCookie), userId: user, expiresAt: new Date(Date.now() + 86_400_000) });
    await call("get", "/api/me", { cookie: webCookie });
    for (const p of screens) await call("get", p, { cookie: webCookie, params: { id: reportId } });

    // Devices: 200, 304, 401, 403 (a web cookie), 404, and ending one.
    const second = await signIn("contract@example.com");
    const list = await call("get", "/api/me/sessions", { token: t });
    await call("get", "/api/me/sessions", { token: t, etag: list.etag });
    await call("get", "/api/me/sessions");
    const cookie = randomUUID();
    await d.insert(schema.sessions).values({ id: sha256(cookie), userId: user, expiresAt: new Date(Date.now() + 86_400_000) });
    await call("get", "/api/me/sessions", { cookie });
    const other = (list.body!.sessions as { publicId: string; current: boolean }[]).find((x) => !x.current)!;
    await call("delete", "/api/me/sessions/{publicId}", { token: t, params: { publicId: other.publicId } });
    await call("delete", "/api/me/sessions/{publicId}", { token: t, params: { publicId: other.publicId } });
    await call("delete", "/api/me/sessions/{publicId}", { params: { publicId: other.publicId } });
    await call("delete", "/api/me/sessions/{publicId}", { cookie, params: { publicId: other.publicId } });
    void second;

    // Sign-out: both answers and 401; account deletion: 400, 200, 401.
    const third = await signIn("contract@example.com");
    const fourth = await signIn("contract@example.com");
    await call("post", "/api/auth/signout", { token: third, body: { others: true } });
    await call("post", "/api/auth/signout", { token: fourth });
    await call("post", "/api/account/delete", { token: third, body: {}, bad: true });
    await call("post", "/api/account/delete", { token: third, body: { confirm: "DELETE" } });
    await call("post", "/api/account/delete", { token: third, body: { confirm: "DELETE" } });
  });

  it("meal writes: every status POST /api/food and DELETE /api/food/{id} give", async () => {
    const d = await db();
    const onboard = async (email: string, consentAt = new Date()) => {
      const t = await signIn(email);
      const [u] = await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
      await d.update(schema.profiles).set({ name: "Ravi", birthYear: 1992, primaryActivity: "gym", activities: ["gym"], consentAt, onboardedAt: new Date() }).where(eq(schema.profiles.userId, u.id));
      return { t, id: u.id };
    };
    let k = 0;
    const key = () => `contract-meal-${String(++k).padStart(8, "0")}`;
    const meal = (t: string, extra: Record<string, string | Blob> = {}, bad?: true) => call("post", "/api/food", { token: t, form: { text: "dal", source: "text", key: key(), ...extra }, bad });

    const notYet = await signIn("meal-not-onboarded@example.com");
    await meal(notYet); // 409 not_onboarded
    await call("post", "/api/food", { token: "dht_not-a-real-token", form: { text: "dal", source: "text" } }); // 401
    const { t, id } = await onboard("meal-contract@example.com");
    g.__aiMode = "off";
    await meal(t); // 503 ai_off
    g.__aiMode = "live";
    const logged = await meal(t); // 200
    await meal(t, { source: "sms" }, true); // 400 invalid
    await meal(t, { eatenAt: new Date(Date.now() - 72 * 3_600_000).toISOString() }); // 400 bad_time
    await meal(t, { photo: new Blob([new Uint8Array(3 * 1024 * 1024 + 1)], { type: "image/jpeg" }) }); // 413
    await meal(t, { photo: new Blob(["not a photo"], { type: "image/jpeg" }) }); // 415
    g.__meal = "not_food";
    await meal(t); // 422 not_food
    g.__meal = "refuse";
    await meal(t); // 422 refused
    g.__meal = "fail";
    await meal(t); // 500
    g.__meal = "food";
    for (let i = 0; i < 4; i++) await meal(t);
    const limit = await meal(t); // 402: 5 a day
    assert.equal(limit.body!.refusal, "meals_today_used");
    const old = await onboard("meal-old-consent@example.com", new Date("2026-11-01T00:00:00Z"));
    const consent = await meal(old.t); // 409 consent_needed
    assert.equal(consent.body!.error, "consent_needed");
    const { allowRequest } = await import("../lib/waitlist/rate-limit.ts");
    for (let i = 0; i < 40; i++) allowRequest(`food:${id}`, 40, 60 * 60_000);
    await meal(t); // 429

    const mealId = (logged.body!.meal as { id: string }).id;

    // Log again: 200, 400, 401, 402, 403, 404, 409, 429.
    const r = await onboard("again-contract@example.com");
    const first = (await meal(r.t)).body!.meal as { id: string };
    const again = (o: { token?: string; cookie?: string; body?: unknown; bad?: true }, id = first.id) => call("post", "/api/food/{id}/again", { ...o, params: { id } });
    await again({ token: r.t, body: { key: key() } });
    await again({ token: r.t, body: { key: "bad" }, bad: true });
    await again({ token: "dht_not-a-real-token", body: { key: key() } });
    await again({ token: r.t, body: { key: key() } }, "not-a-meal");
    await again({ cookie: "web-cookie", body: { key: key() } });
    await again({ token: old.t, body: { key: key() } });
    for (let i = 0; i < 3; i++) await again({ token: r.t, body: { key: key() } });
    await again({ token: r.t, body: { key: key() } }); // 402
    for (let i = 0; i < 40; i++) allowRequest(`food:${r.id}`, 40, 60 * 60_000);
    await again({ token: r.t, body: { key: key() } }); // 429

    // A slot change: 200, 400, 401, 403, 404, 409.
    const move = (o: { token?: string; cookie?: string; body?: unknown; bad?: true }, id = first.id) => call("post", "/api/food/{id}/slot", { ...o, params: { id } });
    await move({ token: r.t, body: { meal: "dinner" } });
    await move({ token: r.t, body: { meal: "brunch" }, bad: true });
    await move({ token: "dht_not-a-real-token", body: { meal: "dinner" } });
    await move({ cookie: "web-cookie", body: { meal: "dinner" } });
    await move({ token: r.t, body: { meal: "dinner" } }, "not-a-meal");
    await move({ token: old.t, body: { meal: "dinner" } });

    await call("delete", "/api/food/{id}", { token: t, params: { id: mealId } });
    await call("delete", "/api/food/{id}", { token: "dht_not-a-real-token", params: { id: mealId } });
  });

  it("profile and stack writes: every status they give", async () => {
    const d = await db();
    const { allowRequest } = await import("../lib/waitlist/rate-limit.ts");
    const bad = "dht_not-a-real-token";
    // The profile: 200, 400, 401, 403 (health answers before consent), 429.
    const early = await signIn("profile-contract@example.com");
    const [u] = await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "profile-contract@example.com"));
    await call("post", "/api/profile", { token: early, body: { conditions: ["thyroid"] } }); // 403
    await call("post", "/api/profile", { token: early, body: { consent: true, name: "Meera", birthYear: 1991, primaryActivity: "running", activities: ["running"], complete: true } });
    await call("post", "/api/profile", { token: early, body: { healthChecked: true } }); // 400
    await call("post", "/api/profile", { token: bad, body: { name: "x" } }); // 401
    // The stack: 409 health_check_needed, then 200, 401, 404 on the poll, 429.
    const reportId = randomUUID();
    await d.insert(schema.reports).values({ id: reportId, userId: u.id, status: "ready", fileName: "r.pdf", model: "mock" });
    await d.insert(schema.markers).values({ id: randomUUID(), reportId, userId: u.id, key: "vitamin_d", name: "Vitamin D", value: 18, unit: "ng/mL", refLow: 30, refHigh: 100, rangeSource: "catalog", status: "low" });
    await call("post", "/api/stack", { token: early, body: {} }); // 409
    await call("post", "/api/profile", { token: early, body: { healthChecked: true, conditions: [], medications: null } });
    const built = await call("post", "/api/stack", { token: early, body: {} });
    for (const job of g.__after.splice(0)) await job();
    await call("get", "/api/stack/{id}", { token: early, params: { id: (built.body as { id: string }).id } });
    await call("get", "/api/stack/{id}", { token: early, params: { id: "not-a-stack" } }); // 404
    await call("get", "/api/stack/{id}", { token: bad, params: { id: "x" } }); // 401
    await call("post", "/api/stack", { token: bad, body: {} }); // 401
    for (let i = 0; i < 5; i++) allowRequest(`stack:${u.id}`, 5, 60 * 60_000);
    await call("post", "/api/stack", { token: early, body: {} }); // 429
    for (let i = 0; i < 30; i++) allowRequest(`profile:${u.id}`, 30, 60 * 60_000);
    await call("post", "/api/profile", { token: early, body: { name: "Meera" } }); // 429
  });

  it("lists no status that no route gave", () => {
    const documented = APP_ROUTES.flatMap((r) => Object.keys(r.responses).map((status) => `${r.method} ${r.path} ${status}`));
    assert.deepEqual(documented.filter((x) => !seen.has(x)), [], "statuses the contract lists that no route gave");
  });
});
