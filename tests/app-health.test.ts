// The apps' profile saves, the health question (gap G2) and stack builds, against a real
// database. POST /api/profile records the health question only with both of its answers and only
// from an app; it re-records consent to the current wording; POST /api/stack waits for the health
// question and for current consent; GET /api/stack/[id] follows a build. The web's requests to
// the same routes are answered exactly as before.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, person, type Handler, type Person } from "./support/app-people.ts";

type G = { __after: (() => unknown)[]; __testUser?: { id: string; email: string } | null };
const g = globalThis as unknown as G;
g.__after = [];
allowAppImports({
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "@/lib/email/jobs": "export const sendWelcome = async () => {};",
  "@/lib/sheets/users": "export const pushUserRow = async () => {};",
});
const removeDatabase = tempDatabase();
delete process.env.ANTHROPIC_API_KEY;

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const contract = await import("../lib/api/schemas.ts");
const profileRoute = (await import("../app/api/profile/route.ts")).POST as Handler;
const build = (await import("../app/api/stack/route.ts")).POST as Handler;
const poll = (await import("../app/api/stack/[id]/route.ts")).GET as Handler;
const me = (await import("../app/api/me/route.ts")).GET as Handler;

after(async () => {
  await removeDatabase();
});

const row = async (p: Person) => {
  const d = await db();
  return (await d.select().from(schema.profiles).where(eq(schema.profiles.userId, p.id)))[0];
};
const runAfter = async () => {
  const jobs = g.__after.splice(0);
  for (const j of jobs) await j();
};
async function withReport(p: Person) {
  const d = await db();
  const id = randomUUID();
  await d.insert(schema.reports).values({ id, userId: p.id, status: "ready", fileName: "r.pdf", model: "mock" });
  await d.insert(schema.markers).values({ id: randomUUID(), reportId: id, userId: p.id, key: "vitamin_d", name: "Vitamin D", value: 18, unit: "ng/mL", refLow: 30, refHigh: 100, rangeSource: "catalog", status: "low" });
  return id;
}

describe("POST /api/profile from an app", () => {
  it("saves privately; the health question counts only with conditions and medicines in the same save", async () => {
    const p = await person("health@example.com");
    const save = (body: unknown) => call(profileRoute, { token: p.token, body });
    const r = await save({ name: "Asha R" });
    assert.deepEqual([r.status, r.body, r.res.headers.get("cache-control")], [200, { status: "saved" }, "private, no-store"]);
    for (const half of [{ healthChecked: true }, { healthChecked: true, conditions: [] }, { healthChecked: true, medications: null }]) {
      const bad = await save(half);
      assert.deepEqual([bad.status, bad.body!.error], [400, "invalid"], JSON.stringify(half));
    }
    assert.equal((await row(p)).healthCheckedAt, null);
    assert.equal((await save({ healthChecked: true, conditions: [], medications: null })).status, 200);
    const checked = (await row(p)).healthCheckedAt;
    assert.ok(checked);
    const m = contract.MeResponse.parse((await call(me, { token: p.token })).body);
    assert.equal(m.healthCheckedAt, checked!.toISOString());
  });

  it("consent: an app's agreement to the current wording is recorded; the web's first-agreement rule is unchanged", async () => {
    const old = new Date("2026-11-02T10:00:00Z");
    const p = await person("consent-app@example.com", { consentAt: old });
    await call(profileRoute, { token: p.token, body: { consent: true } });
    const now = (await row(p)).consentAt!;
    assert.ok(now.getTime() > old.getTime(), "agreed again, to the current wording");
    assert.equal(contract.MeResponse.parse((await call(me, { token: p.token })).body).consent.current, true);
    const c = contract.MeResponse.parse((await call(me, { token: p.token })).body).consent;
    assert.deepEqual([c.firstAt, c.newLines], [old.toISOString(), []], "the first agreement stays on record");
    assert.equal((await row(p)).consentFirstAt!.getTime(), old.getTime());
    const mid = await person("consent-mid@example.com", { consentAt: new Date("2026-11-15T10:00:00Z") });
    assert.deepEqual(contract.MeResponse.parse((await call(me, { token: mid.token })).body).consent.newLines, ["ask_questions"]);
    const early = await person("consent-early@example.com", { consentAt: old });
    assert.deepEqual(contract.MeResponse.parse((await call(me, { token: early.token })).body).consent.newLines, ["health_data", "ai_processing", "ask_questions"]);
    const w = await person("consent-web@example.com", { consentAt: old });
    g.__testUser = { id: w.id, email: w.email };
    const r = await call(profileRoute, { body: { consent: true } });
    assert.deepEqual(r.body, { status: "saved" });
    assert.equal((await row(w)).consentAt!.getTime(), old.getTime(), "the web keeps the moment they first agreed");
    assert.notEqual(r.res.headers.get("cache-control"), "private, no-store");
    // The web's saves never record the health question, even if one sent it.
    await call(profileRoute, { body: { healthChecked: true, conditions: [], medications: null } });
    assert.equal((await row(w)).healthCheckedAt, null);
    g.__testUser = null;
  });

  it("refuses without a valid token, and health answers before consent", async () => {
    assert.equal((await call(profileRoute, { token: "dht_nope", body: { name: "x" } })).status, 401);
    const p = await person("noconsent@example.com", { consentAt: null }, false);
    const r = await call(profileRoute, { token: p.token, body: { conditions: ["thyroid"] } });
    assert.deepEqual([r.status, r.body], [403, { error: "consent_required" }]);
    assert.equal((await call(profileRoute, { token: p.token, body: { language: "hi" } })).status, 200, "the language before consent is fine");
  });
});

