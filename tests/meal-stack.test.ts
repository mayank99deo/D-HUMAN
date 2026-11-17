// A stack before any blood report, against a real embedded database: built from what
// someone eats, measured against targets for their body and training, with the same
// rules and safety floor; refused with a plain message when there's nothing to go on;
// out of date once a report is read; and kept when reports are deleted.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

const g = globalThis as unknown as { __testUser?: { id: string; email: string } | null };

allowAppImports({
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "mock";`,
  "@/lib/ai/stack": `export const translatePlan = () => { throw new Error("AI in a test"); }; export const findBrands = translatePlan;`,
  "@/lib/ai/food": `export const estimateMeal = () => { throw new Error("AI in a test"); }; export const estimateTypicalDay = estimateMeal;`,
  "@/lib/ai/report": `export const extractReport = () => { throw new Error("AI in a test"); }; export const interpretReport = extractReport;`,
  "@/lib/ai/events": `export const searchEvents = () => { throw new Error("AI in a test"); };`,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "next/server": "export const after = () => {}; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { latestStack, startStack, STACK_MESSAGES } = await import("../lib/platform/stack.ts");
const { deleteReports } = await import("../lib/platform/reports.ts");
const { POST: stackRoute } = await import("../app/api/stack/route.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

let n = 0;
async function person(diet = "veg") {
  const d = await db();
  const id = `user-${++n}`;
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  await d.insert(schema.profiles).values({
    userId: id, name: "Asha", birthYear: 1998, sex: "female", heightCm: 160, weightKg: 55, activities: ["strength"], primaryActivity: "strength",
    level: "regular", goals: ["muscle"], diet, timezone: "Asia/Kolkata", onboardedAt: new Date(),
  });
  return { id, email: `${id}@example.com` };
}

// A usual day that's short on protein, magnesium, calcium and B12, and on vitamin D and iron too.
async function usualDay(userId: string) {
  const d = await db();
  await d.insert(schema.dietBaselines).values({
    userId,
    description: "Chai and biscuits, poha, rice and dal, chai, roti and sabzi.",
    estimate: {
      meals: [
        { meal: "breakfast", title: "Poha", kcal: 350, protein_g: 7, carbs_g: 60, fat_g: 9, fibre_g: 3 },
        { meal: "lunch", title: "Rice and dal", kcal: 550, protein_g: 16, carbs_g: 95, fat_g: 10, fibre_g: 7 },
        { meal: "dinner", title: "Roti and sabzi", kcal: 500, protein_g: 12, carbs_g: 75, fat_g: 15, fibre_g: 8 },
      ],
      micros: { iron_mg: 9, calcium_mg: 300, magnesium_mg: 160, zinc_mg: 9, b12_ug: 0.6, folate_ug: 200, vitamin_c_mg: 40, vitamin_d_iu: 40 },
      patterns: ["Mostly carbs, little protein."],
    },
  });
}

const run = async (userId: string) => {
  const started = await startStack(userId);
  assert.equal(started.kind, "started");
  if (started.kind === "started") await started.job;
  return (await latestStack(userId))!;
};

describe("a stack before any report", () => {
  it("is built from meals and body, with the same rules, and has no report", async () => {
    const me = await person("veg");
    await usualDay(me.id);
    const stack = await run(me.id);
    assert.equal(stack.status, "ready");
    assert.equal(stack.reportId, null);
    const plan = stack.plan as { items: { rule: string; markers: string[]; diet_gap: string | null }[]; skip: { name: string }[] };
    const rules = plan.items.map((i) => i.rule);
    assert.deepEqual([...rules].sort(), ["b12", "calcium", "magnesium", "protein"]);
    assert.ok(plan.items.every((i) => i.markers.length === 0 && i.diet_gap), "every item is tied to a food gap");
    assert.ok(!rules.includes("vitamin_d3") && !rules.includes("iron"), "never vitamin D or iron without a test");
    assert.ok(plan.skip.some((s) => s.name === "Multivitamin"));
  });

  it("says what to do when there's nothing to go on", async () => {
    const me = await person();
    assert.equal((await startStack(me.id)).kind, "no_data");
    g.__testUser = me;
    const res = await stackRoute();
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "no_data", message: STACK_MESSAGES.no_data });
  });

  it("holds everything when pregnant, report or not", async () => {
    const me = await person();
    await usualDay(me.id);
    const d = await db();
    await d.update(schema.profiles).set({ conditions: ["pregnant"] }).where(eq(schema.profiles.userId, me.id));
    const stack = await run(me.id);
    assert.deepEqual((stack.plan as { items: unknown[] }).items, []);
  });

  it("stays when reports are deleted, and a report's stack replaces it as the latest", async () => {
    const me = await person();
    await usualDay(me.id);
    const fromMeals = await run(me.id);
    const d = await db();
    await d.insert(schema.reports).values({ id: `report-${++n}`, userId: me.id, status: "ready" });
    const fromReport = await run(me.id);
    assert.ok(fromReport.reportId, "with a report, the stack is built from it");
    await deleteReports(me.id, "all");
    assert.equal((await latestStack(me.id))?.id, fromMeals.id, "the meals stack is still there");
  });
});
