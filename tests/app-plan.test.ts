// The apps' plan and Upload screen: GET /api/plan and GET /api/upload, against a real database.
// The plan's counts, pass and blocks come from the usage ledger and payments as the web's
// PlanView does, with the pass's end as ISO beside the web's date, and no words or price.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, meal, person, type Handler } from "./support/app-people.ts";

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
// Test-mode keys (never used to call Razorpay here: no unpaid orders exist), so test passes count.
Object.assign(process.env, { RAZORPAY_KEY_ID: "rzp_test_contract", RAZORPAY_KEY_SECRET: "test-secret", RAZORPAY_WEBHOOK_SECRET: "test-webhook" });

const { db, schema } = await import("../lib/db/index.ts");
const { getProfile, personaFor } = await import("../lib/platform/profile.ts");
const { factsFor } = await import("../lib/domain/facts.ts");
const { uploadJson } = await import("../lib/api/views/upload.ts");
const contract = await import("../lib/api/schemas.ts");
const plan = (await import("../app/api/plan/route.ts")).GET as Handler;
const upload = (await import("../app/api/upload/route.ts")).GET as Handler;

after(async () => {
  await removeDatabase();
});

const use = async (userId: string, n: number, kind = "meal") => {
  const d = await db();
  for (let i = 0; i < n; i++) await d.insert(schema.usage).values({ id: randomUUID(), userId, kind, refId: randomUUID(), localDate: kind === "meal" ? "2026-11-01" : null });
};

describe("GET /api/plan", () => {
  it("starting out: the counts used and allowed, no pass, nothing blocked, no words or price", async () => {
    const p = await person("plan@example.com");
    await meal(p);
    const d = await db();
    await d.insert(schema.usage).values({ id: randomUUID(), userId: p.id, kind: "meal", refId: randomUUID(), localDate: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10) });
    const r = await call(plan, { token: p.token });
    const body = contract.PlanJson.parse(r.body);
    assert.deepEqual(body, {
      pass: null,
      queued: null,
      reads: { used: 0, limit: 2, free: true },
      meals: { today: 1, perDay: 5, used: 1, freeLimit: 20 },
      readBlock: null,
      mealBlock: null,
      canBuy: true,
      paymentsOn: true,
    });
    assert.ok(!/₹|free\b(?!")/.test(r.text.replace(/"free":/g, "")), r.text);
  });

  it("starting logs used: blocked with the refusal's code; a pass lifts it and gives its end as ISO and the web's date", async () => {
    const p = await person("plan-pass@example.com");
    await use(p.id, 20);
    await use(p.id, 2, "read");
    const blocked = contract.PlanJson.parse((await call(plan, { token: p.token })).body);
    assert.deepEqual([blocked.mealBlock, blocked.readBlock], ["free_meals_used", "free_reads_used"]);
    const d = await db();
    const startsAt = new Date(Date.now() - 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 30 * 86_400_000);
    await d.insert(schema.payments).values({ id: randomUUID(), userId: p.id, orderId: `order_${randomUUID()}`, amount: 4900, currency: "INR", status: "paid", mode: "test", startsAt, endsAt, paidAt: startsAt });
    const paid = contract.PlanJson.parse((await call(plan, { token: p.token })).body);
    assert.equal(paid.pass!.endsAt, endsAt.toISOString());
    assert.equal(paid.pass!.until, new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(endsAt));
    // The two reads were counted just now, inside the pass's days, so they count against its 3.
    assert.deepEqual([paid.mealBlock, paid.readBlock, paid.reads, paid.meals.freeLimit, paid.canBuy], [null, null, { used: 2, limit: 3, free: false }, null, false]);
  });
});

describe("GET /api/upload", () => {
  it("the plan, the event the read aims at, the archetype's facts and the upload limits", async () => {
    const p = await person("upload@example.com", { eventInMind: "Indore Marathon" });
    const d = await db();
    await d.insert(schema.events).values({ id: randomUUID(), activity: "running", region: "indore", name: "Indore Marathon 2027", startsOn: "2027-01-10", city: "Indore" });
    const r = await call(upload, { token: p.token });
    const body = contract.UploadResponse.parse(r.body);
    assert.equal(body.noun, "runner");
    assert.deepEqual(body.limits, { maxFiles: 6, maxTotalBytes: 4 * 1024 * 1024, types: ["application/pdf", "image/jpeg", "image/png", "image/webp"] });
    const persona = personaFor((await getProfile(p.id))!);
    assert.deepEqual(body.facts, factsFor(persona.archetype).map((f) => ({ kicker: f.kicker, text: f.text })));
    assert.ok(body.facts.length > 3);
    assert.equal(body.plan.reads.limit, 2);
    assert.ok(body.target === null || body.target === "Indore Marathon 2027", String(body.target));
    const again = await call(upload, { token: p.token, etag: r.res.headers.get("etag")! });
    assert.equal(again.status, 304);
  });

  it("uploadJson: no event, no target; an event, its name only", () => {
    const profile = { name: "Ravi", birthYear: 1990, primaryActivity: "gym", activities: ["gym"], level: "regular", goals: [] } as unknown as Parameters<typeof personaFor>[0];
    const persona = personaFor(profile);
    const planDetail = {
      view: { pass: null, queuedUntil: null, reads: { used: 0, limit: 2, free: true }, meals: { today: 0, perDay: 5, used: 0, freeLimit: 20 }, readBlock: null, mealBlock: null, canBuy: true, paymentsOn: false },
      passEndsAt: null,
      queuedEndsAt: null,
    };
    assert.equal(uploadJson({ persona, target: null, plan: planDetail, aiOff: true }).target, null);
    const withEvent = uploadJson({ persona, target: { name: "Hyrox Mumbai", details: "secret notes" } as never, plan: planDetail, aiOff: false });
    assert.equal(withEvent.target, "Hyrox Mumbai");
    assert.ok(!JSON.stringify(withEvent).includes("secret notes"));
    assert.deepEqual(withEvent.facts.slice(0, 1), factsFor(persona.archetype).slice(0, 1));
  });

  it("refuses without a token or before onboarding", async () => {
    const fresh = await person("upload-new@example.com", {}, false);
    for (const h of [plan, upload]) {
      assert.equal((await call(h)).status, 401);
      assert.equal((await call(h, { token: fresh.token })).status, 409);
    }
  });
});
