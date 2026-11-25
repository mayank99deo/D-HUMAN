// Sign-in for the native apps, against a real database (PGlite, or Postgres with
// TEST_DATABASE_URL): bearer tokens from the emailed code, the one resolver, revocation,
// the routes that refuse app tokens, the App Review account, headers and logs. Numbers in
// the names are QA's must-pass test numbers for the native apps.
// The web's own sign-in, cookie and origin rule are checked unchanged alongside.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
type G = {
  __headers?: Headers;
  __cookie?: string;
  __cookieWrites: unknown[][];
  __after: (() => unknown)[];
  __alerts: { key: string; subject: string; text: string }[];
};
const g = globalThis as unknown as G;
g.__cookieWrites = [];
g.__after = [];
g.__alerts = [];

allowAppImports({
  // Route handlers read the request's headers and cookie through next/headers; here they come from the request under test.
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({
      get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined),
      set: (...a) => { globalThis.__cookieWrites.push(["set", ...a]); },
      delete: (...a) => { globalThis.__cookieWrites.push(["delete", ...a]); },
    });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/email/send": "export const sendFounderAlert = async (a) => { globalThis.__alerts.push(a); return { status: 'sent' }; }; export const recordTap = async () => {}; export const sendReviewRequest = async () => {};",
  // The daily job itself is tested elsewhere; here only whether the cron's own call gets through.
  "@/lib/email/jobs": "export const runDaily = async () => { globalThis.__cronRuns = (globalThis.__cronRuns ?? 0) + 1; return { status: 'ok' }; }; export const sendWelcome = async () => {};",
});
const removeDatabase = tempDatabase();

// Every log line in this file, checked at the end for tokens (test 37).
const logged: string[] = [];
for (const m of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[m].bind(console);
  console[m] = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    original(...args);
  };
}

const { and, eq, sql } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { issueCode } = await import("../lib/auth/codes.ts");
const { sha256 } = await import("../lib/auth/crypto.ts");
const { authenticate } = await import("../lib/auth/authenticate.ts");
const { apiUser } = await import("../lib/auth/session.ts");
const { writeGuard, isFresh } = await import("../lib/auth/author.ts");
const { APP_SESSION, carriesAppToken, NOT_FOR_APP_WORDS } = await import("../lib/auth/app-token.ts");
const { reviewAccount } = await import("../lib/auth/review.ts");
const { SIGN_IN_WORDS } = await import("../lib/auth/sign-in-words.ts");
const { installLogScrubber, scrubTokens } = await import("../lib/auth/scrub.ts");
const token = (await import("../app/api/auth/token/route.ts")).POST as Handler;
const apple = (await import("../app/api/auth/apple/route.ts")).POST as Handler;
const verify = (await import("../app/api/auth/verify/route.ts")).POST as Handler;
const signout = (await import("../app/api/auth/signout/route.ts")).POST as Handler;
const deleteAccount = (await import("../app/api/account/delete/route.ts")).POST as Handler;
const devices = (await import("../app/api/me/sessions/route.ts")).GET as Handler;
const endDevice = (await import("../app/api/me/sessions/[publicId]/route.ts")).DELETE as Handler;

