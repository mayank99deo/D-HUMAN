// Races on the apps' path (backend test engineer, hunt 1). On PGlite these run one query at a
// time, so they prove the logic; with TEST_DATABASE_URL set they run on real Postgres through
// production's driver and pool, where the requests really overlap:
//   TEST_DATABASE_URL=postgres://… node --test tests/app-races.test.ts
// Each sends many requests at once and checks what the database holds afterwards:
//   - sign-in: one code sent at once with many keys signs in once; one key many times is one session;
//   - meals and Log again together at 3 of 5: exactly two get through, whichever way in;
//   - one upload key sent ten times at once: one report, one read;
//   - the usual-day cap and the apps' daily breaker under parallel saves, with the founders told once;
//   - sign-out while a meal is being read: the read finishes, the token is dead after, nothing 500s;
//   - the account deleted while a meal is being read: no meal, no use, no 500 (the app is told it's signed out).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
type G = { __headers?: Headers; __after: (() => unknown)[]; __gate?: Promise<void>; __alerts: number; __reads: number };
const g = globalThis as unknown as G;
g.__after = [];
g.__alerts = 0;
g.__reads = 0;
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: () => undefined, set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/email/send": "export const sendFounderAlert = async () => { globalThis.__alerts++; return { status: 'sent' }; };",
  "@/lib/auth/email": "export const sendSignInCode = async () => true;",
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "live";`,
  // A meal read that waits on __gate when one is set, so a test can act while it's in flight.
  "@/lib/ai/food": `
    export const estimateMeal = async (input) => {
      globalThis.__reads++;
      if (globalThis.__gate) await globalThis.__gate;
      const item = { name: "Dal", portion: "1 bowl", grams: null, kcal: 180, protein_g: 9, carbs_g: 24, fat_g: 5, fibre_g: 6 };
      return { data: { is_food: true, reply_language: input.words.reply.id, title: "Dal", meal_guess: null, items: [item], confidence: "high", tip: null }, model: "test" };
    };
    export const estimateUsualDay = async () => ({ data: { meals: [{ name: "Day", kcal: 2200, protein_g: 70, carbs_g: 280, fat_g: 70, fibre_g: 28 }], micros: { iron_mg: 9 }, patterns: [], runs: 3 }, model: "test" });`,
});
const removeDatabase = tempDatabase();

const { and, eq, like } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { person, meal } = await import("./support/app-people.ts");
const { issueCode } = await import("../lib/auth/codes.ts");
const { localDate } = await import("../lib/platform/profile.ts");
const R = async (file: string, method = "POST") => (await import(`../${file}`))[method] as Handler;
const routes = {
  token: await R("app/api/auth/token/route.ts"),
  food: await R("app/api/food/route.ts"),
  again: await R("app/api/food/[id]/again/route.ts"),
  typical: await R("app/api/food/typical/route.ts"),
  upload: await R("app/api/reports/route.ts"),
  signout: await R("app/api/auth/signout/route.ts"),
  remove: await R("app/api/account/delete/route.ts"),
  me: await R("app/api/me/route.ts", "GET"),
};

after(async () => {
  await removeDatabase();
});

let ip = 0;
const headersFor = (token?: string, extra: Record<string, string> = {}) =>
  new Headers({ "x-forwarded-for": `10.5.${Math.floor(++ip / 250) % 250}.${ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra });
async function json(h: Handler, token: string | undefined, body: unknown, params?: Record<string, string>) {
  const headers = headersFor(token, { "content-type": "application/json" });
  const res = await h(new Request("https://www.d-human.fit/api/x", { method: "POST", headers, body: JSON.stringify(body) }), params ? { params: Promise.resolve(params) } : undefined);
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}
async function logMeal(token: string, key = randomUUID().replace(/-/g, "")) {
  const f = new FormData();
  f.append("source", "text");
  f.append("text", "dal and two rotis");
  f.append("key", key);
  const res = await routes.food(new Request("https://www.d-human.fit/api/food", { method: "POST", headers: headersFor(token), body: f }));
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}
const today = () => localDate("Asia/Kolkata");
async function used(userId: string, n: number) {
  const d = await db();
  for (let i = 0; i < n; i++) await d.insert(schema.usage).values({ id: randomUUID(), userId, kind: "meal", refId: randomUUID(), localDate: today() });
}
const count = (xs: { status: number }[], s: number) => xs.filter((x) => x.status === s).length;

