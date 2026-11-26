// The apps' Fuel reads against a real database (PGlite, or Postgres with TEST_DATABASE_URL):
// GET /api/fuel, /api/fuel/past and /api/fuel/facts. Each is checked against the web's own
// loaders (the page's old sequence of queries, mealHistory, foodFactsFor), parses strictly
// against the contract, answers 304 to its own ETag, and holds nothing of another person's.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, keysOf, meal, person, type Handler } from "./support/app-people.ts";

const g = globalThis as unknown as { __after: (() => unknown)[] };
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
delete process.env.ANTHROPIC_API_KEY;

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { dietPicture, logsBetween, mealHistory, totalsOf } = await import("../lib/platform/food.ts");
const { currentPlan } = await import("../lib/platform/plan-state.ts");
const { getProfile, localDate, personaFor } = await import("../lib/platform/profile.ts");
const { fuelData } = await import("../lib/platform/views/fuel.ts");
const { foodFactsFor } = await import("../lib/domain/food-facts.ts");
const contract = await import("../lib/api/schemas.ts");
const fuel = (await import("../app/api/fuel/route.ts")).GET as Handler;
const past = (await import("../app/api/fuel/past/route.ts")).GET as Handler;
const facts = (await import("../app/api/fuel/facts/route.ts")).GET as Handler;

after(async () => {
  await removeDatabase();
});

describe("GET /api/fuel", () => {
  it("one batch of queries gives what the page's old sequence gave: today's meals, the diet picture, the plan", async () => {
    const p = await person("fuel@example.com");
    for (const daysAgo of [0, 0, 1, 2, 3, 15]) await meal(p, { daysAgo, kcal: 900, minutesAgo: daysAgo * 3 });
    const profile = (await getProfile(p.id))!;
    const data = await fuelData({ user: { id: p.id, email: p.email }, profile });
    const today = localDate(profile.timezone);
    assert.deepEqual(data.logs, await logsBetween(p.id, today, today));
    assert.deepEqual(data.picture, await dietPicture(p.id, profile));
    assert.deepEqual(data.plan.view, await currentPlan(p.id, profile.timezone));

    const r = await call(fuel, { token: p.token });
    assert.equal(r.status, 200);
    const body = contract.FuelResponse.parse(r.body);
    assert.deepEqual(body.meals.map((m) => m.id), data.logs.map((l) => l.id));
    const t = totalsOf(data.logs);
    assert.deepEqual(body.totals, { kcal: t.kcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, fibreG: t.fibreG });
    assert.equal(body.day, today);
    assert.ok(r.text.length < 64 * 1024);
    assert.equal(r.res.headers.get("cache-control"), "private, no-store");
    assert.equal(r.res.headers.get("set-cookie"), null);
  });

  it("the usual day and its 'too light' flag, a stack offered from meals, and a plan with no price words", async () => {
    const p = await person("usual@example.com");
    const d = await db();
    await d.insert(schema.dietBaselines).values({
      userId: p.id,
      description: "Chai and biscuits",
      estimate: { meals: [{ name: "Chai", kcal: 120, protein_g: 3, carbs_g: 15, fat_g: 4, fibre_g: 0 }], micros: {}, patterns: ["Mostly tea."] },
    });
    const short = contract.FuelResponse.parse((await call(fuel, { token: p.token })).body);
    assert.deepEqual(short.usualDay, { description: "Chai and biscuits", patterns: ["Mostly tea."], short: true });
    assert.equal(short.stackReady, false);
    assert.equal(short.gapSource, "none");
    for (const daysAgo of [1, 2, 3]) for (const minutesAgo of [0, 300]) await meal(p, { daysAgo, kcal: 1100, minutesAgo });
    const full = contract.FuelResponse.parse((await call(fuel, { token: p.token })).body);
    assert.deepEqual([full.gapSource, full.stackReady], ["logs", true]);
    assert.ok(full.gaps.length <= 4 && full.gaps.every((g) => g.label !== "Vitamin D"));
    const plan = JSON.stringify(full.plan);
    assert.ok(!plan.includes("₹") && !plan.includes("30 days"), plan);
  });

  it("refuses without a valid token, with a page's Origin, and before onboarding; a web cookie gets 403 bearer_required", async () => {
    const p = await person("refuse@example.com");
    for (const h of [fuel, past, facts]) {
      assert.equal((await call(h)).status, 401);
      assert.equal((await call(h, { token: p.token, origin: "https://www.d-human.fit" })).status, 401);
      assert.deepEqual((await call(h, { cookie: p.cookie })).body, { error: "bearer_required" });
    }
    const fresh = await person("notyet@example.com", { name: null }, false);
    for (const h of [fuel, past, facts]) assert.deepEqual((await call(h, { token: fresh.token })).body, { error: "not_onboarded", message: "Finish setting up first." });
  });

  it("answers 304 to its own ETag, and a new one after a meal", async () => {
    const p = await person("etag@example.com");
    for (const h of [fuel, past, facts]) {
      const first = await call(h, { token: p.token });
      const etag = first.res.headers.get("etag")!;
      const again = await call(h, { token: p.token, etag });
      assert.deepEqual([again.status, again.text, again.res.headers.get("cache-control")], [304, "", "private, no-store"]);
    }
    const before = (await call(fuel, { token: p.token })).res.headers.get("etag")!;
    await meal(p);
    assert.equal((await call(fuel, { token: p.token, etag: before })).status, 200);
  });

  it("26, 28: nothing of another person's, no medicines or conditions, no row ids", async () => {
    const a = await person("fuel-canary-a@example.com", { medications: "CANARY_MED", conditions: ["pregnant"] });
    await meal(a, { title: "CANARY_A_MEAL" });
    await meal(a, { title: "CANARY_A_PAST", daysAgo: 1 });
    const b = await person("fuel-canary-b@example.com");
    await meal(b);
    for (const h of [fuel, past, facts]) {
      const r = await call(h, { token: b.token });
      assert.ok(!r.text.includes("CANARY") && !r.text.includes(a.id) && !r.text.includes(b.id), r.text.slice(0, 200));
      for (const k of ["userId", "user_id", "inputText", "model", "medications", "conditions"]) assert.ok(!keysOf(r.body).includes(k), k);
    }
    const mine = await call(fuel, { token: a.token });
    assert.ok(mine.text.includes("CANARY_A_MEAL") && !mine.text.includes("CANARY_MED") && !mine.text.includes("pregnant"));
  });
});

