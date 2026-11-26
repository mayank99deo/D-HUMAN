// Meal writes from the apps, against a real database with Claude stubbed: POST /api/food and
// DELETE /api/food/[id] over an app token. A queued meal's eatenAt sets the day it counts on;
// a gallery photo taken today sets the slot; Hinglish heard in Devanagari is read in Latin
// letters with the raw words kept; refusals carry words, Retry-After and no price; and the
// web's requests are answered exactly as before.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, keysOf, person, type Handler, type Person } from "./support/app-people.ts";

type G = { __testUser?: { id: string; email: string } | null; __after: (() => unknown)[]; __heard: { said: string; english: string | null; reply: string }[]; __info: string[] };
const g = globalThis as unknown as G;
g.__after = [];
g.__heard = [];
g.__info = [];

allowAppImports({
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "live";`,
  "@/lib/ai/food": `
    export const estimateMeal = async (input) => {
      globalThis.__heard.push({ said: input.words.said, english: input.words.english, reply: input.words.reply.id });
      const item = { name: "Roti", portion: "2", grams: null, kcal: 240, protein_g: 8, carbs_g: 44, fat_g: 4, fibre_g: 6 };
      return { data: { is_food: true, reply_language: input.words.reply.id, title: input.words.said || "A meal", meal_guess: null, items: [item], confidence: "high", tip: null }, model: "test" };
    };
    export const estimateUsualDay = async () => { throw new Error("not in these tests"); };`,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "@/lib/billing/razorpay": `export const paymentsOn = () => false; export const keyMode = () => "test";`,
});
const removeDatabase = tempDatabase();
const info = console.info;
console.info = (...a: unknown[]) => {
  g.__info.push(a.map(String).join(" "));
};

const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { localDate } = await import("../lib/platform/profile.ts");
const { mealFromClock } = await import("../lib/platform/food.ts");
const { allowRequest } = await import("../lib/waitlist/rate-limit.ts");
const contract = await import("../lib/api/schemas.ts");
const food = (await import("../app/api/food/route.ts")).POST as Handler;
const del = (await import("../app/api/food/[id]/route.ts")).DELETE as Handler;

after(async () => {
  console.info = info;
  await removeDatabase();
});

beforeEach(() => {
  g.__heard = [];
  g.__testUser = null;
});

let n = 0;
const key = () => `app-meal-key-${String(++n).padStart(6, "0")}`;
function form(fields: Record<string, string | Blob>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}
// A 1×1 PNG: enough for the server's type sniffing.
const PNG = new Blob([Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex")], { type: "image/png" });
const send = (p: Person, fields: Record<string, string | Blob>) => call(food, { token: p.token, form: form(fields) });
const rows = async (p: Person) => {
  const d = await db();
  return d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id));
};
const uses = async (p: Person) => {
  const d = await db();
  return d.select().from(schema.usage).where(and(eq(schema.usage.userId, p.id), eq(schema.usage.kind, "meal")));
};

describe("POST /api/food from an app", () => {
  it("logs a meal and answers with the meal as the apps get it: no raw row, private, strict", async () => {
    const p = await person("app-meal@example.com");
    const r = await send(p, { text: "two rotis and dal", source: "text", meal: "lunch", key: key() });
    assert.equal(r.status, 200);
    const body = contract.AppMealAnswer.parse(r.body);
    assert.deepEqual([body.meal.title, body.meal.meal, body.meal.kcal], ["two rotis and dal", "lunch", 240]);
    assert.ok(!("log" in r.body!) && !keysOf(r.body).includes("userId"), r.text);
    assert.equal(r.res.headers.get("cache-control"), "private, no-store");
  });

  it("the same key again gets the same meal, marked a repeat: one row, one use", async () => {
    const p = await person("app-repeat@example.com");
    const k = key();
    const first = await send(p, { text: "poha", source: "text", key: k });
    const again = await send(p, { text: "poha", source: "text", key: k });
    assert.equal(again.status, 200);
    assert.deepEqual([(again.body!.meal as { id: string }).id, again.body!.repeat], [(first.body!.meal as { id: string }).id, true]);
    assert.equal((await rows(p)).length, 1);
    assert.equal((await uses(p)).length, 1);
  });

  it("eatenAt: a meal queued yesterday counts on yesterday, slotted by its own clock; too old or ahead is bad_time", async () => {
    const p = await person("app-queued@example.com");
    const eaten = new Date(Date.now() - 30 * 60 * 60_000);
    const r = await send(p, { text: "idli sambar", source: "text", key: key(), eatenAt: eaten.toISOString() });
    assert.equal(r.status, 200);
    const [row] = await rows(p);
    assert.equal(row.localDate, localDate("Asia/Kolkata", eaten));
    assert.equal(row.eatenAt!.getTime(), eaten.getTime());
    assert.equal(row.meal, mealFromClock("Asia/Kolkata", eaten), "no slot given and none guessed: the clock when it was eaten");
    assert.equal((r.body!.meal as { at: string }).at, eaten.toISOString());
    assert.deepEqual((await uses(p)).map((u) => u.localDate), [localDate("Asia/Kolkata", eaten)], "the use counts on that day too");
    for (const at of [new Date(Date.now() - 49 * 60 * 60_000).toISOString(), new Date(Date.now() + 10 * 60_000).toISOString(), "yesterday"]) {
      const bad = await send(p, { text: "idli", source: "text", key: key(), eatenAt: at });
      assert.equal(bad.status, 400, at);
      assert.equal(contract.ErrorResponse.parse(bad.body).error, "bad_time");
      assert.ok(typeof bad.body!.message === "string");
    }
    assert.equal((await rows(p)).length, 1, "nothing logged for a bad time");
  });

  it("a gallery photo taken today sets the slot by its time; one taken on another day doesn't", async () => {
    const p = await person("app-photo@example.com");
    // Today at 08:10 IST (02:40 UTC) is breakfast; dinner the day before.
    const today = localDate("Asia/Kolkata");
    const breakfast = new Date(`${today}T08:10:00+05:30`);
    const earlier = new Date(breakfast.getTime() - 24 * 60 * 60_000 + 11 * 60 * 60_000); // yesterday 19:10 IST
    const morning = await send(p, { photo: PNG, source: "photo", key: key(), photoAt: breakfast.toISOString() });
    if (breakfast.getTime() <= Date.now() + 5 * 60_000) assert.equal((morning.body!.meal as { meal: string }).meal, "breakfast");
    const old = await send(p, { photo: PNG, source: "photo", key: key(), photoAt: earlier.toISOString() });
    assert.equal((old.body!.meal as { meal: string }).meal, mealFromClock("Asia/Kolkata"), "an older photo is ignored: the arrival clock, as before");
    const said = await send(p, { photo: PNG, source: "photo", meal: "snack", key: key(), photoAt: breakfast.toISOString() });
    assert.equal((said.body!.meal as { meal: string }).meal, "snack", "a slot the person chose always wins");
  });

  it("romanizes on arrival: a Hinglish or English pick that heard Devanagari is read in Latin letters, the raw words kept", async () => {
    const p = await person("app-voice@example.com");
    await send(p, { text: "दो रोटी और दाल", source: "voice", spoken: "hinglish", key: key(), voiceEnd: "pause" });
    assert.equal(g.__heard.at(-1)!.said, "do roti aur dal");
    const [row] = (await rows(p)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    assert.deepEqual([row.inputText, row.inputRaw], ["do roti aur dal", "दो रोटी और दाल"]);
    assert.ok(g.__info.some((l) => l.includes("[food] voice ended by pause")));
    // हिंदी keeps Devanagari; typed words and the web's own sends are never changed.
    await send(p, { text: "दो रोटी", source: "voice", spoken: "hi", key: key() });
    assert.equal(g.__heard.at(-1)!.said, "दो रोटी");
    await send(p, { text: "दो रोटी", source: "text", spoken: "hinglish", key: key() });
    assert.equal(g.__heard.at(-1)!.said, "दो रोटी");
    g.__testUser = { id: p.id, email: p.email };
    await call(food, { form: form({ text: "दो रोटी", source: "voice", spoken: "hinglish", key: key() }) });
    assert.equal(g.__heard.at(-1)!.said, "दो रोटी", "the web's browser romanizes before sending; the server leaves its words alone");
    assert.equal((await rows(p)).filter((r) => r.inputRaw).length, 1);
  });

  it("refusals carry words; 402 has no price and no 'free'; 429 has Retry-After; consent is asked again when it's old", async () => {
    const p = await person("app-limits@example.com");
    const d = await db();
    for (let i = 0; i < 5; i++) await send(p, { text: `meal ${i}`, source: "text", key: key() });
    const limit = await send(p, { text: "one more", source: "text", key: key() });
    assert.equal(limit.status, 402);
    assert.deepEqual([limit.body!.error, limit.body!.refusal], ["plan_limit", "meals_today_used"]);
    assert.ok(!/₹|\bfree\b/i.test(String(limit.body!.message)), String(limit.body!.message));
    await d.update(schema.profiles).set({ name: "Asha" }).where(eq(schema.profiles.userId, p.id));
    const used = await person("app-free-used@example.com");
    for (let i = 0; i < 20; i++) await d.insert(schema.usage).values({ id: `u-${used.id}-${i}`, userId: used.id, kind: "meal", refId: `old-${used.id}-${i}`, localDate: "2026-11-01" });
    const free = await send(used, { text: "dal", source: "text", key: key() });
    assert.equal(free.body!.refusal, "free_meals_used");
    assert.equal(free.body!.message, "You've used the 20 meal logs you started with.");

    const busy = await person("app-busy@example.com");
    for (let i = 0; i < 40; i++) allowRequest(`food:${busy.id}`, 40, 60 * 60_000);
    const slow = await send(busy, { text: "dal", source: "text", key: key() });
    assert.equal(slow.status, 429);
    assert.ok(Number(slow.res.headers.get("retry-after")) > 3000, String(slow.res.headers.get("retry-after")));
    assert.equal(slow.body!.error, "rate_limited");

    const old = await person("app-old-consent@example.com", { consentAt: new Date("2026-11-10T10:00:00Z") });
    const c = await send(old, { text: "dal", source: "text", key: key() });
    assert.equal(c.status, 409);
    assert.deepEqual([c.body!.error, c.body!.version], ["consent_needed", "2026-11-20"]);
    assert.equal((await rows(old)).length, 0);
    g.__testUser = { id: old.id, email: old.email };
    assert.equal((await call(food, { form: form({ text: "dal", source: "text", key: key() }) })).status, 200, "the web's consent rule is unchanged");
  });

  it("signed out, a page's Origin, or before onboarding: refused privately; nothing logged", async () => {
    const p = await person("app-refused@example.com");
    assert.deepEqual([(await call(food, { token: "x", form: form({ text: "dal", source: "text" }) })).status], [401]);
    const withOrigin = await call(food, { token: p.token, origin: "https://www.d-human.fit", form: form({ text: "dal", source: "text" }) });
    assert.equal(withOrigin.status, 401);
    assert.equal(withOrigin.res.headers.get("cache-control"), "private, no-store");
    const fresh = await person("app-not-onboarded@example.com", {}, false);
    const r = await send(fresh, { text: "dal", source: "text" });
    assert.deepEqual([r.status, r.body!.error, r.body!.message], [409, "not_onboarded", "Finish setting up first."]);
    for (const [fields, error, status] of [
      [{ source: "text" }, "empty", 400],
      [{ text: "dal", source: "sms" }, "invalid", 400],
    ] as const) {
      const bad = await send(p, fields);
      assert.deepEqual([bad.status, bad.body!.error], [status, error]);
      assert.ok(typeof bad.body!.message === "string" && bad.body!.message.length > 0);
    }
    assert.equal((await rows(p)).length, 0);
  });

  it("the web's requests are answered exactly as before: the raw row, no private header, eatenAt ignored", async () => {
    const p = await person("web-meal@example.com");
    g.__testUser = { id: p.id, email: p.email };
    const r = await call(food, { form: form({ text: "rajma chawal", source: "text", key: key(), eatenAt: new Date(Date.now() - 30 * 3_600_000).toISOString() }) });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body!), ["log"]);
    assert.equal((r.body!.log as { userId: string }).userId, p.id);
    assert.equal((r.body!.log as { localDate: string }).localDate, localDate("Asia/Kolkata"));
    assert.equal((r.body!.log as { eatenAt: unknown }).eatenAt, null);
    assert.notEqual(r.res.headers.get("cache-control"), "private, no-store");
    g.__testUser = null;
    const out = await call(food, { form: form({ text: "dal", source: "text" }) });
    assert.deepEqual([out.status, out.body], [401, { error: "signed_out" }]);
    g.__testUser = { id: p.id, email: p.email };
    assert.deepEqual((await call(food, { form: form({ source: "text" }) })).body, { error: "empty" }, "no words added to the web's refusals");
  });
});

describe("DELETE /api/food/[id] from an app", () => {
  it("deletes the person's own meal, answers the same when it's already gone, and never touches someone else's", async () => {
    const p = await person("app-delete@example.com");
    const other = await person("app-delete-other@example.com");
    const mine = ((await send(p, { text: "chole", source: "text", key: key() })).body!.meal as { id: string }).id;
    const theirs = ((await send(other, { text: "chole", source: "text", key: key() })).body!.meal as { id: string }).id;
    for (let i = 0; i < 2; i++) {
      const r = await call(del, { token: p.token, method: "DELETE", params: { id: mine } });
      assert.deepEqual([r.status, r.body], [200, { status: "deleted" }]);
      assert.equal(r.res.headers.get("cache-control"), "private, no-store");
    }
    assert.equal((await call(del, { token: p.token, method: "DELETE", params: { id: theirs } })).status, 200);
    assert.equal((await rows(other)).length, 1, "someone else's meal stays");
    assert.equal((await call(del, { method: "DELETE", params: { id: mine } })).status, 401);
  });
});

describe("a queued meal sent again after its window (QA finding 3)", () => {
  it("finds its key's meal first and answers as the first send did, before judging eatenAt", async () => {
    const p = await person("queued-resend@example.com");
    const k = key();
    const first = await send(p, { text: "khichdi", source: "text", key: k, eatenAt: new Date(Date.now() - 47 * 3_600_000).toISOString() });
    assert.equal(first.status, 200);
    // The same try, sent once more after it turned 48 hours old.
    const again = await send(p, { text: "khichdi", source: "text", key: k, eatenAt: new Date(Date.now() - 49 * 3_600_000).toISOString() });
    assert.deepEqual([again.status, (again.body!.meal as { id: string }).id, again.body!.repeat], [200, (first.body!.meal as { id: string }).id, true]);
    assert.equal((await rows(p)).length, 1);
    // A new try with that old time is still refused.
    assert.equal((await send(p, { text: "khichdi", source: "text", key: key(), eatenAt: new Date(Date.now() - 49 * 3_600_000).toISOString() })).body!.error, "bad_time");
  });
});
