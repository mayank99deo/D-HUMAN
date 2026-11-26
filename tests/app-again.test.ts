// "Log again" for the apps, against a real database: POST /api/food/[id]/again copies one of the
// person's own recent meals with no AI call, counts it as a meal log, and logs one meal however
// many times the same try is sent. Plus the refusals: not theirs or too old (404), the plan
// (402), the web (403), old consent (409), and bad input (400).
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, meal, person, type Handler, type Person } from "./support/app-people.ts";

const g = globalThis as unknown as { __after: (() => unknown)[]; __testUser?: unknown };
g.__after = [];
allowAppImports({
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/ai/food": `export const estimateMeal = async () => { throw new Error("Log again must never call the AI"); }; export const estimateUsualDay = estimateMeal;`,
  "@/lib/billing/razorpay": `export const paymentsOn = () => false; export const keyMode = () => "test";`,
});
const removeDatabase = tempDatabase();

const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { localDate } = await import("../lib/platform/profile.ts");
const contract = await import("../lib/api/schemas.ts");
const again = (await import("../app/api/food/[id]/again/route.ts")).POST as Handler;
const slot = (await import("../app/api/food/[id]/slot/route.ts")).POST as Handler;

after(async () => {
  await removeDatabase();
});

let n = 0;
const key = () => `again-key-${String(++n).padStart(8, "0")}`;
const send = (p: Person, id: string, body: Record<string, unknown>) => call(again, { token: p.token, body, params: { id } });
const meals = async (p: Person) => {
  const d = await db();
  return d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id));
};
const uses = async (p: Person) => {
  const d = await db();
  return d.select().from(schema.usage).where(and(eq(schema.usage.userId, p.id), eq(schema.usage.kind, "meal")));
};

describe("POST /api/food/[id]/again", () => {
  it("copies the meal's words and numbers with no AI call, as a new meal today that counts once", async () => {
    const p = await person("again@example.com");
    const source = await meal(p, { title: "Poha with peanuts", daysAgo: 1, slot: "breakfast", kcal: 310, proteinG: 8, micros: { iron_mg: 2.5, tip: "Add curd.", lang: "en" }, model: "claude-haiku" });
    const r = await send(p, source, { key: key() });
    assert.equal(r.status, 200);
    const body = contract.AppMealAnswer.parse(r.body);
    assert.notEqual(body.meal.id, source);
    assert.deepEqual([body.meal.title, body.meal.meal, body.meal.kcal, body.meal.proteinG, body.meal.tip, body.meal.demo], ["Poha with peanuts", "breakfast", 310, 8, "Add curd.", false]);
    assert.equal(body.repeat, undefined);
    const rows = await meals(p);
    const copy = rows.find((m) => m.id === body.meal.id)!;
    assert.deepEqual([copy.repeatOf, copy.localDate, copy.micros], [source, localDate("Asia/Kolkata"), { iron_mg: 2.5, tip: "Add curd.", lang: "en" }]);
    assert.deepEqual((await uses(p)).map((u) => [u.refId, u.localDate]), [[body.meal.id, localDate("Asia/Kolkata")]]);
    assert.equal(r.res.headers.get("cache-control"), "private, no-store");
  });

  it("the same try sent again, even at once, makes one meal and one use, and answers with it", async () => {
    const p = await person("again-twice@example.com");
    const source = await meal(p);
    const k = key();
    const [a, b, c] = await Promise.all([send(p, source, { key: k }), send(p, source, { key: k }), send(p, source, { key: k })]);
    const ids = [a, b, c].map((r) => (r.body!.meal as { id: string }).id);
    assert.equal(new Set(ids).size, 1);
    assert.equal([a, b, c].filter((r) => r.body!.repeat === true).length, 2);
    assert.equal((await meals(p)).length, 2, "the source and one copy");
    assert.equal((await uses(p)).length, 1);
  });

  it("a queued repeat counts on the day it was eaten; a chosen slot wins over the source's", async () => {
    const p = await person("again-queued@example.com");
    const source = await meal(p, { slot: "lunch" });
    const eaten = new Date(Date.now() - 26 * 3_600_000);
    const r = await send(p, source, { key: key(), eatenAt: eaten.toISOString(), meal: "dinner" });
    const body = contract.AppMealAnswer.parse(r.body);
    assert.deepEqual([body.meal.meal, body.meal.at], ["dinner", eaten.toISOString()]);
    assert.equal((await meals(p)).find((m) => m.id === body.meal.id)!.localDate, localDate("Asia/Kolkata", eaten));
    for (const at of [new Date(Date.now() - 50 * 3_600_000).toISOString(), "tomorrow"]) {
      const bad = await send(p, source, { key: key(), eatenAt: at });
      assert.equal(bad.status, 400, at);
    }
  });

  it("404 for someone else's meal, one older than 28 days, or none; nothing logged or counted", async () => {
    const p = await person("again-404@example.com");
    const other = await person("again-404-other@example.com");
    const theirs = await meal(other);
    const old = await meal(p, { daysAgo: 29 });
    for (const id of [theirs, old, "no-such-meal"]) {
      const r = await send(p, id, { key: key() });
      assert.deepEqual([r.status, r.body!.error], [404, "not_found"]);
      assert.ok(String(r.body!.message).length > 0);
    }
    assert.equal((await meals(p)).length, 1);
    assert.equal((await uses(p)).length, 0);
    assert.equal((await meals(other)).length, 1);
  });

  it("counts against the plan: at 5 today it's 402 in price-free words", async () => {
    const p = await person("again-limit@example.com");
    const source = await meal(p);
    for (let i = 0; i < 5; i++) assert.equal((await send(p, source, { key: key() })).status, 200);
    const r = await send(p, source, { key: key() });
    assert.deepEqual([r.status, r.body!.error, r.body!.refusal], [402, "plan_limit", "meals_today_used"]);
    assert.ok(!/₹|\bfree\b/i.test(String(r.body!.message)));
  });

  it("only for the apps, only with a key, and asks for consent again when it's old", async () => {
    const p = await person("again-refuse@example.com");
    const source = await meal(p);
    const web = await call(again, { cookie: p.cookie, body: { key: key() }, params: { id: source } });
    assert.deepEqual([web.status, web.body!.error], [403, "bearer_required"]);
    assert.equal((await call(again, { token: "dht_nope", body: { key: key() }, params: { id: source } })).status, 401);
    assert.equal((await send(p, source, {})).status, 400);
    assert.equal((await send(p, source, { key: "short" })).status, 400);
    const old = await person("again-old-consent@example.com", { consentAt: new Date("2026-11-02T00:00:00Z") });
    const mine = await meal(old);
    const c = await send(old, mine, { key: key() });
    assert.deepEqual([c.status, c.body!.error], [409, "consent_needed"]);
    assert.equal((await meals(p)).length, 1);
  });
});

