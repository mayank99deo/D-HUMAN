// QA findings on deleting reports (2026-11-17), kept as regression tests: all three
// failed or were at risk before the fixes in lib/platform/reports.ts.
// 1. A wrap can quote a deleted report's marker values and survive the delete, because
//    wrapStats picks the report "before" by upload order while deleteReports only clears
//    wraps that end after the deleted report's collection day.
// 2. printedFor calls someone's own report a stranger's when their profile name is in
//    Devanagari (it also splits Devanagari words at vowel signs). Home then shows a red
//    "not you" warning with a Delete button on their own report.
// 3. An initial and surname on the report ("K. SUBRAMANIAM") counts as theirs.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

allowAppImports({
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "mock";`,
  "@/lib/ai/wrap": `export const writeWrap = () => { throw new Error("AI in a test"); };`,
});
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { deleteReports, printedFor } = await import("../lib/platform/reports.ts");
const { wrapStats } = await import("../lib/platform/wraps.ts");

after(async () => {
  await removeDatabase();
});

let n = 0;

async function report(userId: string, opts: { collectedOn: string; createdAt: string; vitaminD: number }) {
  const d = await db();
  const id = `report-${++n}`;
  await d.insert(schema.reports).values({ id, userId, status: "ready", collectedOn: opts.collectedOn, createdAt: new Date(opts.createdAt) });
  await d.insert(schema.markers).values({ id: `marker-${++n}`, reportId: id, userId, key: "vitamin_d", name: "Vitamin D", value: opts.vitaminD, unit: "ng/mL", status: "low" });
  return id;
}

describe("QA: deleting a report leaves no wrap quoting it", () => {
  it("removes an older period's wrap that compared against the deleted report", async () => {
    const d = await db();
    const userId = "qa-user-1";
    await d.insert(schema.users).values({ id: userId, email: "qa-1@example.com" });
    await d.insert(schema.profiles).values({ userId, name: "Asha", birthYear: 1995, sex: "female", timezone: "Asia/Kolkata" });
    const [profile] = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));

    // Her latest report first, then last year's, uploaded a few days later to compare.
    const latest = await report(userId, { collectedOn: "2026-11-05", createdAt: "2026-11-06T05:00:00Z", vitaminD: 32 });
    await report(userId, { collectedOn: "2025-06-01", createdAt: "2026-11-10T05:00:00Z", vitaminD: 14 });

    // Her 2025 wrap, made the way the Wraps screen makes it (POST /api/wraps allows offsets back to -60).
    const stats = await wrapStats(userId, profile, "2025-01-01", "2025-12-31");
    await d.insert(schema.wraps).values({ id: "wrap-2025", userId, period: "year", startsOn: "2025-01-01", endsOn: "2025-12-31", stats, story: { title: "2025" } });

    await deleteReports(userId, [latest]);

    const left = await d.select().from(schema.wraps).where(eq(schema.wraps.userId, userId));
    const quoting = left.filter((w) => (w.stats as typeof stats).markersMoved.some((m) => m.from === 32 || m.to === 32));
    assert.deepEqual(quoting.map((w) => w.id), [], "a wrap still shows the deleted report's vitamin D of 32");
  });
});

describe("QA: whose report it is", () => {
  it("doesn't warn when the profile name is in Devanagari and the report's in Latin letters", () => {
    assert.equal(printedFor("MR MAYANK NARAYAN", "मयंक नारायण"), null);
  });

  it("doesn't warn when the lab printed an initial and the surname", () => {
    assert.equal(printedFor("K. SUBRAMANIAM", "Karthik Subramaniam"), null);
  });
});
