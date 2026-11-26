// The usual day from the apps (gap G7), against a real database with Claude stubbed: POST
// /api/food/typical answers with `short` and `runs` beside the saved day, works out `short` by the
// diet picture's own rule, reads a resend once, and asks for consent again when it's old. The
// web's save is answered exactly as before.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, person, type Handler } from "./support/app-people.ts";

type G = { __after: (() => unknown)[]; __testUser?: { id: string; email: string } | null; __dayCalls: number; __dayKcal: number };
const g = globalThis as unknown as G;
g.__after = [];
g.__dayCalls = 0;
g.__dayKcal = 2400;
allowAppImports({
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "live";`,
  "@/lib/ai/food": `
    export const estimateMeal = async () => { throw new Error("not in these tests"); };
    export const estimateUsualDay = async () => {
      globalThis.__dayCalls++;
      const day = { meals: [{ name: "Day", kcal: globalThis.__dayKcal, protein_g: 80, carbs_g: 300, fat_g: 80, fibre_g: 30 }], micros: { iron_mg: 10, calcium_mg: 600, magnesium_mg: 300, zinc_mg: 8, b12_ug: 1, folate_ug: 200, vitamin_c_mg: 50, vitamin_d_iu: 100 }, patterns: ["Rice at lunch."], runs: 3 };
      return { data: day, model: "test" };
    };`,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
});
const removeDatabase = tempDatabase();

const contract = await import("../lib/api/schemas.ts");
const typical = (await import("../app/api/food/typical/route.ts")).POST as Handler;

after(async () => {
  await removeDatabase();
});

describe("POST /api/food/typical from an app (G7)", () => {
  it("answers the day with short and runs; a full day isn't short, a light one is; a resend is read once", async () => {
    const p = await person("usual@example.com");
    g.__dayKcal = 2400;
    const full = await call(typical, { token: p.token, body: { description: "Poha, dal chawal with sabzi, roti and paneer, fruit, milk" } });
    assert.equal(full.status, 200);
    const body = contract.TypicalAnswer.parse(full.body);
    assert.deepEqual([body.short, body.runs], [false, 3]);
    assert.equal(full.res.headers.get("cache-control"), "private, no-store");
    const calls = g.__dayCalls;
    const again = await call(typical, { token: p.token, body: { description: "Poha, dal chawal with sabzi, roti and paneer, fruit, milk" } });
    assert.deepEqual([g.__dayCalls, contract.TypicalAnswer.parse(again.body).short], [calls, false], "the same words moments later: that save, not three more estimates");
    // 600 kcal against her target is well under 60%: too light to count.
    g.__dayKcal = 600;
    const light = contract.TypicalAnswer.parse((await call(typical, { token: p.token, body: { description: "Chai and two biscuits, then dinner" } })).body);
    assert.equal(light.short, true);
  });

  it("refuses: old consent (409), too short (400, with words), signed out (401); the web's answer is unchanged", async () => {
    const old = await person("usual-old@example.com", { consentAt: new Date("2026-11-01T00:00:00Z") });
    const c = await call(typical, { token: old.token, body: { description: "Poha, dal chawal, roti sabzi" } });
    assert.deepEqual([c.status, c.body!.error], [409, "consent_needed"]);
    const p = await person("usual-refuse@example.com");
    const s = await call(typical, { token: p.token, body: { description: "dal" } });
    assert.deepEqual([s.status, s.body!.error], [400, "too_short"]);
    assert.ok(String(s.body!.message).length > 0);
    assert.equal((await call(typical, { token: "dht_nope", body: { description: "Poha, dal chawal, roti sabzi" } })).status, 401);
    g.__testUser = { id: p.id, email: p.email };
    const web = await call(typical, { body: { description: "Poha, dal chawal with sabzi, roti" } });
    assert.deepEqual(Object.keys(web.body!), ["day"]);
    assert.deepEqual((await call(typical, { body: { description: "dal" } })).body, { error: "too_short" });
    g.__testUser = null;
  });
});
