// Past meals and deleting reports, against a real embedded database: the history shows
// only the 28 days before today, newest first and only the person's own meals; deleting
// a report takes its markers, read, stack and the wraps that counted it, never anyone
// else's, and never hands back the read it used.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

const g = globalThis as unknown as { __testUser?: { id: string; email: string } | null };

allowAppImports({
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "mock";`,
  "@/lib/ai/report": `export const extractReport = () => { throw new Error("AI in a test"); }; export const interpretReport = extractReport;`,
  "@/lib/ai/events": `export const searchEvents = () => { throw new Error("AI in a test"); };`,
  "@/lib/ai/food": `export const estimateMeal = () => { throw new Error("AI in a test"); }; export const estimateTypicalDay = estimateMeal;`,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  // The upload route's streaming helper; only the route file's DELETE runs here.
  "next/server": "export const after = () => {}; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { mealHistory } = await import("../lib/platform/food.ts");
const { deleteReports, listReports, printedFor } = await import("../lib/platform/reports.ts");
const { dayLabel, HISTORY_DAYS } = await import("../lib/domain/meals.ts");
const { DELETE: deleteAllRoute } = await import("../app/api/reports/route.ts");
const { DELETE: deleteOneRoute } = await import("../app/api/reports/[id]/route.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

let n = 0;
async function newUser() {
  const d = await db();
  const id = `user-${++n}`;
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  return { id, email: `${id}@example.com` };
}

async function meal(userId: string, localDate: string, createdAt: string, title = `Meal ${++n}`) {
  const d = await db();
  await d.insert(schema.foodLogs).values({
    id: `meal-${++n}`, userId, localDate, meal: "lunch", source: "text", title, items: [{ name: "Dal", portion: "1 bowl" }],
    kcal: 300, proteinG: 12, carbsG: 40, fatG: 8, fibreG: 6, micros: { tip: "Add lemon." }, confidence: "high", model: "claude", createdAt: new Date(createdAt),
  });
}

// A read report with one marker, its read and a stack, as a finished upload leaves them.
async function readReport(userId: string, opts: { collectedOn?: string; createdAt?: string; nameOnReport?: string } = {}) {
  const d = await db();
  const id = `report-${++n}`;
  await d.insert(schema.reports).values({
    id, userId, status: "ready", collectedOn: opts.collectedOn ?? null, nameOnReport: opts.nameOnReport ?? null,
    createdAt: opts.createdAt ? new Date(opts.createdAt) : new Date(),
  });
  await d.insert(schema.markers).values({ id: `marker-${++n}`, reportId: id, userId, key: "vitd", name: "Vitamin D", value: 16.9, status: "low" });
  await d.insert(schema.analyses).values({ reportId: id, userId, read: { verdict: { level: "tweak" } } });
  await d.insert(schema.stacks).values({ id: `stack-${++n}`, userId, reportId: id, status: "ready", plan: { items: [] } });
  await d.insert(schema.usage).values({ id: `use-${++n}`, userId, kind: "read", refId: id });
  return id;
}

async function wrap(userId: string, startsOn: string, endsOn: string, reportsInPeriod: number, period = "week") {
  const d = await db();
  const id = `wrap-${++n}`;
  await d.insert(schema.wraps).values({ id, userId, period, startsOn, endsOn, stats: { reportsInPeriod }, story: { title: "Wrap" } });
  return id;
}

const count = async (table: typeof schema.markers | typeof schema.analyses | typeof schema.stacks, reportId: string) => {
  const d = await db();
  return (await d.select().from(table).where(eq(table.reportId, reportId))).length;
};
const wrapIds = async (userId: string) => {
  const d = await db();
  return (await d.select({ id: schema.wraps.id }).from(schema.wraps).where(eq(schema.wraps.userId, userId))).map((w) => w.id).sort();
};

describe("past meals", () => {
  // 12:00 in India on 17 Nov 2026.
  const now = new Date("2026-11-17T06:30:00Z");

  it("lists the 28 days before today, newest first, and nothing else", async () => {
    const me = await newUser();
    const other = await newUser();
    await meal(me.id, "2026-11-17", "2026-11-17T03:00:00Z", "Today's poha");
    await meal(me.id, "2026-11-16", "2026-11-16T14:30:00Z", "Dinner");
    await meal(me.id, "2026-11-16", "2026-11-16T03:10:00Z", "Breakfast");
    await meal(me.id, "2026-10-20", "2026-10-20T06:00:00Z", "28 days ago");
    await meal(me.id, "2026-10-19", "2026-10-19T06:00:00Z", "29 days ago");
    await meal(other.id, "2026-11-16", "2026-11-16T05:00:00Z", "Someone else's");

    const { today, days } = await mealHistory(me.id, "Asia/Kolkata", now);
    assert.equal(today, "2026-11-17");
    assert.equal(HISTORY_DAYS, 28);
    assert.deepEqual(days.map((d) => d.date), ["2026-11-16", "2026-10-20"]);
    assert.deepEqual(days[0].meals.map((m) => m.title), ["Breakfast", "Dinner"], "in the order they were logged");
    assert.match(days[0].meals[0].time ?? "", /^8:40\sam$/i, "on the person's clock");
    assert.equal(days[0].meals[0].tip, "Add lemon.");
    assert.deepEqual(days[0].meals[0].items, ["Dal, 1 bowl"]);
  });

  it("is empty for someone who has logged only today", async () => {
    const me = await newUser();
    await meal(me.id, "2026-11-17", "2026-11-17T03:00:00Z");
    assert.deepEqual((await mealHistory(me.id, "Asia/Kolkata", now)).days, []);
  });

  it("labels yesterday by name and other days by date", () => {
    assert.equal(dayLabel("2026-11-16", "2026-11-17"), "Yesterday");
    assert.equal(dayLabel("2026-11-14", "2026-11-17"), "Sat, 14 Nov");
    assert.equal(dayLabel("2026-10-31", "2026-11-01"), "Yesterday", "across a month");
  });
});

describe("whose report it is", () => {
  it("names the person only when the report isn't theirs", () => {
    assert.equal(printedFor("MR MAYANK NARAYAN", "Mayank"), null);
    assert.equal(printedFor("Mayank N.", "mayank narayan"), null);
    assert.equal(printedFor("Rahul Sharma", "Mayank"), "Rahul Sharma");
    assert.equal(printedFor(null, "Mayank"), null);
    assert.equal(printedFor("Rahul Sharma", null), null, "no name on the profile: nothing to compare");
    assert.equal(printedFor("  ", "Mayank"), null);
    assert.equal(printedFor("R. SHARMA", "Rahul Sharma"), null, "an initial and a surname are theirs");
    assert.equal(printedFor("M NARAYAN", "Mayank Narayan"), null);
    assert.equal(printedFor("MR MAYANKKUMAR S", "Mayank"), null, "a longer form of their name");
    assert.equal(printedFor("MR MAYANK NARAYAN", "मयंक नारायण"), null, "different scripts aren't compared");
    assert.equal(printedFor("मयंक नारायण", "मयंक"), null, "Devanagari words keep their vowel signs");
    assert.equal(printedFor("राहुल शर्मा", "मयंक"), "राहुल शर्मा");
  });
});

describe("deleting reports", () => {
  it("takes one report with its markers, read and stack, and keeps the read counted", async () => {
    const me = await newUser();
    const keep = await readReport(me.id, { collectedOn: "2026-10-01" });
    const drop = await readReport(me.id, { collectedOn: "2026-11-10", nameOnReport: "Rahul" });
    assert.equal(await deleteReports(me.id, [drop]), 1);

    assert.deepEqual((await listReports(me.id)).map((r) => r.id), [keep]);
    for (const table of [schema.markers, schema.analyses, schema.stacks]) assert.equal(await count(table, drop), 0);
    assert.equal(await count(schema.markers, keep), 1, "the other report is untouched");
    const d = await db();
    const uses = await d.select().from(schema.usage).where(and(eq(schema.usage.userId, me.id), eq(schema.usage.kind, "read")));
    assert.equal(uses.length, 2, "deleting never hands a read back");
  });

  it("never touches someone else's report, even by its id", async () => {
    const me = await newUser();
    const other = await newUser();
    const theirs = await readReport(other.id);
    assert.equal(await deleteReports(me.id, [theirs]), 0);
    assert.equal((await listReports(other.id)).length, 1);

    g.__testUser = me;
    const res = await deleteOneRoute(new Request("http://localhost/api/reports/x", { method: "DELETE" }), { params: Promise.resolve({ id: theirs }) } as never);
    assert.equal(res.status, 200);
    assert.equal((await listReports(other.id)).length, 1);
  });

  it("removes every wrap that counted a report, and keeps the meal-only ones", async () => {
    const me = await newUser();
    const drop = await readReport(me.id, { collectedOn: "2026-11-10" });
    await wrap(me.id, "2026-10-26", "2026-11-01", 1); // an earlier report's week: may compare against it, removed
    await wrap(me.id, "2026-11-09", "2026-11-15", 1); // the week it was taken: removed
    await wrap(me.id, "2026-11-16", "2026-11-22", 1); // a later week compared against it: removed
    const mealsOnly = await wrap(me.id, "2026-11-01", "2026-11-30", 0, "month"); // counted no report: kept
    await deleteReports(me.id, [drop]);
    assert.deepEqual(await wrapIds(me.id), [mealsOnly]);
  });

  it("starts fresh: every report goes, meals stay, other people keep theirs", async () => {
    const me = await newUser();
    const other = await newUser();
    await readReport(me.id, { collectedOn: "2026-09-01" });
    await readReport(me.id, { createdAt: "2026-11-12T08:00:00Z" });
    const theirs = await readReport(other.id);
    await meal(me.id, "2026-11-16", "2026-11-16T03:10:00Z");

    g.__testUser = me;
    const res = await deleteAllRoute();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "deleted", deleted: 2 });
    assert.deepEqual(await listReports(me.id), []);
    assert.equal(await count(schema.markers, theirs), 1);
    const d = await db();
    assert.equal((await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, me.id))).length, 1, "meals stay");
  });

  it("asks for sign-in before deleting anything", async () => {
    g.__testUser = null;
    assert.equal((await deleteAllRoute()).status, 401);
    assert.equal((await deleteOneRoute(new Request("http://localhost/api/reports/x", { method: "DELETE" }), { params: Promise.resolve({ id: "x" }) } as never)).status, 401);
  });
});
