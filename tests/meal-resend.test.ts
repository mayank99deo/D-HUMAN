// A meal sent twice is logged once. iPhone's WebKit never resends a POST that died on a quiet
// connection, so Fuel resends it itself, with the try's key (components/platform/net.ts). Here,
// against a real embedded database with Claude stubbed: a repeated key gets the meal its first
// send logged; two sends racing make one meal, one use and one AI call; a first send that failed
// leaves the way open; a dead first send is taken over; another person's key never reaches this
// person's meal; and a usual day sent twice is read once.
//
// PGlite runs one query at a time, so these races interleave between queries, not inside them;
// tests/pg/meal-parallel.mts runs the same races on a real Postgres.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type TestGlobals = {
  __testUser?: { id: string; email: string } | null;
  __mealCalls: number;
  __dayCalls: number;
  __mealDelayMs: number;
  __mealFails: number;
};
const g = globalThis as unknown as TestGlobals;
g.__mealCalls = 0;
g.__dayCalls = 0;
g.__mealDelayMs = 0;
g.__mealFails = 0;

allowAppImports({
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "live";`,
  "@/lib/ai/food": `
    export const estimateMeal = async (input) => {
      globalThis.__mealCalls++;
      if (globalThis.__mealDelayMs) await new Promise((r) => setTimeout(r, globalThis.__mealDelayMs));
      if (globalThis.__mealFails > 0) { globalThis.__mealFails--; throw new Error("AI hiccup"); }
      const item = { name: "Idli", portion: "2", grams: null, kcal: 120, protein_g: 4, carbs_g: 24, fat_g: 1, fibre_g: 2 };
      return { data: { is_food: true, reply_language: input.words.reply.id, title: input.words.said, meal_guess: null, items: [item], confidence: "high", tip: null }, model: "test" };
    };
    const day = { meals: [{ name: "Lunch", kcal: 2400, protein_g: 80, carbs_g: 300, fat_g: 80, fibre_g: 30 }], micros: { iron_mg: 10, calcium_mg: 600, magnesium_mg: 300, zinc_mg: 8, b12_ug: 1, folate_ug: 200, vitamin_c_mg: 50, vitamin_d_iu: 100 }, patterns: ["Rice at lunch."], runs: 3 };
    export const estimateUsualDay = async () => { globalThis.__dayCalls++; return { data: day, model: "test" }; };
    export const estimateTypicalDay = estimateUsualDay;`,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "@/lib/billing/razorpay": `export const paymentsOn = () => false; export const keyMode = () => "test";`,
});
const removeDatabase = tempDatabase();
const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { POST: foodRoute } = await import("../app/api/food/route.ts");
const { POST: typicalRoute } = await import("../app/api/food/typical/route.ts");
const { DELETE: deleteRoute } = await import("../app/api/food/[id]/route.ts");
const { mealIdFor, waitForMeal, MEAL_KEY } = await import("../lib/platform/food.ts");
const { claimMealTry, planView } = await import("../lib/platform/plan.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

let n = 0;
async function person() {
  const d = await db();
  const id = `resend-user-${++n}`;
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  await d.insert(schema.profiles).values({ userId: id, language: "en", onboardedAt: new Date() });
  return { id, email: `${id}@example.com` };
}
const key = () => crypto.randomUUID();
/** Runs `fn` with the route's expected error log muted (the AI hiccups below are on purpose). */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const error = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = error;
  }
}

/** One send to /api/food as `user`. The test user is read before the first await, so racing sends each keep theirs. */
async function send(user: { id: string; email: string }, fields: Record<string, string>) {
  const form = new FormData();
  form.append("source", "text");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  g.__testUser = user;
  const pending = foodRoute(new Request("http://localhost/api/food", { method: "POST", body: form }));
  g.__testUser = null;
  const res = await pending;
  return { status: res.status, body: (await res.json()) as { log?: { id: string; title: string }; repeat?: boolean; error?: string } };
}
async function rows(userId: string) {
  const d = await db();
  const [meals, uses] = await Promise.all([
    d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, userId)),
    d.select().from(schema.usage).where(and(eq(schema.usage.userId, userId), eq(schema.usage.kind, "meal"))),
  ]);
  return { meals, uses };
}

describe("a meal's id from its key", () => {
  it("is a version-8 UUID, the same for the same person and key, and different for anyone else", () => {
    const k = key();
    const a = mealIdFor("user-a", k);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(mealIdFor("user-a", k), a);
    assert.notEqual(mealIdFor("user-b", k), a);
    assert.notEqual(mealIdFor("user-a", key()), a);
    assert.ok(!a.includes(k.slice(0, 8)), "the id doesn't carry the key");
  });

  it("takes browser keys and refuses anything else", () => {
    assert.ok(MEAL_KEY.test(crypto.randomUUID()));
    assert.ok(MEAL_KEY.test("0123456789abcdef0123456789abcdef"));
    for (const bad of ["short", "x".repeat(65), "has space in it here", "semi;colon;semi;colon", "../../../../etc/passwd"]) assert.ok(!MEAL_KEY.test(bad), bad);
  });
});

describe("the meal route with a key", () => {
  it("logs a resent try once: the second send gets the first send's meal, no second AI call, one use", async () => {
    const user = await person();
    const k = key();
    const calls = g.__mealCalls;
    const first = await send(user, { text: "2 idli and sambar", key: k });
    const second = await send(user, { text: "2 idli and sambar", key: k });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.log?.id, first.body.log?.id);
    assert.equal(second.body.repeat, true);
    assert.equal(g.__mealCalls - calls, 1);
    const { meals, uses } = await rows(user.id);
    assert.equal(meals.length, 1);
    assert.equal(uses.length, 1);
    assert.equal(meals[0].id, mealIdFor(user.id, k));
    assert.equal(uses[0].refId, meals[0].id);
    assert.equal((await planView(user.id, null)).meals.today, 1);
  });

  it("logs two sends of one try that race once, and both get that meal", async () => {
    const user = await person();
    const k = key();
    g.__mealDelayMs = 300;
    const calls = g.__mealCalls;
    try {
      const [a, b] = await Promise.all([send(user, { text: "poha", key: k }), send(user, { text: "poha", key: k })]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(a.body.log?.id, b.body.log?.id);
      assert.equal([a, b].filter((r) => r.body.repeat).length, 1, "one of them waited for the other");
    } finally {
      g.__mealDelayMs = 0;
    }
    assert.equal(g.__mealCalls - calls, 1, "one AI call");
    const { meals, uses } = await rows(user.id);
    assert.equal(meals.length, 1);
    assert.equal(uses.length, 1);
  });

  it("five sends of one try at once: one meal, one use, one AI call", async () => {
    const user = await person();
    const k = key();
    g.__mealDelayMs = 200;
    const calls = g.__mealCalls;
    try {
      const all = await Promise.all(Array.from({ length: 5 }, () => send(user, { text: "rajma chawal", key: k })));
      assert.ok(all.every((r) => r.status === 200 && r.body.log?.id === all[0].body.log?.id));
    } finally {
      g.__mealDelayMs = 0;
    }
    assert.equal(g.__mealCalls - calls, 1);
    const { meals, uses } = await rows(user.id);
    assert.deepEqual([meals.length, uses.length], [1, 1]);
  });

  it("tries again after a first send that failed: its use was handed back, so the resend logs and counts it once", async () => {
    const user = await person();
    const k = key();
    g.__mealFails = 1;
    const first = await quietly(() => send(user, { text: "dal chawal", key: k }));
    assert.equal(first.status, 500);
    assert.deepEqual(Object.values(await rows(user.id)).map((r) => r.length), [0, 0], "nothing kept from the failure");
    const second = await send(user, { text: "dal chawal", key: k });
    assert.equal(second.status, 200);
    assert.equal(second.body.repeat, undefined);
    const { meals, uses } = await rows(user.id);
    assert.deepEqual([meals.length, uses.length], [1, 1]);
  });

  it("a resend waiting on a first send that then fails logs the meal itself, once", async () => {
    const user = await person();
    const k = key();
    g.__mealDelayMs = 300;
    g.__mealFails = 1;
    try {
      const [a, b] = await quietly(() => Promise.all([send(user, { text: "chole", key: k }), send(user, { text: "chole", key: k })]));
      assert.deepEqual([a.status, b.status].sort(), [200, 500]);
    } finally {
      g.__mealDelayMs = 0;
      g.__mealFails = 0;
    }
    const { meals, uses } = await rows(user.id);
    assert.deepEqual([meals.length, uses.length], [1, 1]);
  });

  it("takes over a try whose first send died without logging or handing back, and still counts it once", async () => {
    const user = await person();
    const k = key();
    const d = await db();
    // A function killed mid-read: its claim stays, with no meal.
    await d.insert(schema.usage).values({ id: crypto.randomUUID(), userId: user.id, kind: "meal", refId: mealIdFor(user.id, k), localDate: "2026-11-22", createdAt: new Date(Date.now() - 10 * 60_000) });
    const r = await send(user, { text: "upma", key: k });
    assert.equal(r.status, 200);
    assert.equal(r.body.log?.id, mealIdFor(user.id, k));
    const { meals, uses } = await rows(user.id);
    assert.deepEqual([meals.length, uses.length], [1, 1]);
  });

  it("gives a person who reached today's limit the meal they already logged, not the paywall", async () => {
    const user = await person();
    const keys = Array.from({ length: 5 }, key);
    for (const k of keys) assert.equal((await send(user, { text: "chai", key: k })).status, 200);
    const resent = await send(user, { text: "chai", key: keys[4] });
    assert.equal(resent.status, 200);
    assert.equal(resent.body.repeat, true);
    assert.equal((await send(user, { text: "chai", key: key() })).status, 402, "a new meal still meets the limit");
    assert.equal((await rows(user.id)).uses.length, 5);
  });

  it("never hands one person's meal to another, whatever key they send", async () => {
    const owner = await person();
    const other = await person();
    const k = key();
    const mine = await send(owner, { text: "paneer tikka", key: k });
    const theirs = await send(other, { text: "maggi", key: k });
    assert.equal(theirs.status, 200);
    assert.notEqual(theirs.body.log?.id, mine.body.log?.id);
    assert.equal(theirs.body.repeat, undefined);
    assert.equal(theirs.body.log?.title, "maggi");
    // Sending the owner's meal id as a key names a different meal again.
    const byId = await send(other, { text: "maggi", key: mine.body.log!.id });
    assert.notEqual(byId.body.log?.id, mine.body.log?.id);
    const o = await rows(owner.id);
    assert.deepEqual([o.meals.length, o.uses.length, o.meals[0].title], [1, 1, "paneer tikka"]);
    assert.equal((await rows(other.id)).meals.length, 2);
  });

  it("refuses a key that isn't one, and still logs a send with no key (a tab opened before keys)", async () => {
    const user = await person();
    assert.equal((await send(user, { text: "idli", key: "not a key" })).status, 400);
    const a = await send(user, { text: "idli" });
    const b = await send(user, { text: "idli" });
    assert.equal(a.status, 200);
    assert.notEqual(a.body.log?.id, b.body.log?.id, "without a key every send is a new meal, as before");
    assert.equal((await rows(user.id)).meals.length, 2);
  });
});

// QA, 2026-11-22: a deleted meal kept its use under the meal's id, so its key sent again (Try
// again or Log this meal after a delete, or a script) looked like a try still being read: it hung
// 55 s and said "We're still reading this meal", and once the use was 130 s old it was taken over
// as stale and logged the meal again without counting a use. The use now stays counted under an
// id of its own, so the key is a new meal that meets the plan.
describe("a meal's key sent again after the meal was deleted", () => {
  async function remove(user: { id: string; email: string }, id: string) {
    g.__testUser = user;
    const pending = deleteRoute(new Request(`http://localhost/api/food/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) } as never);
    g.__testUser = null;
    return (await pending).status;
  }

  it("is a new meal at once, counted as one: not a wait, not a free re-log", async () => {
    const user = await person();
    const k = key();
    const first = await send(user, { text: "chai and biscuits", key: k });
    assert.equal(first.status, 200);
    assert.equal(await remove(user, first.body.log!.id), 200);
    const before = await rows(user.id);
    assert.deepEqual([before.meals.length, before.uses.length], [0, 1], "the deleted meal's use still counts");
    const started = Date.now();
    const again = await send(user, { text: "chai and biscuits", key: k });
    assert.ok(Date.now() - started < 5_000, `answered in ${Date.now() - started} ms, not after the 55 s wait`);
    assert.equal(again.status, 200);
    assert.equal(again.body.repeat, undefined, "a new meal, not the deleted one");
    const { meals, uses } = await rows(user.id);
    assert.deepEqual([meals.length, uses.length], [1, 2], "one meal now, and both logs count");
    assert.equal((await planView(user.id, null)).meals.today, 2);
  });

  it("meets the day's limit like any new meal", async () => {
    const user = await person();
    const keys = Array.from({ length: 5 }, key);
    const ids: string[] = [];
    for (const k of keys) ids.push((await send(user, { text: "idli", key: k })).body.log!.id);
    assert.equal(await remove(user, ids[0]), 200);
    const again = await send(user, { text: "idli", key: keys[0] });
    assert.equal(again.status, 402, "five logs today already");
    assert.equal((await rows(user.id)).meals.length, 4);
  });

  it("a stale claim with no meal (a killed function) is still taken over and counted once", async () => {
    const user = await person();
    const k = key();
    const d = await db();
    await d.insert(schema.usage).values({ id: crypto.randomUUID(), userId: user.id, kind: "meal", refId: mealIdFor(user.id, k), localDate: "2026-11-22", createdAt: new Date(Date.now() - 10 * 60_000) });
    // Deleting a meal that isn't there (the id of a try still in flight) leaves its claim alone.
    assert.equal(await remove(user, mealIdFor(user.id, k)), 200);
    const r = await send(user, { text: "upma", key: k });
    assert.equal(r.status, 200);
    assert.deepEqual([(await rows(user.id)).meals.length, (await rows(user.id)).uses.length], [1, 1]);
  });

  it("someone else's delete of this person's meal id touches nothing", async () => {
    const owner = await person();
    const other = await person();
    const mine = await send(owner, { text: "dosa", key: key() });
    assert.equal(await remove(other, mine.body.log!.id), 200);
    const o = await rows(owner.id);
    assert.deepEqual([o.meals.length, o.uses.length, o.uses[0].refId], [1, 1, mine.body.log!.id]);
  });
});