describe("sign-in under parallel sends", () => {
  it("one code sent at once with eight different keys signs in once; the rest are refused, not 500", async () => {
    const email = `race-code-${randomUUID()}@example.com`;
    const issued = await issueCode(email);
    assert.ok(issued.ok);
    const out = await Promise.all(Array.from({ length: 8 }, () => json(routes.token, undefined, { email, code: issued.code, key: randomUUID() })));
    assert.equal(count(out, 200), 1, JSON.stringify(out.map((o) => [o.status, o.body?.error])));
    assert.equal(out.filter((o) => o.status >= 500).length, 0);
    const d = await db();
    const [u] = await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    assert.equal((await d.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id))).length, 1);
    assert.equal((await d.select().from(schema.users).where(eq(schema.users.email, email))).length, 1, "one account");
  });

  it("one key sent ten times at once: one session, every answer the same token", async () => {
    const email = `race-key-${randomUUID()}@example.com`;
    const issued = await issueCode(email);
    assert.ok(issued.ok);
    const key = randomUUID();
    const out = await Promise.all(Array.from({ length: 10 }, () => json(routes.token, undefined, { email, code: issued.code, key })));
    assert.equal(count(out, 200), 10, JSON.stringify(out.map((o) => [o.status, o.body?.error])));
    assert.equal(new Set(out.map((o) => o.body!.token)).size, 1);
    const d = await db();
    const [u] = await d.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    assert.equal((await d.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id))).length, 1);
  });
});

describe("the 5 a day under parallel meals and Log again", () => {
  it("at 3 of 5, eight meals and eight Log agains at once with new keys: exactly two get through", async () => {
    const p = await person(`race-five-${randomUUID()}@example.com`);
    const source = await meal(p, { daysAgo: 1 });
    await used(p.id, 3);
    const out = await Promise.all([
      ...Array.from({ length: 8 }, () => logMeal(p.token)),
      ...Array.from({ length: 8 }, () => json(routes.again, p.token, { key: randomUUID().replace(/-/g, "") }, { id: source })),
    ]);
    assert.equal(count(out, 200), 2, JSON.stringify(out.map((o) => [o.status, o.body?.error ?? o.body?.refusal])));
    assert.equal(count(out, 402), 14);
    const d = await db();
    const uses = await d.select().from(schema.usage).where(and(eq(schema.usage.userId, p.id), eq(schema.usage.localDate, today())));
    assert.equal(uses.length, 5);
    const logs = await d.select().from(schema.foodLogs).where(and(eq(schema.foodLogs.userId, p.id), eq(schema.foodLogs.localDate, today())));
    assert.equal(logs.length, 2);
  });

  it("one meal key sent twelve times at once: one meal, one use, at most one AI read", async () => {
    const p = await person(`race-key-meal-${randomUUID()}@example.com`);
    const key = randomUUID().replace(/-/g, "");
    const readsBefore = g.__reads;
    const out = await Promise.all(Array.from({ length: 12 }, () => logMeal(p.token, key)));
    assert.equal(out.filter((o) => o.status >= 500).length, 0);
    assert.ok(out.every((o) => o.status === 200 || (o.status === 409 && o.body?.error === "in_progress")), JSON.stringify(out.map((o) => o.status)));
    const d = await db();
    assert.equal((await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id))).length, 1);
    assert.equal((await d.select().from(schema.usage).where(eq(schema.usage.userId, p.id))).length, 1);
    assert.equal(g.__reads - readsBefore, 1);
  });
});

describe("uploads under parallel sends", () => {
  it("one key ten times at once: one report, one read claimed", async () => {
    const p = await person(`race-upload-${randomUUID()}@example.com`);
    const key = randomUUID();
    const send = () => {
      const f = new FormData();
      f.append("files", new File([Buffer.from("%PDF-1.4\n%%EOF\n")], "r.pdf"));
      f.append("key", key);
      return routes.upload(new Request("https://www.d-human.fit/api/reports", { method: "POST", headers: headersFor(p.token, { prefer: "respond-async" }), body: f })).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));
    };
    const out = await Promise.all(Array.from({ length: 10 }, send));
    assert.ok(out.every((o) => o.status === 202), JSON.stringify(out.map((o) => [o.status, o.body.error])));
    assert.equal(new Set(out.map((o) => o.body.reportId)).size, 1);
    g.__after.splice(0);
    const d = await db();
    assert.equal((await d.select().from(schema.reports).where(eq(schema.reports.userId, p.id))).length, 1);
    assert.equal((await d.select().from(schema.usage).where(and(eq(schema.usage.userId, p.id), eq(schema.usage.kind, "read")))).length, 1);
  });
});