describe("POST /api/stack from an app", () => {
  it("waits for the health question, then builds; a second tap mid-build follows the same build; the poll follows it", async () => {
    const p = await person("build@example.com");
    await withReport(p);
    const first = await call(build, { token: p.token, body: {} });
    assert.deepEqual([first.status, first.body!.error], [409, "health_check_needed"]);
    assert.ok(String(first.body!.message).length > 0);
    await call(profileRoute, { token: p.token, body: { healthChecked: true, conditions: [], medications: null } });
    const started = await call(build, { token: p.token, body: {} });
    assert.equal(started.status, 200);
    const { id } = contract.StackBuildResponse.parse(started.body);
    // A second tap while it still builds follows the same one; on a fast database the first may
    // already be done, and then it's a new build. Either way: 200 with an id.
    const again = contract.StackBuildResponse.parse((await call(build, { token: p.token, body: {} })).body).id;
    const d = await db();
    const firstDone = (await d.select().from(schema.stacks).where(eq(schema.stacks.id, id)))[0].status !== "building";
    if (!firstDone) assert.equal(again, id, "already building: the same one");
    assert.ok(["building", "ready"].includes(String((await call(poll, { token: p.token, params: { id } })).body!.status)));
    await runAfter();
    const done = await call(poll, { token: p.token, params: { id } });
    assert.deepEqual([done.status, contract.StackStatusResponse.parse(done.body).status, done.res.headers.get("cache-control")], [200, "ready", "private, no-store"]);
    const other = await person("build-other@example.com");
    assert.equal((await call(poll, { token: other.token, params: { id } })).status, 404);
  });

  it("old consent: 409 consent_needed before anything; no data: 409 no_data with words", async () => {
    const old = await person("build-old@example.com", { consentAt: new Date("2026-11-01T00:00:00Z"), healthCheckedAt: new Date() });
    await withReport(old);
    const c = await call(build, { token: old.token, body: {} });
    assert.deepEqual([c.status, c.body!.error], [409, "consent_needed"]);
    const d = await db();
    assert.equal((await d.select().from(schema.stacks).where(eq(schema.stacks.userId, old.id))).length, 0);
    const empty = await person("build-empty@example.com", { healthCheckedAt: new Date() });
    const n = await call(build, { token: empty.token, body: {} });
    assert.deepEqual([n.status, n.body!.error], [409, "no_data"]);
  });

  it("the web's build is unchanged: no health question, the same answers", async () => {
    const w = await person("build-web@example.com");
    await withReport(w);
    g.__testUser = { id: w.id, email: w.email };
    const r = await call(build, { body: {} });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body!), ["id"]);
    assert.notEqual(r.res.headers.get("cache-control"), "private, no-store");
    g.__testUser = null;
    await runAfter();
  });
});