after(async () => {
  await removeDatabase();
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.d-human.fit";
const TOKEN = /^dht_[A-Za-z0-9_-]{43}$/;

type Opts = { auth?: string | string[]; cookie?: string; origin?: string; headers?: Record<string, string>; body?: unknown };
let ip = 0;
function request(method: string, url: string, o: Opts = {}): Request {
  const headers = new Headers(o.headers);
  // A new address each time, so the per-IP speed bump never decides a test it isn't about.
  if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", `10.0.${Math.floor(++ip / 250)}.${ip % 250}`);
  for (const a of [o.auth ?? []].flat()) headers.append("authorization", a);
  if (o.cookie) headers.set("cookie", `dh_session=${o.cookie}`);
  if (o.origin) headers.set("origin", o.origin);
  const hasBody = o.body !== undefined;
  if (hasBody) headers.set("content-type", "application/json");
  return new Request(`${SITE}${url}`, { method, headers, body: hasBody ? JSON.stringify(o.body) : undefined });
}

// Every answer a new route gives in this file, for the header and body sweeps at the end.
const answers: { route: string; status: number; headers: Headers; body: string }[] = [];
async function call(route: string, handler: Handler, r: Request, ctx?: unknown) {
  g.__headers = r.headers;
  g.__cookie = /dh_session=([^;]+)/.exec(r.headers.get("cookie") ?? "")?.[1];
  const res = await handler(r, ctx);
  const body = await res.clone().text();
  answers.push({ route, status: res.status, headers: res.headers, body });
  return { res, status: res.status, body: body ? (JSON.parse(body) as Record<string, unknown>) : null };
}
const bearer = (t: string) => `Bearer ${t}`;
const params = (publicId: string) => ({ params: Promise.resolve({ publicId }) });
async function runAfter() {
  const queued = g.__after.splice(0);
  for (const fn of queued) await fn();
}

async function codeFor(email: string) {
  const issued = await issueCode(email);
  assert.ok(issued.ok, "code issued");
  return issued.code;
}

/** The app's sign-in: an emailed code exchanged for a token. */
async function appSignIn(email: string, extra: Partial<Opts> = {}) {
  const code = await codeFor(email);
  const r = await call("token", token, request("POST", "/api/auth/token", { body: { email, code, device: { label: "iPhone18,1", os: "26.1" } }, ...extra }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: r.body!.token as string, body: r.body!, res: r.res };
}

/** The web's sign-in, through the unchanged verify route: returns the cookie it set. */
async function webSignIn(email: string) {
  const code = await codeFor(email);
  g.__cookieWrites = [];
  const r = await call("verify", verify, request("POST", "/api/auth/verify", { origin: SITE, body: { email, code } }));
  assert.equal(r.status, 200);
  const set = g.__cookieWrites.find((w) => w[0] === "set");
  assert.ok(set, "the web's sign-in sets its cookie");
  return { cookie: set[2] as string, write: set, body: r.body! };
}

async function userId(email: string) {
  const d = await db();
  const [u] = await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  return u?.id ?? null;
}

async function sessionRow(t: string) {
  const d = await db();
  const [row] = await d.select().from(schema.sessions).where(eq(schema.sessions.id, sha256(t))).limit(1);
  return row ?? null;
}

/** Who a request acts as on a route that takes app tokens: the device list's owner, or its status. */
async function whoIs(t: string, extra: Partial<Opts> = {}) {
  const r = await call("me/sessions", devices, request("GET", "/api/me/sessions", { auth: bearer(t), ...extra }));
  return r.status;
}

/** Whether a web cookie still signs in, through the unchanged cookie lookup. */
async function cookieWorks(cookie: string) {
  g.__headers = new Headers();
  g.__cookie = cookie;
  return (await apiUser()) !== null;
}

describe("issuing tokens (A1)", () => {
  it("1: an app with an emailed code gets a token in the body, never a cookie", async () => {
    g.__cookieWrites = [];
    const { token: t, body, res } = await appSignIn("first@example.com");
    assert.match(t, TOKEN);
    assert.equal(body.tokenType, "Bearer");
    assert.equal(body.isNew, true);
    assert.equal(body.onboarded, false);
    assert.deepEqual(Object.keys(body.user as object).sort(), ["email", "id"]);
    const days = (Date.parse(body.expiresAt as string) - Date.now()) / 86_400_000;
    assert.ok(days > 89.9 && days <= 90, `expires in ${days} days`);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(g.__cookieWrites, [], "no cookie set or cleared");
    const row = await sessionRow(t);
    assert.equal(row?.kind, "bearer");
    assert.equal(row?.deviceLabel, "iPhone18,1");
    assert.ok(row?.lastUsedAt && row.absoluteExpiresAt, "sliding expiry starts now, with its 365-day cap");
    assert.ok(Math.abs(row!.absoluteExpiresAt!.getTime() - row!.createdAt.getTime() - APP_SESSION.maxMs) < 60_000);
  });

  it("2, 3: a browser gets no token (Origin, or Sec-Fetch-* alone), and its code still works for the app", async () => {
    const email = "browser@example.com";
    const code = await codeFor(email);
    const browsers: Partial<Opts>[] = [{ origin: SITE }, { origin: "https://evil.example" }, { headers: { "sec-fetch-mode": "cors" } }, { headers: { "sec-fetch-site": "same-origin" } }];
    for (const extra of browsers) {
      const r = await call("token", token, request("POST", "/api/auth/token", { body: { email, code }, ...extra }));
      assert.equal(r.status, 400);
      assert.deepEqual(r.body, { error: "not_for_browsers", message: SIGN_IN_WORDS.not_for_browsers });
    }
    const r = await call("token", token, request("POST", "/api/auth/token", { body: { email, code } }));
    assert.equal(r.status, 200, "refused before the code was looked at: no try used");
  });

  it("4: the web's verify is unchanged: only { next }, and its 30-day httpOnly cookie", async () => {
    const { body, write } = await webSignIn("web@example.com");
    assert.deepEqual(Object.keys(body), ["next"]);
    const [, name, value, options] = write as [string, string, string, Record<string, unknown>];
    assert.equal(name, "dh_session");
    assert.doesNotMatch(value, /^dht_/);
    assert.deepEqual({ ...options, expires: undefined }, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: undefined });
    const days = ((options.expires as Date).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30);
    const row = await sessionRow(value);
    assert.deepEqual([row?.kind, row?.lastUsedAt, row?.absoluteExpiresAt, row?.deviceLabel], ["cookie", null, null, null]);
  });

  it("5: only the token's SHA-256 is stored, in no table the token itself", async () => {
    const { token: t } = await appSignIn("stored@example.com");
    assert.equal((await sessionRow(t))?.id, sha256(t));
    const d = await db();
    const tables = await d.execute(sql`select tablename as t from pg_tables where schemaname = 'public'`);
    for (const { t: table } of (tables as unknown as { rows?: { t: string }[] }).rows ?? (tables as unknown as { t: string }[])) {
      const rows = await d.execute(sql.raw(`select * from "${table}"`));
      assert.ok(!JSON.stringify(rows).includes(t.slice(4)), `${table} holds no token`);
    }
  });

  it("6, 20: each token acts as its own person; a cookie never adds to or replaces it", async () => {
    const a = await appSignIn("a6@example.com");
    const b = await appSignIn("b6@example.com");
    const web = await webSignIn("a6@example.com");
    const list = async (t: string, cookie?: string) => (await call("me/sessions", devices, request("GET", "/api/me/sessions", { auth: bearer(t), cookie }))).body?.sessions as { kind: string; current: boolean }[];
    assert.deepEqual((await list(a.token)).map((s) => [s.kind, s.current]), [["web", false], ["app", true]]);
    assert.deepEqual((await list(b.token, web.cookie)).map((s) => [s.kind, s.current]), [["app", true]], "A's cookie with B's token acts as B only");
    assert.equal((await call("me/sessions", devices, request("GET", "/api/me/sessions", { auth: bearer(`${b.token.slice(0, -1)}x`), cookie: web.cookie }))).status, 401, "a bad token with a good cookie is 401");
  });

  it("the 11th phone signs out the one used longest ago", async () => {
    const email = "phones@example.com";
    const tokens: string[] = [];
    const d = await db();
    // Ten phones already signed in (made directly: the email's codes are capped at five an hour).
    tokens.push((await appSignIn(email)).token);
    const { startAppSession } = await import("../lib/auth/bearer.ts");
    for (let i = 1; i < 10; i++) tokens.push((await startAppSession((await userId(email))!, { label: null, client: null })).token);
    for (let i = 0; i < 10; i++) {
      // Each phone last used a minute after the one before.
      await d.update(schema.sessions).set({ lastUsedAt: new Date(Date.now() - (60 - i) * 60_000) }).where(eq(schema.sessions.id, sha256(tokens[i])));
    }
    const eleventh = (await appSignIn(email)).token;
    const live = await d.select({ id: schema.sessions.id }).from(schema.sessions).where(and(eq(schema.sessions.userId, (await userId(email))!), eq(schema.sessions.kind, "bearer")));
    assert.equal(live.length, APP_SESSION.perPerson);
    assert.equal(await whoIs(tokens[0]), 401, "the longest unused is gone");
    assert.equal(await whoIs(tokens[1]), 200);
    assert.equal(await whoIs(eleventh), 200);
  });
});

describe("the token route's own rules", () => {
  it("refuses what isn't a code without using a try, and words every refusal as the web does", async () => {
    const email = "words@example.com";
    const code = await codeFor(email);
    for (const bad of ["12345", "1234567", "12345678901", "12a456", "abcdefghijklmnopqrstuvwxyz", "x".repeat(129), "1".repeat(65)]) {
      const r = await call("token", token, request("POST", "/api/auth/token", { body: { email, code: bad } }));
      assert.deepEqual([r.status, r.body], [400, { error: "invalid", message: SIGN_IN_WORDS.invalid }], bad);
    }
    const d = await db();
    const [row] = await d.select({ attempts: schema.loginCodes.attempts }).from(schema.loginCodes).where(eq(schema.loginCodes.email, email));
    assert.equal(row.attempts, 0);
    const wrong = code === "000000" ? "111111" : "000000";
    assert.deepEqual((await call("token", token, request("POST", "/api/auth/token", { body: { email, code: wrong } }))).body, { error: "invalid", message: SIGN_IN_WORDS.invalid });
    assert.equal((await call("token", token, request("POST", "/api/auth/token", { body: { email, code: `${code.slice(0, 3)} ${code.slice(3)}` } }))).status, 200, "spaces are fine");
    assert.deepEqual((await call("token", token, request("POST", "/api/auth/token", { body: { email, code } }))).body, { error: "expired", message: SIGN_IN_WORDS.expired }, "used once only");
    assert.equal((await call("token", token, request("POST", "/api/auth/token", { body: { email, code, device: { label: "Mayank's <phone>" } } }))).status, 400, "only a hardware model");
    assert.equal((await call("token", token, request("POST", "/api/auth/token", { body: "nonsense" }))).status, 400);
  });

  it("G9: a resend with the same key gets the same token from the one session, and uses no try", async () => {
    const email = "resend@example.com";
    const code = await codeFor(email);
    const key = "8f1d2c3b-4a5e-4f60-9b7c-1d2e3f405162";
    const send = (extra: Record<string, unknown> = {}) => call("token", token, request("POST", "/api/auth/token", { body: { email, code, key, ...extra } }));
    const first = await send();
    assert.equal(first.status, 200);
    assert.match(first.body!.token as string, TOKEN);
    const d = await db();
    const attempts = async () => (await d.select({ a: schema.loginCodes.attempts }).from(schema.loginCodes).where(eq(schema.loginCodes.email, email)))[0].a;
    const used = await attempts();
    const again = await send();
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, first.body, "the same answer, token and all");
    assert.equal(await attempts(), used, "the resend used no try");
    const sessions = async () => (await d.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, (await userId(email))!))).length;
    assert.equal(await sessions(), 1, "one session");
    assert.equal(await whoIs(first.body!.token as string), 200);

    // Another key, another code, another address: no token. Nor the same try after 10 minutes.
    assert.deepEqual((await send({ key: "another-key-0123456789" })).body?.error, "expired");
    assert.equal((await call("token", token, request("POST", "/api/auth/token", { body: { email: "someone@example.com", code, key } }))).status, 400);
    await d.update(schema.sessions).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(schema.sessions.id, sha256(first.body!.token as string)));
    assert.deepEqual((await send()).body?.error, "expired");
    assert.equal(await sessions(), 1);
    assert.equal((await send({ key: "short" })).status, 400, "a key is 16 to 64 url-safe characters");
  });

  it("G9: two sends of one try at the same moment still make one session, and every token given is that one", async () => {
    const email = "crossed@example.com";
    const code = await codeFor(email);
    const key = "crossed-key-0123456789abcdef";
    const results = await Promise.all([0, 1, 2].map(() => call("token", token, request("POST", "/api/auth/token", { body: { email, code, key } }))));
    const tokens = new Set(results.filter((r) => r.status === 200).map((r) => r.body!.token));
    assert.equal(tokens.size, 1, JSON.stringify(results.map((r) => [r.status, r.body?.error])));
    for (const r of results.filter((x) => x.status !== 200)) assert.equal(r.body?.error, "expired");
    const d = await db();
    assert.equal((await d.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, (await userId(email))!))).length, 1);
    // Whatever the first answers were, a resend now gets the token.
    const late = await call("token", token, request("POST", "/api/auth/token", { body: { email, code, key } }));
    assert.equal(late.body?.token, [...tokens][0]);
  });

  it("shares the web verify's per-IP speed bump, and says when to come back", async () => {
    const headers = { "x-forwarded-for": "198.51.100.7" };
    let last = 0;
    let retry: string | null = null;
    for (let i = 0; i < 21; i++) {
      const r = await call("token", token, request("POST", "/api/auth/token", { headers, body: { email: "limit@example.com", code: "123456" } }));
      last = r.status;
      retry = r.res.headers.get("retry-after");
    }
    assert.equal(last, 429);
    assert.equal(retry, "600");
  });

  it("the app's sign-in words are the web form's words", () => {
    const form = readFileSync(path.join(ROOT, "components/platform/SignInForm.tsx"), "utf8");
    for (const key of ["invalid", "expired", "locked", "rate_limited"] as const) {
      const m = new RegExp(`\\b${key}: "([^"]+)"`).exec(form);
      assert.equal(m?.[1], SIGN_IN_WORDS[key], key);
    }
  });

  it("Sign in with Apple says plainly it isn't on yet (501), and never answers a browser", async () => {
    const r = await call("apple", apple, request("POST", "/api/auth/apple", { body: { identityToken: "x" } }));
    assert.deepEqual([r.status, r.body], [501, { error: "apple_unavailable", message: SIGN_IN_WORDS.apple_unavailable }]);
    assert.equal((await call("apple", apple, request("POST", "/api/auth/apple", { origin: SITE, body: {} }))).status, 400);
  });
});