describe("the apps' cost caps under parallel saves", () => {
  it("usual days: ten different saves at once at 0 of 5 make exactly five AI reads", async () => {
    const p = await person(`race-usual-${randomUUID()}@example.com`);
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => json(routes.typical, p.token, { description: `Poha at 8, dal rice at 1, roti sabzi at 8, version ${i}` })));
    assert.equal(count(out, 200), 5, JSON.stringify(out.map((o) => o.status)));
    assert.equal(count(out, 429), 5);
  });

  it("the daily breaker at APP_AI_DAILY_MAX=3: twelve people at once get exactly three; the founders hear once", async () => {
    const before = process.env.APP_AI_DAILY_MAX;
    // A fresh day's breaker: clear any count other tests in this file left.
    const d = await db();
    await d.delete(schema.appRateCounts).where(eq(schema.appRateCounts.subject, "app-ai"));
    await d.delete(schema.jobRuns).where(like(schema.jobRuns.job, "alert:app-ai-cap:%"));
    process.env.APP_AI_DAILY_MAX = "3";
    g.__alerts = 0;
    try {
      const people = await Promise.all(Array.from({ length: 12 }, () => person(`race-breaker-${randomUUID()}@example.com`)));
      const out = await Promise.all(people.map((p) => json(routes.typical, p.token, { description: "Poha at 8, dal rice at 1, roti sabzi at 8" })));
      assert.equal(count(out, 200), 3, JSON.stringify(out.map((o) => [o.status, o.body?.error])));
      assert.equal(out.filter((o) => o.status === 429 && o.body?.error === "paused").length, 9);
      assert.equal(g.__alerts, 1, "one alert a day");
    } finally {
      if (before === undefined) delete process.env.APP_AI_DAILY_MAX;
      else process.env.APP_AI_DAILY_MAX = before;
    }
  });
});

describe("a session ending while a request is in flight", () => {
  it("sign-out while a meal is read: the meal is logged once, the token is dead after, nothing 500s", async () => {
    const p = await person(`race-signout-${randomUUID()}@example.com`);
    let open!: () => void;
    g.__gate = new Promise<void>((r) => (open = r));
    try {
      const inFlight = logMeal(p.token);
      while (g.__reads === 0 || !(await reading(p.id))) await new Promise((r) => setTimeout(r, 5));
      const out = await json(routes.signout, p.token, {});
      assert.equal(out.status, 200);
      open();
      const m = await inFlight;
      assert.equal(m.status, 200, JSON.stringify(m.body));
      // The after() that slides the expiry runs on a session that's gone: no throw, nothing comes back.
      for (const fn of g.__after.splice(0)) await fn();
      const me = await routes.me(new Request("https://www.d-human.fit/api/me", { headers: headersFor(p.token) }));
      assert.equal(me.status, 401);
      const d = await db();
      assert.equal((await d.select().from(schema.sessions).where(and(eq(schema.sessions.userId, p.id), eq(schema.sessions.kind, "bearer")))).length, 0);
    } finally {
      g.__gate = undefined;
    }
  });

  it("the account deleted while a meal is read: no meal and no use are left, and the app is told it's signed out, not 500", async () => {
    const p = await person(`race-delete-${randomUUID()}@example.com`);
    let open!: () => void;
    g.__gate = new Promise<void>((r) => (open = r));
    try {
      const inFlight = logMeal(p.token);
      while (!(await reading(p.id))) await new Promise((r) => setTimeout(r, 5));
      const out = await json(routes.remove, p.token, { confirm: "DELETE" });
      assert.equal(out.status, 200, JSON.stringify(out.body));
      open();
      const m = await inFlight;
      assert.equal(m.status, 401, `the meal's answer: ${m.status} ${JSON.stringify(m.body)}`);
      g.__after.splice(0);
      const d = await db();
      assert.equal((await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id))).length, 0);
      assert.equal((await d.select().from(schema.usage).where(eq(schema.usage.userId, p.id))).length, 0);
    } finally {
      g.__gate = undefined;
    }
  });
});

/** Whether this person's meal claim is in the ledger yet (the request is past its claim, into the read). */
async function reading(userId: string) {
  const d = await db();
  return (await d.select({ id: schema.usage.id }).from(schema.usage).where(eq(schema.usage.userId, userId)).limit(1)).length > 0;
}
