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
  "@/lib/ai/food": `export const estimateMeal = () => { throw new Error("AI in a test"); }; export const estimateTypicalDay = estimateMeal; export const estimateUsualDay = estimateMeal;`,
  "@/lib/ai/report": `export const extractReport = () => { throw new Error("AI in a test"); }; export const interpretReport = extractReport;`,
  "@/lib/ai/events": `export const searchEvents = () => { throw new Error("AI in a test"); };`,
  "@/lib/ai/wrap": `export const writeWrap = () => { throw new Error("AI in a test"); };`,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "next/server": "export const after = () => {}; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { inputsChanged, latestStack, startStack, STACK_MESSAGES } = await import("../lib/platform/stack.ts");
const { deleteReports } = await import("../lib/platform/reports.ts");
const { POST: stackRoute } = await import("../app/api/stack/route.ts");
const { dietPicture } = await import("../lib/platform/food.ts");
const { wrapStats } = await import("../lib/platform/wraps.ts");

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

const ymd = (daysAgo: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - daysAgo * 86400000));

// Three past days, each with two meals of `kcal`; Asha's energy target is about 2,060 kcal.
async function loggedDays(userId: string, kcal: number) {
  const d = await db();
  for (const day of [1, 2, 3]) {
    for (const meal of ["lunch", "dinner"]) {
      await d.insert(schema.foodLogs).values({
        id: `${userId}-${day}-${meal}`, userId, localDate: ymd(day), meal, source: "text", title: "Thali", items: [],
        kcal, proteinG: 20, carbsG: 100, fatG: 20, fibreG: 8,
        micros: { iron_mg: 6, calcium_mg: 250, magnesium_mg: 120, zinc_mg: 4, b12_ug: 0.5, folate_ug: 100, vitamin_c_mg: 20, vitamin_d_iu: 30 },
      });
    }
  }
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

  it("says what happened to every food gap, and what the averages came from", async () => {
    const me = await person("veg");
    await usualDay(me.id);
    const plan = (await run(me.id)).plan as { gaps: { key: string; pct: number; outcome: string }[]; gaps_basis: unknown };
    assert.deepEqual(plan.gaps_basis, { source: "typical_day", days: 0 });
    assert.deepEqual(
      plan.gaps.map((x) => [x.key, x.outcome]),
      [
        ["vitamin_d_iu", "test"],
        ["b12_ug", "stack"],
        ["calcium_mg", "stack"],
        ["iron_mg", "test"],
        ["protein", "stack"],
        ["magnesium_mg", "stack"],
        ["fibre", "food"],
        ["vitamin_c_mg", "food"],
        ["zinc_mg", "food"],
      ],
    );
    assert.ok(plan.gaps.every((x, i, all) => i === 0 || all[i - 1].pct <= x.pct), "lowest first");
  });

  it("counts a logged day only once it reaches 75% of the energy target", async () => {
    const partly = await person("veg");
    await loggedDays(partly.id, 650); // 1,300 kcal a day: about 63% of the target
    assert.equal((await startStack(partly.id)).kind, "no_data", "partly logged days read as gaps that aren't there");

    const full = await person("veg");
    await loggedDays(full.id, 800); // 1,600 kcal a day: about 78%
    const plan = (await run(full.id)).plan as { gaps_basis: unknown };
    assert.deepEqual(plan.gaps_basis, { source: "logs", days: 3 });
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

  it("goes out of date when diet, medicines or conditions change, and only then", async () => {
    const me = await person("veg");
    await usualDay(me.id);
    const stack = await run(me.id);
    const d = await db();
    const now = async () => (await d.select().from(schema.profiles).where(eq(schema.profiles.userId, me.id)))[0];
    assert.equal(inputsChanged(stack.plan, await now()), false, "fresh stack");
    await d.update(schema.profiles).set({ name: "Asha K", city: "Pune", weightKg: 56 }).where(eq(schema.profiles.userId, me.id));
    assert.equal(inputsChanged(stack.plan, await now()), false, "other answers don't count");
    for (const change of [{ diet: "vegan" }, { medications: "Metformin 500" }, { conditions: ["kidney"] }]) {
      await d.update(schema.profiles).set({ diet: "veg", medications: null, conditions: [], ...change }).where(eq(schema.profiles.userId, me.id));
      assert.equal(inputsChanged(stack.plan, await now()), true, JSON.stringify(change));
    }
    await d.update(schema.profiles).set({ diet: "veg", medications: "  ", conditions: [] }).where(eq(schema.profiles.userId, me.id));
    assert.equal(inputsChanged(stack.plan, await now()), false, "blank medicines are none");
    assert.equal(inputsChanged({ items: [] }, await now()), false, "a stack from before inputs were saved never counts");
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

const profileOf = async (userId: string) => {
  const d = await db();
  return (await d.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)))[0];
};

describe("a usual day too light to count", () => {
  it("is marked short, so the screens can say why, and builds nothing", async () => {
    const me = await person("veg");
    const d = await db();
    // 800 kcal: about 39% of Asha's 2,060 kcal target, under the 60% a usual day needs.
    await d.insert(schema.dietBaselines).values({
      userId: me.id,
      description: "Dal chawal, roti sabzi, chai.",
      estimate: {
        meals: [
          { meal: "lunch", title: "Dal chawal", kcal: 450, protein_g: 12, carbs_g: 80, fat_g: 8, fibre_g: 5 },
          { meal: "dinner", title: "Roti sabzi", kcal: 350, protein_g: 9, carbs_g: 55, fat_g: 10, fibre_g: 6 },
        ],
        micros: { iron_mg: 5, calcium_mg: 150, magnesium_mg: 120, zinc_mg: 4, b12_ug: 0.2, folate_ug: 90, vitamin_c_mg: 15, vitamin_d_iu: 10 },
        patterns: [],
      },
    });
    const picture = await dietPicture(me.id, await profileOf(me.id));
    assert.equal(picture.source, "none");
    assert.equal(picture.usualDayShort, true);
    assert.equal((await startStack(me.id)).kind, "no_data");
  });

  it("isn't flagged when the usual day counts, or when there's none", async () => {
    const full = await person("veg");
    await usualDay(full.id); // 1,400 kcal: about 68%
    const counted = await dietPicture(full.id, await profileOf(full.id));
    assert.equal(counted.source, "typical_day");
    assert.equal(counted.usualDayShort, false);

    const none = await person("veg");
    assert.equal((await dietPicture(none.id, await profileOf(none.id))).usualDayShort, false);
  });
});

describe("wraps and vitamin D", () => {
  it("never lists vitamin D among the lowest micronutrients, even when food gives the least of it", async () => {
    const me = await person("veg");
    await loggedDays(me.id, 800); // vitamin D 60 IU a day, about 10% of 600 IU, the lowest by far
    const stats = await wrapStats(me.id, await profileOf(me.id), ymd(7), ymd(0));
    assert.deepEqual(stats.lowestMicros.map((m) => m.label), ["Vitamin B12", "Iron", "Calcium"]);
    assert.ok(!JSON.stringify(stats).includes("Vitamin D"), "nothing in the stats the wrap is written from");
  });
});