describe("using tokens (A3, A4)", () => {
  let good: string;
  before(async () => {
    good = (await appSignIn("use@example.com")).token;
  });

  it("7: anything but `Bearer dht_<43>` exactly is 401", async () => {
    const basic = `Basic ${Buffer.from("a:b").toString("base64")}`;
    // A trailing space can't be tested: HTTP strips spaces around a header's value before
    // anything reads it (RFC 9110 §5.5), so it arrives as the bare token. Words after it can.
    const variants: (string | string[])[] = ["Bearer", `Bearer  ${good}`, `bearer ${good}`, `BEARER ${good}`, basic, `Token ${good}`, `Bearer ${good} x`, `Bearer\t${good}`, `Bearer ${good.slice(0, -1)}`, `Bearer ${good}x`, [bearer(good), bearer(good)], `Bearer ${good.slice(4)}`];
    for (const auth of variants) {
      assert.equal((await call("me/sessions", devices, request("GET", "/api/me/sessions", { auth }))).status, 401, JSON.stringify(auth));
    }
    assert.equal(await whoIs(good), 200);
  });

  it("8: expired, revoked or a deleted person's token is 401", async () => {
    const d = await db();
    const t1 = (await appSignIn("expired@example.com")).token;
    await d.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.id, sha256(t1)));
    assert.equal(await whoIs(t1), 401);
    const t2 = (await appSignIn("revoked@example.com")).token;
    await d.delete(schema.sessions).where(eq(schema.sessions.id, sha256(t2)));
    assert.equal(await whoIs(t2), 401);
    const t3 = (await appSignIn("gone@example.com")).token;
    await d.delete(schema.users).where(eq(schema.users.email, "gone@example.com"));
    assert.equal(await whoIs(t3), 401);
  });

  it("9: a token anywhere but the header is ignored", async () => {
    for (const url of [`/api/me/sessions?token=${good}`, `/api/me/sessions?access_token=${good}`]) {
      assert.equal((await call("me/sessions", devices, request("GET", url))).status, 401);
    }
    assert.equal((await call("me/sessions", devices, new Request(`${SITE}/api/me/sessions`, { method: "GET", headers: { "x-forwarded-for": "10.9.9.9" } }))).status, 401);
    assert.equal((await call("signout-web", signout, request("POST", "/api/auth/signout", { body: { token: good } }))).status, 200, "a body token is no token: the web's sign-out runs, and ends nothing");
    assert.equal(await whoIs(good), 200);
  });

  it("21: a token with any Origin header is 401, even our own", async () => {
    for (const origin of [SITE, "https://evil.example", "null"]) assert.equal(await whoIs(good, { origin }), 401, origin);
    assert.equal(await whoIs(good, { headers: { "sec-fetch-site": "same-origin" } }), 401);
  });

  it("a token sent as the web's cookie opens nothing, not /write either", async () => {
    g.__after = [];
    g.__headers = new Headers();
    g.__cookie = good;
    assert.equal(await authenticate(request("GET", "/api/me", { cookie: good })), null);
    assert.equal(await cookieWorks(good), false);
    process.env.BLOG_OWNER_EMAILS = "use@example.com";
    g.__headers = new Headers();
    g.__cookie = good;
    const guard = await writeGuard(request("GET", "/api/write/posts"), { mutation: false });
    assert.ok(!guard.ok && guard.response.status === 401, "signed out on /write");
    delete process.env.BLOG_OWNER_EMAILS;
  });

  it("apiUser, under every route not yet open to the apps, never reads the cookie of a request with a token (A4)", async () => {
    const web = await webSignIn("unconverted@example.com");
    g.__cookie = web.cookie;
    g.__headers = new Headers({ authorization: bearer(good) });
    assert.equal(await apiUser(), null);
    g.__headers = new Headers();
    assert.ok(await apiUser(), "the web's cookie request is unchanged");
  });

  it("10, 16: the expiry slides with use, up to the 365-day cap; the sign-in time never moves", async () => {
    const t = (await appSignIn("slide@example.com")).token;
    const d = await db();
    const signedIn = new Date(Date.now() - 40 * 86_400_000);
    // Signed in 40 days ago, last used two hours ago, 10 days left.
    await d.update(schema.sessions).set({ createdAt: signedIn, lastUsedAt: new Date(Date.now() - 2 * 3_600_000), expiresAt: new Date(Date.now() + 10 * 86_400_000) }).where(eq(schema.sessions.id, sha256(t)));
    g.__after = [];
    assert.equal(await whoIs(t, { headers: { "x-dhuman-client": "ios/1.0.0 (42)" } }), 200);
    await runAfter();
    let row = (await sessionRow(t))!;
    assert.ok(Math.abs(row.expiresAt.getTime() - (Date.now() + APP_SESSION.idleMs)) < 60_000, "90 days from now");
    assert.equal(row.createdAt.getTime(), signedIn.getTime(), "auth_at (created_at) unchanged");
    assert.equal(row.client, "ios/1.0.0 (42)");
    assert.equal(isFresh(row.createdAt), false, "a 40-day-old sign-in, used daily, is not fresh for /write");

    // Near the cap: the expiry never passes it.
    const cap = new Date(Date.now() + 5 * 86_400_000);
    await d.update(schema.sessions).set({ lastUsedAt: new Date(Date.now() - 2 * 3_600_000), absoluteExpiresAt: cap }).where(eq(schema.sessions.id, sha256(t)));
    await whoIs(t);
    await runAfter();
    row = (await sessionRow(t))!;
    assert.equal(row.expiresAt.getTime(), cap.getTime());

    // Idle past it: signed out.
    await d.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.sessions.id, sha256(t)));
    assert.equal(await whoIs(t), 401);
  });

  it("11: last use is written at most once an hour, even for requests arriving together", async () => {
    const t = (await appSignIn("touch@example.com")).token;
    const d = await db();
    await d.update(schema.sessions).set({ lastUsedAt: new Date(Date.now() - 3 * 3_600_000) }).where(eq(schema.sessions.id, sha256(t)));
    g.__after = [];
    await Promise.all(Array.from({ length: 10 }, () => authenticate(request("GET", "/api/me", { auth: bearer(t) }))));
    const queued = g.__after.splice(0);
    assert.equal(queued.length, 10, "each request saw an old last use");
    const { touchAppSession, findBearerSession } = await import("../lib/auth/bearer.ts");
    const session = (await findBearerSession(t))!;
    const writes = await Promise.all(Array.from({ length: 10 }, () => touchAppSession(session, null)));
    assert.equal(writes.filter(Boolean).length, 1, "one write");
    await Promise.all(Array.from({ length: 5 }, () => authenticate(request("GET", "/api/me", { auth: bearer(t) }))));
    assert.equal(g.__after.length, 0, "used a moment ago: nothing to write");
  });
});