describe("waiting for a try", () => {
  it("says busy when the first send is still reading past the wait, and never touches the claim", async () => {
    const user = await person();
    const id = mealIdFor(user.id, key());
    assert.equal((await claimMealTry(user.id, id, "2026-11-22")).status, "fresh");
    const seen = await waitForMeal(user.id, id, { waitMs: 250, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))) });
    assert.deepEqual(seen, { state: "busy" });
    assert.equal((await claimMealTry(user.id, id, "2026-11-22")).status, "held");
    assert.equal((await rows(user.id)).uses.length, 1);
  });

  it("doesn't see another person's claim or meal under an id", async () => {
    const owner = await person();
    const other = await person();
    const r = await send(owner, { text: "dosa", key: key() });
    const id = r.body.log!.id;
    assert.deepEqual(await waitForMeal(other.id, id, { waitMs: 50 }), { state: "released" });
  });
});

describe("the usual day sent twice", () => {
  it("reads the same words once when they were saved moments ago, and again for new words", async () => {
    const user = await person();
    const post = async (description: string) => {
      g.__testUser = user;
      const pending = typicalRoute(new Request("http://localhost/api/food/typical", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description }) }));
      g.__testUser = null;
      const res = await pending;
      return { status: res.status, body: (await res.json()) as { day?: { patterns: string[] } } };
    };
    const calls = g.__dayCalls;
    const words = "Chai at 7. Poha at 9. Office lunch: 3 rotis, dal, sabzi. Dinner rice, dal, curd.";
    const a = await post(words);
    const b = await post(words);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(b.body.day?.patterns, a.body.day?.patterns);
    assert.equal(g.__dayCalls - calls, 1, "the resend didn't read it again");
    assert.equal((await post(`${words} Fruit at 5.`)).status, 200);
    assert.equal(g.__dayCalls - calls, 2, "new words are read");
  });
});
