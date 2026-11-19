// Opening a week's wrap from the weekly email (/wraps?week=YYYY-MM-DD): which week a link
// means, the days with meals for the "Wrapping…" screen, and wraps.finished_at, set when
// the viewer reaches the story's last card.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

const g = globalThis as unknown as { __testUser?: { id: string; email: string } | null };
allowAppImports({
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
});
const removeDatabase = tempDatabase();

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { OLDEST_WEEK_OFFSET, weekFromParam } = await import("../lib/domain/periods.ts");
const { loggedDays, markWrapFinished } = await import("../lib/platform/wrap-viewer.ts");
const finishedRoute = await import("../app/api/wraps/finished/route.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

describe("?week=", () => {
  const today = "2026-11-22"; // a Sunday: the weekly email's day

  it("finds the week and how far back it is", () => {
    assert.deepEqual(weekFromParam("2026-11-16", today), { start: "2026-11-16", end: "2026-11-22", offset: 0 });
    assert.deepEqual(weekFromParam("2026-11-09", today), { start: "2026-11-09", end: "2026-11-15", offset: -1 });
    assert.deepEqual(weekFromParam("2026-10-26", today), { start: "2026-10-26", end: "2026-11-01", offset: -3 });
    // Across a year end, and from a Monday.
    assert.deepEqual(weekFromParam("2025-12-29", "2026-01-05"), { start: "2025-12-29", end: "2026-01-04", offset: -1 });
  });

  it("takes any day as that day's week", () => {
    assert.equal(weekFromParam("2026-11-19", today)?.start, "2026-11-16");
    assert.equal(weekFromParam("2026-11-22", today)?.offset, 0);
  });

  it("ignores what isn't a real, past or current week in reach", () => {
    for (const bad of ["", "2026-11-31", "2026-02-30", "2026-13-01", "26-11-16", "2026-11-16T00:00", "2026/11/16", " 2026-11-16", "next week"]) {
      assert.equal(weekFromParam(bad, today), null, bad);
    }
    for (const v of [undefined, null, ["2026-11-16"], 20261116]) assert.equal(weekFromParam(v, today), null);
    assert.equal(weekFromParam("2026-11-23", today), null, "a week still to come");
    const oldest = weekFromParam("2026-11-16", today)!;
    assert.equal(oldest.offset, 0);
    const back = (weeks: number) => new Date(Date.parse("2026-11-16T00:00:00Z") + weeks * 7 * 86400000).toISOString().slice(0, 10);
    assert.equal(weekFromParam(back(OLDEST_WEEK_OFFSET), today)?.offset, OLDEST_WEEK_OFFSET);
    assert.equal(weekFromParam(back(OLDEST_WEEK_OFFSET - 1), today), null, "older than the wraps API can make");
  });
});

let n = 0;
async function person() {
  const d = await db();
  const id = `50000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  await d.insert(schema.users).values({ id, email: `w${n}@example.com` });
  return { id, email: `w${n}@example.com` };
}
async function wrapFor(userId: string) {
  const d = await db();
  const id = `60000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  await d.insert(schema.wraps).values({ id, userId, period: "week", startsOn: "2026-11-16", endsOn: "2026-11-22", stats: {}, story: {} });
  return id;
}
const finishedAt = async (id: string) => {
  const d = await db();
  return (await d.select().from(schema.wraps).where(eq(schema.wraps.id, id)))[0].finishedAt;
};
const postFinished = (body: unknown) =>
  finishedRoute.POST(new Request("https://www.d-human.fit/api/wraps/finished", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("the days with meals", () => {
  it("marks Monday to Sunday, for this person only", async () => {
    const p = await person();
    const other = await person();
    const d = await db();
    const meal = (userId: string, localDate: string) => ({
      id: crypto.randomUUID(), userId, localDate, meal: "lunch", source: "text", title: "Dal and rice", items: [], kcal: 500, proteinG: 18, carbsG: 80, fatG: 10, fibreG: 6, micros: {},
    });
    await d.insert(schema.foodLogs).values([meal(p.id, "2026-11-16"), meal(p.id, "2026-11-16"), meal(p.id, "2026-11-19"), meal(p.id, "2026-11-23"), meal(other.id, "2026-11-17")]);
    assert.deepEqual(await loggedDays(p.id, "2026-11-16"), [true, false, false, true, false, false, false]);
  });
});

describe("finished_at", () => {
  it("is set the first time the person reaches the last card, and kept after", async () => {
    const p = await person();
    const id = await wrapFor(p.id);
    assert.equal(await markWrapFinished(p.id, id, new Date("2026-11-22T15:00:00Z")), true);
    assert.equal(await markWrapFinished(p.id, id, new Date("2026-11-23T09:00:00Z")), false);
    assert.equal((await finishedAt(id))!.toISOString(), "2026-11-22T15:00:00.000Z");
  });

  it("only ever touches the person's own wrap, and answers the same either way", async () => {
    const owner = await person();
    const other = await person();
    const id = await wrapFor(owner.id);
    g.__testUser = other;
    const res = await postFinished({ id });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(await finishedAt(id), null);
    g.__testUser = owner;
    assert.equal((await postFinished({ id })).status, 200);
    assert.ok((await finishedAt(id)) instanceof Date);
  });

  it("refuses signed-out and malformed requests", async () => {
    g.__testUser = null;
    assert.equal((await postFinished({ id: "x" })).status, 401);
    g.__testUser = await person();
    for (const body of [{}, { id: "" }, { id: "a'; drop table wraps;--" }, { id: "x".repeat(65) }, null]) {
      assert.equal((await postFinished(body)).status, 400, JSON.stringify(body));
    }
  });
});