describe("revoking (A9)", () => {
  it("12: sign-out ends this phone only; the other phone and the web stay signed in", async () => {
    const email = "out@example.com";
    const one = (await appSignIn(email)).token;
    const two = (await appSignIn(email)).token;
    const web = await webSignIn(email);
    g.__cookieWrites = [];
    const r = await call("signout", signout, request("POST", "/api/auth/signout", { auth: bearer(one) }));
    assert.deepEqual([r.status, r.body], [200, { status: "signed_out" }]);
    assert.deepEqual(g.__cookieWrites, [], "no cookie touched");
    assert.equal(await whoIs(one), 401);
    assert.equal(await whoIs(two), 200);
    assert.equal(await cookieWorks(web.cookie), true);
    assert.equal((await call("signout", signout, request("POST", "/api/auth/signout", { auth: bearer(one) }))).status, 401, "already out");
  });

  it("13: 'sign out other devices' ends every other phone and the web's cookies; this phone stays", async () => {
    const email = "others@example.com";
    const keep = (await appSignIn(email)).token;
    const other = (await appSignIn(email)).token;
    const web = await webSignIn(email);
    const r = await call("signout", signout, request("POST", "/api/auth/signout", { auth: bearer(keep), body: { others: true } }));
    assert.deepEqual([r.status, r.body], [200, { status: "signed_out_others", ended: 2 }]);
    assert.equal(await whoIs(other), 401);
    assert.equal(await cookieWorks(web.cookie), false);
    assert.equal(await whoIs(keep), 200);
  });

  it("the device list ends one session by its handle; someone else's handle is a 404 like a missing one", async () => {
    const mine = (await appSignIn("list@example.com")).token;
    const second = (await appSignIn("list@example.com")).token;
    const theirs = (await appSignIn("stranger@example.com")).token;
    const handleOf = async (t: string) => (await sessionRow(t))!.publicId;
    const missing = await call("device", endDevice, request("DELETE", "/api/me/sessions/x", { auth: bearer(mine) }), params("00000000-0000-0000-0000-000000000000"));
    const foreign = await call("device", endDevice, request("DELETE", "/api/me/sessions/x", { auth: bearer(mine) }), params(await handleOf(theirs)));
    assert.deepEqual([foreign.status, foreign.body], [missing.status, missing.body]);
    assert.equal(foreign.status, 404);
    assert.equal(await whoIs(theirs), 200);
    const ended = await call("device", endDevice, request("DELETE", "/api/me/sessions/x", { auth: bearer(mine) }), params(await handleOf(second)));
    assert.equal(ended.status, 200);
    assert.equal(await whoIs(second), 401);
    const list = (await call("me/sessions", devices, request("GET", "/api/me/sessions", { auth: bearer(mine) }))).body!.sessions as Record<string, unknown>[];
    assert.deepEqual(Object.keys(list[0]).sort(), ["current", "deviceLabel", "kind", "lastUsedAt", "publicId", "signedInAt"], "never the hash");
    const web = await webSignIn("list@example.com");
    assert.equal((await call("me/sessions", devices, request("GET", "/api/me/sessions", { cookie: web.cookie }))).status, 403, "apps only for now");
  });

  it("14, 24: deleting the account over a token (no Origin needed) ends every session, sets no cookie, and a new sign-in is a new person", async () => {
    const email = "leaver@example.com";
    const t = (await appSignIn(email)).token;
    const other = (await appSignIn(email)).token;
    const web = await webSignIn(email);
    const before = await userId(email);
    assert.equal((await call("delete", deleteAccount, request("POST", "/api/account/delete", { auth: bearer(t), body: {} }))).status, 400, "needs the confirm");
    assert.equal((await call("delete", deleteAccount, request("POST", "/api/account/delete", { auth: bearer(`${t.slice(0, -1)}x`), body: { confirm: "DELETE" } }))).status, 401);
    g.__cookieWrites = [];
    const r = await call("delete", deleteAccount, request("POST", "/api/account/delete", { auth: bearer(t), body: { confirm: "DELETE" } }));
    assert.deepEqual([r.status, r.body], [200, { status: "deleted" }]);
    assert.equal(r.res.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(g.__cookieWrites, [], "no cookie set or cleared");
    for (const x of [t, other]) assert.equal(await whoIs(x), 401);
    assert.equal(await cookieWorks(web.cookie), false);
    const again = await appSignIn(email);
    assert.equal(again.body.isNew, true);
    assert.notEqual(await userId(email), before);
  });

  it("15, 23: the web's delete is unchanged (origin rule, cookie cleared), and it ends the apps' tokens too", async () => {
    const email = "webleaver@example.com";
    const t = (await appSignIn(email)).token;
    const web = await webSignIn(email);
    for (const origin of [undefined, "https://evil.example"]) {
      const r = await call("delete-web", deleteAccount, request("POST", "/api/account/delete", { cookie: web.cookie, origin, body: { confirm: "DELETE" } }));
      assert.deepEqual([r.status, r.body], [403, { error: "bad_origin" }]);
      assert.equal(r.res.headers.get("cache-control"), null, "the web's answers keep their headers");
    }
    g.__cookieWrites = [];
    const r = await call("delete-web", deleteAccount, request("POST", "/api/account/delete", { cookie: web.cookie, origin: SITE, body: { confirm: "DELETE" } }));
    assert.equal(r.res.headers.get("cache-control"), null);
    assert.deepEqual([r.status, r.body], [200, { status: "deleted" }]);
    assert.ok(g.__cookieWrites.some((w) => w[0] === "delete" && w[1] === "dh_session"), "the web's cookie is cleared, as before");
    assert.equal(await whoIs(t), 401);
  });
});

describe("where app tokens are refused (A6)", () => {
  it("17: the blog's writer, cron, dev routes, both webhooks, unsubscribe and the waitlist answer 403 not_for_app before anything runs", async () => {
    const t = (await appSignIn("refused@example.com")).token;
    process.env.CRON_SECRET = "cron-secret-for-tests";
    const routes: [string, Handler, string][] = [
      ["/api/cron/daily", (await import("../app/api/cron/daily/route.ts")).GET as Handler, "GET"],
      ["/api/dev/session", (await import("../app/api/dev/session/route.ts")).GET as Handler, "GET"],
      ["/api/email-preview", (await import("../app/api/email-preview/route.ts")).GET as Handler, "GET"],
      ["/api/billing/webhook", (await import("../app/api/billing/webhook/route.ts")).POST as Handler, "POST"],
      ["/api/email/webhook", (await import("../app/api/email/webhook/route.ts")).POST as Handler, "POST"],
      ["/api/email/unsubscribe", (await import("../app/api/email/unsubscribe/route.ts")).POST as Handler, "POST"],
      ["/api/email/unsubscribe", (await import("../app/api/email/unsubscribe/route.ts")).GET as Handler, "GET"],
      ["/api/waitlist", (await import("../app/api/waitlist/route.ts")).POST as Handler, "POST"],
      ["/api/waitlist/details", (await import("../app/api/waitlist/details/route.ts")).POST as Handler, "POST"],
      ["/api/waitlist/form", (await import("../app/api/waitlist/form/route.ts")).POST as Handler, "POST"],
    ];
    for (const [url, handler, method] of routes) {
      for (const auth of [bearer(t), "bearer dht_whatever"]) {
        const r = await handler(request(method, `${url}?t=x`, { auth, body: method === "POST" ? {} : undefined }));
        // Never 401: the app would wipe a sign-in that's fine (QA's call, 2026-11-26).
        assert.equal(r.status, 403, `${method} ${url}`);
        assert.deepEqual(await r.json(), { error: "not_for_app", message: NOT_FOR_APP_WORDS }, `${method} ${url}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store", `${method} ${url}`);
      }
    }
    // Their own secrets are not app tokens: the cron still checks its own, and Vercel Cron's call gets through.
    const cron = routes[0][1];
    assert.deepEqual(await (await cron(request("GET", "/api/cron/daily", { auth: "Bearer not-the-secret" }))).json(), { error: "unauthorized" });
    const runs = (globalThis as { __cronRuns?: number }).__cronRuns ?? 0;
    const real = await cron(request("GET", "/api/cron/daily", { auth: "Bearer cron-secret-for-tests", headers: { "x-vercel-cron-schedule": "0 5 * * *" } }));
    assert.equal(real.status, 200);
    assert.equal((globalThis as { __cronRuns?: number }).__cronRuns, runs + 1, "the daily job ran");
    delete process.env.CRON_SECRET;

    // Every /api/write route goes through writeGuard first.
    process.env.BLOG_OWNER_EMAILS = "refused@example.com";
    const web = await webSignIn("refused@example.com");
    g.__cookie = web.cookie;
    for (const mutation of [true, false]) {
      const guard = await writeGuard(request("POST", "/api/write/posts", { auth: bearer(t), cookie: web.cookie, origin: SITE }), { mutation });
      assert.ok(!guard.ok && guard.response.status === 403);
    }
    const plain = await writeGuard(request("POST", "/api/write/posts", { cookie: web.cookie, origin: SITE }));
    assert.ok(plain.ok, "the writer's own cookie request is unchanged");
    delete process.env.BLOG_OWNER_EMAILS;
    const writeRoutes = readdirRecursive(path.join(ROOT, "app/api/write")).filter((f) => f.endsWith("route.ts"));
    assert.ok(writeRoutes.length >= 11);
    for (const f of writeRoutes) assert.match(readFileSync(f, "utf8"), /writeGuard\(request/, path.relative(ROOT, f));
  });

  it("only our own dht_ tokens count as app tokens: the cron's and the Sheets form's secrets don't", () => {
    const has = (auth: string) => carriesAppToken(new Request(SITE, { headers: { authorization: auth } }));
    const hex = "9f".repeat(32); // what `openssl rand -hex 32` makes, as CRON_SECRET is made
    for (const auth of [`Bearer ${hex}`, "Bearer cron-secret", "Basic YTpi", "Bearer xdht_abc", "Bearer  "]) assert.equal(has(auth), false, auth);
    for (const auth of [`Bearer dht_${"a".repeat(43)}`, "bearer dht_x", "BEARER   dht_", " Bearer dht_x"]) assert.equal(has(auth), true, auth);
    assert.equal(carriesAppToken(new Request(SITE)), false);
  });

  it("18: only the token route mints a token, and nothing exchanges a cookie for one", async () => {
    const minting = readdirRecursive(path.join(ROOT, "app")).filter((f) => /\.(ts|tsx)$/.test(f) && /startAppSession|newAppToken/.test(readFileSync(f, "utf8")));
    assert.deepEqual(minting.map((f) => path.relative(ROOT, f)), ["app/api/auth/token/route.ts"]);
    const web = await webSignIn("cookieonly@example.com");
    const r = await call("token", token, request("POST", "/api/auth/token", { cookie: web.cookie }));
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.body).includes("dht_"));
  });
});

// QA's call (2026-11-26): a route the apps can't use yet answers a live token 403 not_for_app,
// never 401, because a 401 makes the app wipe a sign-in that's fine. Only a missing, malformed,
// expired or revoked token gets 401. The web never sends Authorization, so it never meets this.
describe("routes not open to the apps yet (not_for_app)", () => {
  // Sign-in itself: no session is read, so an app token changes nothing there.
  const SIGN_IN = ["app/api/auth/code/route.ts", "app/api/auth/verify/route.ts"];
  const HANDLER = /export async function (GET|POST|PUT|PATCH|DELETE)\(/g;
  const GUARDED = /export async function (GET|POST|PUT|PATCH|DELETE)\((\w+)[^)]*\)[^{]*\{\s*const refused = await notForApp\(\2\);[^\n]*\n\s*if \(refused\) return refused;/g;

  async function notOpen() {
    const { APP_ROUTES } = await import("../lib/api/openapi.ts");
    const open = new Set(APP_ROUTES.map((r) => r.file));
    return readdirRecursive(path.join(ROOT, "app/api"))
      .filter((f) => f.endsWith("route.ts"))
      .map((f) => path.relative(ROOT, f))
      .filter((f) => !open.has(f) && !SIGN_IN.includes(f))
      .filter((f) => {
        const src = readFileSync(path.join(ROOT, f), "utf8");
        return !/if \(carriesAppToken\(request\)\) return refuseAppToken\(\);/.test(src) && !/writeGuard\(request/.test(src);
      });
  }

  it("every /api route is open to the apps, refuses their tokens outright (A6), is sign-in itself, or checks notForApp first in every handler", async () => {
    const rest = await notOpen();
    assert.ok(rest.length >= 21, `${rest.length} routes`);
    for (const f of rest) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      const handlers = src.match(HANDLER)?.length ?? 0;
      assert.ok(handlers > 0, f);
      assert.equal(src.match(GUARDED)?.length ?? 0, handlers, `${f}: every handler must start with notForApp(request)`);
    }
    for (const f of SIGN_IN) assert.doesNotMatch(readFileSync(path.join(ROOT, f), "utf8"), /apiUser|getSessionUser|cookies\(\)/, `${f} reads no session`);
  });

  it("each answers a live token 403 not_for_app and does nothing; a dead, malformed or page-sent token 401; the web's request never meets it", async () => {
    const email = "notyet@example.com";
    const live = (await appSignIn(email)).token;
    const dead = (await appSignIn(email)).token;
    const d = await db();
    await d.delete(schema.sessions).where(eq(schema.sessions.id, sha256(dead)));
    const uid = (await userId(email))!;
    const before = JSON.stringify(await d.select().from(schema.profiles).where(eq(schema.profiles.userId, uid)));
    const ctx = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) };
    let checked = 0;
    for (const f of await notOpen()) {
      const mod = (await import(`../${f}`)) as Record<string, Handler>;
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function")) {
        const url = `/${f.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`;
        const body = method === "GET" ? undefined : { name: "CHANGED", confirm: "DELETE", eventId: "x", text: "dal" };
        const sent = async (o: Opts) => {
          g.__after = [];
          return call(`not-open ${method} ${url}`, mod[method], request(method, url, { body, ...o }), ctx);
        };
        const ok = await sent({ auth: bearer(live) });
        assert.deepEqual([ok.status, ok.body], [403, { error: "not_for_app", message: NOT_FOR_APP_WORDS }], `${method} ${url}`);
        assert.equal(ok.res.headers.get("cache-control"), "private, no-store", `${method} ${url}`);
        assert.equal(ok.res.headers.get("set-cookie"), null, `${method} ${url}`);
        for (const auth of [bearer(dead), "Bearer dht_x", `Basic ${Buffer.from("a:b").toString("base64")}`]) {
          const r = await sent({ auth });
          assert.deepEqual([r.status, r.body], [401, { error: "signed_out" }], `${method} ${url} ${auth.slice(0, 12)}`);
        }
        const page = await sent({ auth: bearer(live), origin: SITE });
        assert.equal(page.status, 401, `${method} ${url}: a token with a page's Origin`);
        checked++;
      }
    }
    assert.ok(checked >= 26, `${checked} handlers`);
    assert.equal(JSON.stringify(await d.select().from(schema.profiles).where(eq(schema.profiles.userId, uid))), before, "nothing ran");

    // Without Authorization it's nothing at all, cookie or none, and the route runs as before.
    const { notForApp: check } = await import("../lib/auth/authenticate.ts");
    const web = await webSignIn(email);
    for (const o of [{}, { cookie: web.cookie }, { cookie: web.cookie, origin: SITE }, { cookie: dead }]) assert.equal(await check(request("POST", "/api/profile", o)), null);
    const tour = (await import("../app/api/profile/tour/route.ts")).POST as Handler;
    const r = await call("tour-web", tour, request("POST", "/api/profile/tour", { cookie: web.cookie, body: {} }));
    assert.notEqual(r.body?.error, "not_for_app");
    assert.equal(r.res.headers.get("cache-control"), null, "the web's answers keep their own headers");
  });
});

describe("the App Review account (19)", () => {
  const REVIEW = "review@example.com";
  const CODE = "48201937465012983746"; // digits only, 12 or more, so the number pad can type it (G4)
  const on = () => {
    process.env.REVIEW_SIGNIN_ON = "1";
    process.env.REVIEW_ACCOUNT_EMAIL = REVIEW;
    process.env.REVIEW_CODE_HASH = createHash("sha256").update(CODE).digest("hex");
  };
  const off = () => {
    delete process.env.REVIEW_SIGNIN_ON;
    delete process.env.REVIEW_ACCOUNT_EMAIL;
    delete process.env.REVIEW_CODE_HASH;
  };
  const tryCode = (email: string, code: string) => call("token", token, request("POST", "/api/auth/token", { body: { email, code } }));
  before(async () => {
    await appSignIn(REVIEW); // the account exists, set up beforehand
  });
  after(off);

  it("works only for the review address, only while switched on, and tells the founders", async () => {
    on();
    g.__alerts = [];
    g.__after = [];
    const r = await tryCode(REVIEW, CODE);
    assert.equal(r.status, 200);
    assert.equal((await sessionRow(r.body!.token as string))?.userId, await userId(REVIEW));
    await runAfter();
    assert.equal(g.__alerts.length, 1);
    assert.ok(!JSON.stringify(g.__alerts).includes(REVIEW), "the alert names no address");
    assert.ok(logged.some((l) => l.includes("[auth] review account signed in")) && !logged.some((l) => l.includes(REVIEW)), "logged as a count");

    // Another address: the same code is a wrong code, and uses one of that email's tries.
    const other = "notreview@example.com";
    await codeFor(other);
    assert.deepEqual((await tryCode(other, CODE)).body, { error: "invalid", message: SIGN_IN_WORDS.invalid });
    const d = await db();
    const [row] = await d.select({ attempts: schema.loginCodes.attempts }).from(schema.loginCodes).where(eq(schema.loginCodes.email, other));
    assert.equal(row.attempts, 1);

    off();
    assert.equal((await tryCode(REVIEW, CODE)).status, 400, "switched off");
    assert.equal(reviewAccount({ REVIEW_SIGNIN_ON: "1", REVIEW_ACCOUNT_EMAIL: REVIEW, REVIEW_CODE_HASH: "abc" }), null, "a malformed hash is off");
    assert.equal(reviewAccount({ REVIEW_ACCOUNT_EMAIL: REVIEW, REVIEW_CODE_HASH: process.env.REVIEW_CODE_HASH }), null, "off by default");
  });

  it("has an emailed code's limits: five tries a window, the email's five codes an hour", async () => {
    on();
    const d = await db();
    await d.delete(schema.loginCodes).where(eq(schema.loginCodes.email, REVIEW));
    const wrong = `${CODE.slice(0, -1)}0`;
    const errors: unknown[] = [];
    for (let i = 0; i < 26; i++) errors.push((await tryCode(REVIEW, wrong)).body?.error);
    assert.deepEqual(errors.slice(0, 5), ["invalid", "invalid", "invalid", "invalid", "locked"]);
    assert.equal(errors.at(-1), "locked");
    assert.equal((await tryCode(REVIEW, CODE)).body?.error, "locked", "even the right code waits for the hour");
    const windows = await d.select().from(schema.loginCodes).where(eq(schema.loginCodes.email, REVIEW));
    assert.equal(windows.length, 5, "windows count as the email's codes");
    assert.ok(windows.every((w) => w.consumedAt), "written used, so the web's verifyCode never reads one");
    off();
  });

  it("never creates an account, and an emailed code still works for the review address", async () => {
    on();
    process.env.REVIEW_ACCOUNT_EMAIL = "nobody-yet@example.com";
    assert.equal((await tryCode("nobody-yet@example.com", CODE)).body?.error, "invalid");
    assert.equal(await userId("nobody-yet@example.com"), null);
    on();
    const d = await db();
    await d.delete(schema.loginCodes).where(eq(schema.loginCodes.email, REVIEW));
    const code = await codeFor(REVIEW);
    await tryCode(REVIEW, `${CODE}1`); // opens a window
    assert.equal((await tryCode(REVIEW, code)).status, 200);
    off();
  });

  it("G4: the code is digits, 12 or more, spaces allowed; anything shorter or with letters isn't a review code", async () => {
    on();
    const d = await db();
    await d.delete(schema.loginCodes).where(eq(schema.loginCodes.email, REVIEW));
    assert.equal((await tryCode(REVIEW, CODE.replace(/(\d{4})/g, "$1 ").trim())).status, 200, "as typed in groups of four");
    for (const bad of [CODE.slice(0, 11), `${CODE.slice(0, 12)}a`, "1".repeat(65)]) assert.deepEqual((await tryCode(REVIEW, bad)).body?.error, "invalid", bad);
    // With a resend key, a resend gets the same token and uses no try.
    const key = "review-resend-key-0123456789";
    const first = await call("token", token, request("POST", "/api/auth/token", { body: { email: REVIEW, code: CODE, key } }));
    const tries = async () => (await d.select({ a: schema.loginCodes.attempts }).from(schema.loginCodes).where(eq(schema.loginCodes.email, REVIEW))).reduce((n, r) => n + r.a, 0);
    const used = await tries();
    const again = await call("token", token, request("POST", "/api/auth/token", { body: { email: REVIEW, code: CODE, key } }));
    assert.equal(again.body?.token, first.body?.token);
    assert.equal(await tries(), used);
    off();
  });
});

describe("caching, cookies, CORS and logs", () => {
  it("the device list answers 304 to its own ETag, private and with no body", async () => {
    const t = (await appSignIn("etag@example.com")).token;
    const first = await call("me/sessions", devices, request("GET", "/api/me/sessions", { auth: bearer(t) }));
    const etag = first.res.headers.get("etag");
    assert.match(etag ?? "", /^W\/"[A-Za-z0-9_-]{22}"$/);
    const again = await call("me/sessions", devices, request("GET", "/api/me/sessions", { auth: bearer(t), headers: { "if-none-match": etag! } }));
    assert.equal(again.status, 304);
    assert.equal(again.body, null);
    assert.equal(again.res.headers.get("etag"), etag);
    assert.equal(again.res.headers.get("cache-control"), "private, no-store");
    await appSignIn("etag@example.com");
    const changed = await call("me/sessions", devices, request("GET", "/api/me/sessions", { auth: bearer(t), headers: { "if-none-match": etag! } }));
    assert.equal(changed.status, 200, "a new phone changes the list");
    assert.notEqual(changed.res.headers.get("etag"), etag);
  });

  it("25: a new GET changes nothing but its own session's last use", async () => {
    const t = (await appSignIn("readonly@example.com")).token;
    const d = await db();
    await d.update(schema.sessions).set({ lastUsedAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(schema.sessions.id, sha256(t)));
    const snapshot = async () => {
      const out: Record<string, string> = {};
      const tables = (await d.execute(sql`select tablename as t from pg_tables where schemaname = 'public' order by 1`)) as unknown as { rows?: { t: string }[] };
      for (const { t: table } of tables.rows ?? (tables as unknown as { t: string }[])) {
        const cols = table === "sessions" ? "id, user_id, created_at, kind, public_id, device_label, absolute_expires_at" : "*";
        out[table] = JSON.stringify(await d.execute(sql.raw(`select ${cols} from "${table}" order by 1`)));
      }
      return out;
    };
    const before = await snapshot();
    g.__after = [];
    await call("me/sessions", devices, request("GET", "/api/me/sessions", { auth: bearer(t) }));
    await runAfter();
    assert.deepEqual(await snapshot(), before);
  });

  it("22: no source sends an Access-Control-Allow-* header", () => {
    const files = [...readdirRecursive(path.join(ROOT, "app")), ...readdirRecursive(path.join(ROOT, "lib")), ...readdirRecursive(path.join(ROOT, "components"))]
      .concat(["next.config.ts", "proxy.ts", "vercel.json", "instrumentation.ts"].map((f) => path.join(ROOT, f)))
      .filter((f) => /\.(ts|tsx|mjs|js|json)$/.test(f));
    const offenders = files.filter((f) => /access-control-allow/i.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders, []);
  });

  it("35: nothing the new routes load caches across requests", () => {
    const entries = ["app/api/auth/token/route.ts", "app/api/auth/apple/route.ts", "app/api/auth/signout/route.ts", "app/api/account/delete/route.ts", "app/api/me/sessions/route.ts", "app/api/me/sessions/[publicId]/route.ts"];
    const seen = importGraph(entries);
    assert.ok(seen.size > 10, `walked ${seen.size} files`);
    const offenders = [...seen].filter((f) => /["']use cache["']|unstable_cache|cacheLife\(/.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });

  it("34, 36: every answer of the new routes is private, no-store, and none sets a cookie", () => {
    // The web's own calls (its verify, sign-out, delete and a tour save) are checked unchanged in their tests.
    const fresh = answers.filter((a) => !["verify", "signout-web", "delete-web", "tour-web"].includes(a.route));
    assert.ok(fresh.length > 50, `${fresh.length} answers checked`);
    for (const a of fresh) {
      assert.equal(a.headers.get("cache-control"), "private, no-store", `${a.route} ${a.status}`);
      assert.equal(a.headers.get("set-cookie"), null, `${a.route} ${a.status}`);
    }
    const statuses = new Set(fresh.map((a) => a.status));
    for (const s of [200, 304, 400, 401, 403, 404, 429, 501]) assert.ok(statuses.has(s), `a ${s} was checked`);
  });

  it("37: no answer but a sign-in, and no log line, holds a token", () => {
    for (const a of answers) {
      if (a.route === "token" && a.status === 200) continue;
      assert.ok(!a.body.includes("dht_"), `${a.route} ${a.status}`);
    }
    assert.deepEqual(logged.filter((l) => l.includes("dht_")), []);
  });

  it("37: the log scrubber redacts tokens in text, errors and objects, and leaves every other line alone", () => {
    const seen: unknown[][] = [];
    const fake = { log: (...a: unknown[]) => seen.push(a), info: () => {}, warn: () => {}, error: (...a: unknown[]) => seen.push(a), debug: () => {}, trace: () => {} } as unknown as Console;
    installLogScrubber(fake);
    installLogScrubber(fake); // once only
    const t = `dht_${"a".repeat(43)}`;
    const plain = { n: 1 };
    fake.log("plain line", plain, 3);
    fake.log(`got ${t}`);
    fake.error(new Error(`bad ${t}`));
    fake.log(new Headers({ authorization: `Bearer ${t}` }));
    assert.equal(seen[0][1], plain, "untouched objects pass through as themselves");
    assert.deepEqual(seen[0], ["plain line", plain, 3]);
    for (const line of seen.slice(1)) assert.ok(!String(line[0]).includes(t), String(line[0]));
    assert.equal(scrubTokens(`a ${t} b`), "a dht_[redacted] b");
  });
});

function readdirRecursive(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? readdirRecursive(full) : [full];
  });
}

/** Every repo file reachable by import from the entries (packages excluded). */
function importGraph(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {}
    }
    return null;
  };
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const next = resolve(file, m[1] ?? m[2]);
      if (next) visit(next);
    }
  };
  for (const e of entries) visit(path.join(ROOT, e));
  return seen;
}
