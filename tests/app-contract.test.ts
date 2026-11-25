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
type G = { __headers?: Headers; __cookie?: string; __after: (() => unknown)[] };
const g = globalThis as unknown as G;
g.__after = [];

allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/email/send": "export const sendFounderAlert = async () => ({ status: 'sent' });",
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
async function call(method: "get" | "post" | "delete", p: string, o: { token?: string; cookie?: string; body?: unknown; bad?: true; etag?: string; ip?: string; params?: Record<string, string> } = {}) {
  const route = routeOf(method, p);
  const headers = new Headers({ "x-forwarded-for": o.ip ?? `10.1.${Math.floor(++ip / 250)}.${ip % 250}` });
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  if (o.etag) headers.set("if-none-match", o.etag);
  if (o.body !== undefined) headers.set("content-type", "application/json");
  // What the test sends is what the contract allows, unless it's a deliberately bad request.
  if (o.body !== undefined && route.request && !o.bad) route.request.parse(o.body);
  g.__headers = headers;
  g.__cookie = o.cookie;
  const url = p.replace("{publicId}", o.params?.publicId ?? "x");
  const res = await handlers.get(`${method} ${p}`)!(new Request(`${SITE}${url}`, { method: method.toUpperCase(), headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), o.params ? { params: Promise.resolve(o.params) } : undefined);
  const text = await res.text();
  const label = `${method.toUpperCase()} ${p} → ${res.status}`;
  assert.ok(res.status in route.responses, `${label}: a status the contract doesn't list`);
  const schema = route.responses[res.status];
  if (schema) schema.parse(JSON.parse(text));
  else assert.equal(text, "", `${label}: no body`);
  assert.equal(res.headers.get("cache-control"), "private, no-store", label);
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
      .filter((f) => f.endsWith("route.ts") && /\b(authenticate|apiMember|apiSignedIn|startAppSession)\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    const listed = new Set(APP_ROUTES.map((r) => r.file));
    assert.deepEqual(appPath.filter((f) => !listed.has(f)), [], "routes that take app tokens but aren't in lib/api/openapi.ts");
  });

  it("each route's answers, for every status it gives, are what the contract says", async () => {
    // Sign-in: 200, 400 and 429; Apple: 400 and 501.
    const t = await signIn("contract@example.com", { key: "contract-key-0123456789" });
    await call("post", "/api/auth/token", { body: { email: "contract@example.com", code: "000000" } });
    for (let i = 0; i < 21; i++) await call("post", "/api/auth/token", { ip: "203.0.113.9", body: { email: "x@example.com", code: "123456" } });
    await call("post", "/api/auth/apple", { body: { identityToken: "a", authorizationCode: "b", nonce: "c" } });
    const browser = await handlers.get("post /api/auth/apple")!(new Request(`${SITE}/api/auth/apple`, { method: "POST", headers: { origin: SITE } }));
    assert.equal(browser.status, 400);
    assert.ok(routeOf("post", "/api/auth/apple").responses[400]!.safeParse(await browser.json()).success);
    seen.add("post /api/auth/apple 400");

    // Me and Home: 200, 304, 401; Home's 409 before onboarding.
    const meFirst = await call("get", "/api/me", { token: t });
    await call("get", "/api/me", { token: t, etag: meFirst.etag });
    await call("get", "/api/me");
    await call("get", "/api/home", { token: t });
    const d = await db();
    const user = (await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "contract@example.com")))[0].id;
    await d.update(schema.profiles).set({ name: "Asha", birthYear: 1990, primaryActivity: "running", activities: ["running"], consentAt: new Date(), onboardedAt: new Date() }).where(eq(schema.profiles.userId, user));
    const homeFirst = await call("get", "/api/home", { token: t });
    await call("get", "/api/home", { token: t, etag: homeFirst.etag });
    await call("get", "/api/home");

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

    const documented = APP_ROUTES.flatMap((r) => Object.keys(r.responses).map((status) => `${r.method} ${r.path} ${status}`));
    assert.deepEqual(documented.filter((x) => !seen.has(x)), [], "statuses the contract lists that no route gave");
  });
});
