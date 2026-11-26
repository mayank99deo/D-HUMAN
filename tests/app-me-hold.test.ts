// GET /api/me's hold (gap G1) and reportsVersion (gap G11), against a real database. The hold
// follows the Stack screen's rule (an urgent result in the newest read report, else pregnancy);
// the version changes on every upload, read, retry and delete, and on nothing else.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, meal, person, type Handler, type Person } from "./support/app-people.ts";

const g = globalThis as unknown as { __after: (() => unknown)[] };
g.__after = [];
allowAppImports({ "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};" });
const removeDatabase = tempDatabase();

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const contract = await import("../lib/api/schemas.ts");
const me = (await import("../app/api/me/route.ts")).GET as Handler;

after(async () => {
  await removeDatabase();
});

const read = async (p: Person) => contract.MeResponse.parse((await call(me, { token: p.token })).body);
async function report(p: Person, o: { status?: string; flag?: string | null; minutesAgo?: number } = {}) {
  const d = await db();
  const id = randomUUID();
  await d.insert(schema.reports).values({ id, userId: p.id, status: o.status ?? "ready", fileName: "r.pdf", createdAt: new Date(Date.now() - (o.minutesAgo ?? 0) * 60_000), analyzedAt: o.status && o.status !== "ready" ? null : new Date() });
  await d.insert(schema.markers).values({ id: randomUUID(), reportId: id, userId: p.id, key: null, name: "Haemoglobin", value: 6, unit: "g/dL", status: "low", flag: o.flag ?? null });
  return id;
}

describe("GET /api/me: hold (G1)", () => {
  it("none, then pregnancy from the profile, then urgent from the newest read report", async () => {
    const p = await person("hold@example.com");
    assert.equal((await read(p)).hold, null);
    const d = await db();
    await d.update(schema.profiles).set({ conditions: ["pregnant"] }).where(eq(schema.profiles.userId, p.id));
    assert.equal((await read(p)).hold, "pregnant");
    await report(p, { flag: "urgent" });
    assert.equal((await read(p)).hold, "urgent", "an urgent result outranks pregnancy");
  });

  it("only the newest read report counts: an older urgent result, or one still being read, holds nothing", async () => {
    const p = await person("hold-newest@example.com");
    await report(p, { flag: "urgent", minutesAgo: 60 });
    assert.equal((await read(p)).hold, "urgent");
    await report(p, { flag: null, minutesAgo: 5 });
    assert.equal((await read(p)).hold, null, "a newer report without one: as the Stack screen decides");
    await report(p, { status: "reading", flag: "urgent" });
    assert.equal((await read(p)).hold, null, "a read still running has no flags yet");
    const other = await person("hold-other@example.com");
    await report(other, { flag: "urgent" });
    assert.equal((await read(p)).hold, null, "another person's flags never count");
  });
});

describe("GET /api/me: reportsVersion (G11)", () => {
  it("changes on an upload, a read finishing, a retry and a delete; not on a meal", async () => {
    const p = await person("version@example.com");
    const v0 = (await read(p)).reportsVersion;
    await meal(p);
    assert.equal((await read(p)).reportsVersion, v0, "a meal isn't a report");
    const id = await report(p, { status: "reading" });
    const v1 = (await read(p)).reportsVersion;
    assert.notEqual(v1, v0, "uploaded");
    const d = await db();
    await d.update(schema.reports).set({ status: "ready", analyzedAt: new Date() }).where(eq(schema.reports.id, id));
    const v2 = (await read(p)).reportsVersion;
    assert.notEqual(v2, v1, "read");
    await d.update(schema.reports).set({ status: "reading", analyzedAt: null }).where(eq(schema.reports.id, id));
    const v3 = (await read(p)).reportsVersion;
    assert.notEqual(v3, v2, "retried");
    await d.delete(schema.reports).where(eq(schema.reports.id, id));
    assert.equal((await read(p)).reportsVersion, v0, "deleted: back to no reports");
    assert.equal((await read(p)).reportsVersion, v0, "stable when nothing changed");
    assert.ok(!v1.includes(id), "names no report");
  });
});