describe("POST /api/food/[id]/slot", () => {
  it("moves the person's own meal to another slot and changes nothing else; a resend answers the same", async () => {
    const p = await person("slot@example.com");
    const id = await meal(p, { slot: "lunch", kcal: 420 });
    for (let i = 0; i < 2; i++) {
      const r = await call(slot, { token: p.token, body: { meal: "dinner" }, params: { id } });
      assert.equal(r.status, 200);
      assert.deepEqual([contract.AppMealAnswer.parse(r.body).meal.meal, (r.body!.meal as { kcal: number }).kcal], ["dinner", 420]);
    }
    const [row] = await meals(p);
    assert.deepEqual([row.meal, row.localDate], ["dinner", localDate("Asia/Kolkata")]);
    assert.equal((await uses(p)).length, 0, "a move is not a log");
  });

  it("404 for someone else's meal or none; 400 for a slot that isn't one; 403 from the web", async () => {
    const p = await person("slot-refuse@example.com");
    const other = await person("slot-refuse-other@example.com");
    const theirs = await meal(other, { slot: "lunch" });
    assert.equal((await call(slot, { token: p.token, body: { meal: "dinner" }, params: { id: theirs } })).status, 404);
    assert.equal((await meals(other))[0].meal, "lunch");
    assert.equal((await call(slot, { token: p.token, body: { meal: "brunch" }, params: { id: theirs } })).status, 400);
    assert.equal((await call(slot, { cookie: p.cookie, body: { meal: "dinner" }, params: { id: theirs } })).status, 403);
  });
});

describe("a queued Log again sent after its window (QA finding 3)", () => {
  it("answers with the repeat it already logged, before judging eatenAt", async () => {
    const p = await person("again-queued-resend@example.com");
    const source = await meal(p);
    const k = key();
    const first = await send(p, source, { key: k, eatenAt: new Date(Date.now() - 47 * 3_600_000).toISOString() });
    const again = await send(p, source, { key: k, eatenAt: new Date(Date.now() - 50 * 3_600_000).toISOString() });
    assert.deepEqual([again.status, (again.body!.meal as { id: string }).id, again.body!.repeat], [200, (first.body!.meal as { id: string }).id, true]);
  });
});
