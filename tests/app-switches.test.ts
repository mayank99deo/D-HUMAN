// The remote switches, honoured by the server for app requests (QA's finding 2), and the app-only
// health-question gate on a stack built on the web (finding 4), against a real database. The
// web's requests ignore both.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, meal, person, type Handler, type Person } from "./support/app-people.ts";

type G = { __after: (() => unknown)[]; __testUser?: { id: string; email: string } | null };
const g = globalThis as unknown as G;
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: () => undefined, set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "live";`,
  "@/lib/ai/food": `
    export const estimateMeal = async (input) => ({ data: { is_food: true, reply_language: "en", title: "Dal", meal_guess: null, items: [{ name: "Dal", portion: "1 bowl", grams: null, kcal: 180, protein_g: 9, carbs_g: 24, fat_g: 5, fibre_g: 6 }], confidence: "high", tip: null }, model: "test" });
    export const estimateUsualDay = async () => { throw new Error("not here"); };`,
});
const removeDatabase = tempDatabase();

const { db, schema } = await import("../lib/db/index.ts");
const contract = await import("../lib/api/schemas.ts");
const stack = (await import("../app/api/stack/route.ts")).GET as Handler;
const food = (await import("../app/api/food/route.ts")).POST as Handler;
const again = (await import("../app/api/food/[id]/again/route.ts")).POST as Handler;
const storeToken = (await import("../app/api/billing/store-token/route.ts")).POST as Handler;

after(async () => {
  await removeDatabase();
});
afterEach(() => {
  delete process.env.APP_SWITCHES_OFF;
  g.__testUser = null;
});

const PLAN = { items: [{ nutrient: "Magnesium", dose: "200 mg a day", why: "Food gap", markers: [], form: "Tablet", timing: "Night", duration: "8 weeks", rule: "magnesium", brands: [{ brand: "B", product: "Mg", monthly_inr: 400 }] }], skip: [], food_first: [], see_doctor: [], inputs: { diet: "veg", medications: null, conditions: [] } };
async function withStack(p: Person) {
  const d = await db();
  await d.insert(schema.stacks).values({ id: randomUUID(), userId: p.id, reportId: null, status: "ready", plan: PLAN, model: "rules" });
}
const stackOf = async (p: Person) => {
  const body = contract.StackResponse.parse((await call(stack, { token: p.token })).body);
  assert.ok(body.state === "stack");
  return body;
};
const form = (f: Record<string, string | Blob>) => Object.entries(f).reduce((fd, [k, v]) => (fd.append(k, v), fd), new FormData());

describe("the doses switch on GET /api/stack", () => {
  it("off: no plan, no fits, no dose anywhere, and dosesOff; on: the plan", async () => {
    const p = await person("doses@example.com", { healthCheckedAt: new Date() });
    await withStack(p);
    process.env.APP_SWITCHES_OFF = "doses";
    const off = await call(stack, { token: p.token });
    const body = contract.StackResponse.parse(off.body);
    assert.ok(body.state === "stack");
    assert.deepEqual([body.stack?.plan, body.fits, body.dosesOff], [null, null, true]);
    assert.ok(!off.text.includes("200 mg"));
    delete process.env.APP_SWITCHES_OFF;
    const on = await stackOf(p);
    assert.deepEqual([!!on.stack?.plan, !!on.fits, on.dosesOff], [true, true, false]);
  });
});

describe("the health question on a stack built on the web (G2, app only)", () => {
  it("not answered: no plan and healthCheckNeeded; answered: the plan; no stack: nothing to ask", async () => {
    const p = await person("webstack@example.com");
    assert.equal((await stackOf(p).catch(() => null))?.healthCheckNeeded ?? false, false);
    await withStack(p);
    const before = await stackOf(p);
    assert.deepEqual([before.stack?.plan, before.fits, before.healthCheckNeeded], [null, null, true]);
    const d = await db();
    const { eq } = await import("drizzle-orm");
    await d.update(schema.profiles).set({ healthCheckedAt: new Date() }).where(eq(schema.profiles.userId, p.id));
    const afterAnswer = await stackOf(p);
    assert.deepEqual([!!afterAnswer.stack?.plan, afterAnswer.healthCheckNeeded], [true, false]);
  });
});

describe("the again, voice, snap and iap switches", () => {
  it("each answers 403 switched_off naming the switch, logs nothing, and leaves the other ways in open", async () => {
    const p = await person("switches@example.com");
    const source = await meal(p);
    process.env.APP_SWITCHES_OFF = "again,voice,snap,iap";
    const a = await call(again, { token: p.token, body: { key: `switch-key-${randomUUID()}` }, params: { id: source } });
    assert.deepEqual([a.status, a.body!.error, a.body!.switch], [403, "switched_off", "again"]);
    const v = await call(food, { token: p.token, form: form({ text: "dal", source: "voice", spoken: "en" }) });
    assert.deepEqual([v.status, v.body!.switch], [403, "voice"]);
    const photo = new Blob([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")], { type: "image/png" });
    assert.deepEqual((await call(food, { token: p.token, form: form({ photo, source: "photo" }) })).body!.switch, "snap");
    assert.deepEqual((await call(storeToken, { token: p.token, body: {} })).body!.switch, "iap");
    assert.equal((await call(food, { token: p.token, form: form({ text: "dal", source: "text" }) })).status, 200, "typing still logs");
    const d = await db();
    const { eq } = await import("drizzle-orm");
    assert.equal((await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id))).length, 2, "the source and the typed meal only");
    g.__testUser = { id: p.id, email: p.email };
    assert.equal((await call(food, { form: form({ text: "dal", source: "voice", spoken: "en" }) })).status, 200, "the web ignores the apps' switches");
  });
});
