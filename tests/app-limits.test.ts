// The apps' cost guards (QA's review of lane 1A, finding 1), against a real database: an app's
// profile saves can set off at most 3 paid event searches a week after onboarding, its usual-day
// saves at most 5 a day, and all of them together pass a daily breaker that tells the founders
// once. Web cookie requests are counted by none of it.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, person, type Handler, type Person } from "./support/app-people.ts";

type G = { __after: (() => unknown)[]; __testUser?: { id: string; email: string } | null; __alerts: string[] };
const g = globalThis as unknown as G;
g.__after = [];
g.__alerts = [];
allowAppImports({
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "@/lib/email/jobs": "export const sendWelcome = async () => {};",
  "@/lib/sheets/users": "export const pushUserRow = async () => {};",
  "@/lib/email/send": "export const sendFounderAlert = async (a) => { globalThis.__alerts.push(a.subject); return { status: 'sent' }; };",
  "@/lib/platform/events": "export const ensureEvents = async () => {};",
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "live";`,
  "@/lib/ai/food": `
    export const estimateMeal = async () => { throw new Error("not in these tests"); };
    export const estimateUsualDay = async () => ({ data: { meals: [{ name: "Day", kcal: 2200, protein_g: 70, carbs_g: 280, fat_g: 70, fibre_g: 28 }], micros: {}, patterns: [], runs: 3 }, model: "test" });`,
});
const removeDatabase = tempDatabase();

const { eq, like } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { claimUsualDay, istWeekStart } = await import("../lib/api/app-limits.ts");
const profileRoute = (await import("../app/api/profile/route.ts")).POST as Handler;
const typical = (await import("../app/api/food/typical/route.ts")).POST as Handler;

after(async () => {
  await removeDatabase();
});
beforeEach(() => {
  g.__testUser = null;
  delete process.env.APP_AI_DAILY_MAX;
});

const counts = async (subject: string) => {
  const d = await db();
  return (await d.select().from(schema.appRateCounts).where(like(schema.appRateCounts.subject, subject))).reduce((n, r) => n + r.count, 0);
};
const profileOf = async (p: Person) => (await (await db()).select().from(schema.profiles).where(eq(schema.profiles.userId, p.id)))[0];

describe("event searches set off by an app's profile saves", () => {
  it("3 a week after onboarding; the 4th change is refused with Retry-After and not saved; other fields aren't counted", async () => {
    const p = await person("events-cap@example.com");
    for (const city of ["Pune", "Nagpur", "Bhopal"]) assert.equal((await call(profileRoute, { token: p.token, body: { city } })).status, 200, city);
    assert.equal((await call(profileRoute, { token: p.token, body: { name: "Asha K", diet: "vegan" } })).status, 200, "no search depends on these");
    const r = await call(profileRoute, { token: p.token, body: { eventInMind: "Mumbai Marathon" } });
    assert.deepEqual([r.status, r.body!.error], [429, "rate_limited"]);
    const wait = Number(r.res.headers.get("retry-after"));
    assert.ok(wait > 0 && wait <= 7 * 86_400, String(wait));
    assert.equal((await profileOf(p)).eventInMind, null, "nothing saved");
    assert.equal((await profileOf(p)).city, "Bhopal");
    assert.equal(await counts(`events:${p.id}`), 3);
  });

  it("onboarding's own search and the web's saves are never counted", async () => {
    const p = await person("events-onboard@example.com", { onboardedAt: null });
    assert.equal((await call(profileRoute, { token: p.token, body: { city: "Agra", complete: true } })).status, 200);
    assert.equal(await counts(`events:${p.id}`), 0);
    const w = await person("events-web@example.com");
    g.__testUser = { id: w.id, email: w.email };
    const breakerBefore = await counts("app-ai");
    for (const city of ["A1", "B2", "C3", "D4", "E5"]) assert.deepEqual((await call(profileRoute, { body: { city } })).body, { status: "saved" });
    assert.equal(await counts(`events:${w.id}`), 0);
    assert.equal(await counts("app-ai"), breakerBefore, "nothing of the web's reaches the breaker");
  });

  it("the week starts on Monday, IST", () => {
    assert.equal(istWeekStart(new Date("2026-11-26T10:00:00Z")), "2026-11-23");
    assert.equal(istWeekStart(new Date("2026-11-29T19:00:00Z")), "2026-11-30", "Sunday 19:00 UTC is Monday 00:30 IST");
  });
});

describe("usual-day saves from an app", () => {
  it("5 a day; a resend of the same words isn't counted; the web's aren't either", async () => {
    const p = await person("usual-cap@example.com");
    const save = (n: number) => call(typical, { token: p.token, body: { description: `Poha, dal chawal, roti sabzi, day number ${n}` } });
    for (let i = 0; i < 5; i++) assert.equal((await save(i)).status, 200, String(i));
    assert.equal((await call(typical, { token: p.token, body: { description: "Poha, dal chawal, roti sabzi, day number 4" } })).status, 200, "the words just saved: read back, not counted");
    const r = await save(9);
    assert.deepEqual([r.status, r.body!.error], [429, "rate_limited"]);
    assert.ok(Number(r.res.headers.get("retry-after")) > 0);
    assert.equal(await counts(`usual:${p.id}`), 5);
    g.__testUser = { id: p.id, email: p.email };
    assert.equal((await call(typical, { body: { description: "Idli, rajma chawal, roti and dal" } })).status, 200, "the web keeps today's behaviour");
  });

  it("parallel saves can't pass the cap", async () => {
    const p = await person("usual-parallel@example.com");
    const results = await Promise.all(Array.from({ length: 12 }, () => claimUsualDay(p.id)));
    assert.equal(results.filter((x) => x === null).length, 5);
  });
});

describe("the apps' daily breaker", () => {
  it("past APP_AI_DAILY_MAX, app requests that would set off a paid call get 429 paused; the founders hear once", async () => {
    const d = await db();
    await d.delete(schema.appRateCounts).where(eq(schema.appRateCounts.subject, "app-ai"));
    process.env.APP_AI_DAILY_MAX = "2";
    g.__alerts = [];
    const p = await person("breaker@example.com");
    const q = await person("breaker-2@example.com");
    assert.equal((await call(typical, { token: p.token, body: { description: "Upma, chole, khichdi, curd" } })).status, 200);
    assert.equal((await call(profileRoute, { token: q.token, body: { city: "Surat" } })).status, 200);
    const r = await call(typical, { token: q.token, body: { description: "Paratha, dal makhani, rice, salad" } });
    assert.deepEqual([r.status, r.body!.error], [429, "paused"]);
    assert.equal((await call(profileRoute, { token: p.token, body: { city: "Vadodara" } })).status, 429);
    assert.equal(g.__alerts.length, 1, "once a day, however many are refused");
    assert.match(g.__alerts[0], /apps reached today's limit/);
  });
});
