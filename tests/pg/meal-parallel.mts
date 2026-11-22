// Meals sent twice, under real parallel load on a real Postgres (opt-in; not part of npm test).
// PGlite runs one query at a time, so only a real server can prove that the advisory lock, the
// usage ledger's unique (kind, ref_id) index and food_logs' primary key hold when sends of one
// try really overlap. This drives the meal route itself (app/api/food/route.ts) through the
// app's own pool (lib/db, 5 connections), with Claude stubbed to take 300 ms:
//   1. one person, one try sent 20 times at once: one meal, one use, one AI call, 20 answers with it;
//   2. 30 people, each sending their try 4 times at once: 30 meals, 30 uses, 30 AI calls;
//   3. one person, 12 different meals at once: exactly 5 logged (the daily limit), 7 refused;
//   4. one try sent 10 times at once whose first AI call fails: one meal, one use;
//   5. 40 people sending the same key: each gets a meal of their own, never another's.
//
//   TEST_DATABASE_URL=postgres://user:pass@host:5432/db node tests/pg/meal-parallel.mts
// Without TEST_DATABASE_URL it says so and exits 0. It migrates the database, then removes only its own rows.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowAppImports } from "../support/app.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("skipped: set TEST_DATABASE_URL to a Postgres you can write to");
  process.exit(0);
}
type G = { __testUser?: { id: string; email: string } | null; __calls: number; __fails: number };
const g = globalThis as unknown as G;
g.__calls = 0;
g.__fails = 0;
allowAppImports({
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "live";`,
  "@/lib/ai/food": `
    export const estimateMeal = async (input) => {
      globalThis.__calls++;
      await new Promise((r) => setTimeout(r, 300));
      if (globalThis.__fails > 0) { globalThis.__fails--; throw new Error("AI hiccup"); }
      const item = { name: "Idli", portion: "2", grams: null, kcal: 120, protein_g: 4, carbs_g: 24, fat_g: 1, fibre_g: 2 };
      return { data: { is_food: true, reply_language: input.words.reply.id, title: input.words.said, meal_guess: null, items: [item], confidence: "high", tip: null }, model: "test" };
    };
    export const estimateUsualDay = () => { throw new Error("AI in a test"); }; export const estimateTypicalDay = estimateUsualDay;`,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "@/lib/billing/razorpay": `export const paymentsOn = () => false; export const keyMode = () => "test";`,
});
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.VERCEL;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { default: postgres } = await import("postgres");
const { drizzle } = await import("drizzle-orm/postgres-js");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
await migrate(drizzle(admin), { migrationsFolder: path.join(root, "drizzle") });
console.log(`server: ${(await admin`select version()`)[0].version.split(" ").slice(0, 2).join(" ")}`);

const { and, eq, like } = await import("drizzle-orm");
const { db, schema } = await import("../../lib/db/index.ts");
const { POST: foodRoute } = await import("../../app/api/food/route.ts");
const { mealIdFor } = await import("../../lib/platform/food.ts");

const run = crypto.randomUUID().slice(0, 8);
const d = await db();
let n = 0;
async function people(count: number) {
  const ids = Array.from({ length: count }, () => `meal-par-${run}-${++n}`);
  await d.insert(schema.users).values(ids.map((id) => ({ id, email: `${id}@example.test` })));
  await d.insert(schema.profiles).values(ids.map((userId) => ({ userId, language: "en", onboardedAt: new Date() })));
  return ids.map((id) => ({ id, email: `${id}@example.test` }));
}
async function send(user: { id: string; email: string }, key: string, text = "2 idli") {
  const form = new FormData();
  form.append("source", "text");
  form.append("text", text);
  form.append("key", key);
  g.__testUser = user;
  const pending = foodRoute(new Request("http://localhost/api/food", { method: "POST", body: form }));
  g.__testUser = null;
  const res = await pending;
  return { status: res.status, body: (await res.json()) as { log?: { id: string; userId: string }; repeat?: boolean } };
}
async function counts(userId: string) {
  const [meals, uses] = await Promise.all([
    d.select({ id: schema.foodLogs.id }).from(schema.foodLogs).where(eq(schema.foodLogs.userId, userId)),
    d.select({ id: schema.usage.id }).from(schema.usage).where(and(eq(schema.usage.userId, userId), eq(schema.usage.kind, "meal"))),
  ]);
  return { meals: meals.length, uses: uses.length };
}
const tally = (rs: { status: number }[]) => rs.reduce<Record<number, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
const quiet = console.error;

try {
  // 1.
  {
    const [p] = await people(1);
    const k = crypto.randomUUID();
    const calls = g.__calls;
    const rs = await Promise.all(Array.from({ length: 20 }, () => send(p, k)));
    assert.deepEqual(tally(rs), { 200: 20 });
    assert.ok(rs.every((r) => r.body.log?.id === mealIdFor(p.id, k)));
    assert.equal(rs.filter((r) => !r.body.repeat).length, 1);
    assert.equal(g.__calls - calls, 1);
    assert.deepEqual(await counts(p.id), { meals: 1, uses: 1 });
    console.log("ok  1. one try sent 20 times at once: 1 meal, 1 use, 1 AI call, 20 answers with that meal");
  }
  // 2.
  {
    const ps = await people(30);
    const calls = g.__calls;
    const rs = await Promise.all(ps.flatMap((p) => { const k = crypto.randomUUID(); return Array.from({ length: 4 }, () => send(p, k)); }));
    assert.deepEqual(tally(rs), { 200: 120 });
    assert.equal(g.__calls - calls, 30);
    for (const p of ps) assert.deepEqual(await counts(p.id), { meals: 1, uses: 1 });
    console.log("ok  2. 30 people sending their try 4 times at once: 30 meals, 30 uses, 30 AI calls");
  }
  // 3.
  {
    const [p] = await people(1);
    const rs = await Promise.all(Array.from({ length: 12 }, () => send(p, crypto.randomUUID())));
    assert.deepEqual(tally(rs), { 200: 5, 402: 7 });
    assert.deepEqual(await counts(p.id), { meals: 5, uses: 5 });
    console.log("ok  3. 12 different meals at once: 5 logged (the daily limit), 7 refused, 5 uses");
  }
  // 4.
  {
    const [p] = await people(1);
    const k = crypto.randomUUID();
    g.__fails = 1;
    console.error = () => {};
    const rs = await Promise.all(Array.from({ length: 10 }, () => send(p, k)));
    console.error = quiet;
    g.__fails = 0;
    const ok = rs.filter((r) => r.status === 200);
    assert.ok(ok.length >= 1 && ok.every((r) => r.body.log?.id === mealIdFor(p.id, k)), JSON.stringify(tally(rs)));
    assert.deepEqual(await counts(p.id), { meals: 1, uses: 1 });
    console.log(`ok  4. one try sent 10 times at once, first AI call failing: 1 meal, 1 use (${JSON.stringify(tally(rs))})`);
  }
  // 5.
  {
    const ps = await people(40);
    const k = crypto.randomUUID();
    const rs = await Promise.all(ps.map((p) => send(p, k)));
    assert.deepEqual(tally(rs), { 200: 40 });
    assert.equal(new Set(rs.map((r) => r.body.log?.id)).size, 40);
    rs.forEach((r, i) => assert.equal(r.body.log?.userId, ps[i].id));
    for (const p of ps) assert.deepEqual(await counts(p.id), { meals: 1, uses: 1 });
    console.log("ok  5. 40 people sending the same key: 40 meals, each their own");
  }
} finally {
  console.error = quiet;
  await d.delete(schema.users).where(like(schema.users.id, `meal-par-${run}-%`));
  await admin.end();
  await (d as unknown as { $client: { end(): Promise<void> } }).$client.end();
}