describe("GET /api/fuel/past", () => {
  it("is the web's mealHistory: the same days, labels, meals, order and times, with each meal's moment", async () => {
    const p = await person("past@example.com");
    for (const daysAgo of [0, 1, 1, 3, 27, 28, 29]) await meal(p, { daysAgo, title: `Day ${daysAgo}`, minutesAgo: 1 });
    const web = await mealHistory(p.id, "Asia/Kolkata");
    const r = await call(past, { token: p.token });
    const body = contract.PastMealsResponse.parse(r.body);
    assert.deepEqual(
      body.days.map((d) => [d.date, d.meals.map((m) => [m.id, m.title, m.time])]),
      web.days.map((d) => [d.date, d.meals.map((m) => [m.id, m.title, m.time])]),
    );
    assert.equal(body.days[0].label, "Yesterday");
    assert.ok(!body.days.some((d) => d.date === body.day), "today isn't in the past");
    assert.equal(body.days.length, 4, "yesterday, 3, 27 and 28 days ago; 29 is beyond the 28 days");
    const d = await db();
    const [row] = await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.id, body.days[0].meals[0].id));
    assert.equal(body.days[0].meals[0].at, row.createdAt.toISOString());
  });
});

describe("GET /api/fuel/facts", () => {
  it("is foodFactsFor for this person's bands, the same as Fuel's page picks", async () => {
    const p = await person("facts@example.com", { birthYear: 2001, heightCm: 172, weightKg: 68, sex: "male", diet: "nonveg" });
    const profile = (await getProfile(p.id))!;
    const persona = personaFor(profile);
    const r = await call(facts, { token: p.token });
    assert.deepEqual(contract.FactsResponse.parse(r.body), foodFactsFor({ age: persona.age, heightCm: 172, weightKg: 68, sex: "male", diet: "nonveg" }));
  });
});
