// QA (2026-11-17): a stack from meals alone must rest on a real food gap, not on meals
// that were never logged. Three days with two small entries each count as "full" days
// today, so a near-empty log reads as huge gaps and earns a full stack. These tests
// fail until a meals-only stack checks the picture covers a plausible day's eating.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

allowAppImports({
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "mock";`,
  "@/lib/ai/stack": `export const translatePlan = () => { throw new Error("AI in a test"); }; export const findBrands = translatePlan;`,
  "@/lib/ai/food": `export const estimateMeal = () => { throw new Error("AI in a test"); }; export const estimateTypicalDay = estimateMeal; export const estimateUsualDay = estimateMeal;`,
  "@/lib/ai/report": `export const extractReport = () => { throw new Error("AI in a test"); }; export const interpretReport = extractReport;`,
  "@/lib/ai/events": `export const searchEvents = () => { throw new Error("AI in a test"); };`,
  "@/lib/auth/session": "export const apiUser = async () => null;",
  "next/server": "export const after = () => {}; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
const { db, schema } = await import("../lib/db/index.ts");
const { latestStack, startStack } = await import("../lib/platform/stack.ts");

after(async () => {
  await removeDatabase();
});

let n = 0;
async function person() {
  const d = await db();
  const id = `qa-${++n}`;
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  await d.insert(schema.profiles).values({
    userId: id, name: "Asha", birthYear: 1998, sex: "female", heightCm: 160, weightKg: 55, activities: ["strength"], primaryActivity: "strength",
    level: "regular", goals: ["muscle"], diet: "veg", timezone: "Asia/Kolkata", onboardedAt: new Date(),
  });
  return id;
}

const ymd = (daysAgo: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - daysAgo * 86400000));

// Two cups of chai a day for three days: "full" days by today's rule (two entries each),
// about 200 kcal a day against a target near 2,000.
async function chaiOnly(userId: string) {
  const d = await db();
  for (const day of [1, 2, 3]) {
    for (const meal of ["breakfast", "snack"]) {
      await d.insert(schema.foodLogs).values({
        id: `${userId}-${day}-${meal}`, userId, localDate: ymd(day), meal, source: "text",
        title: "Chai", items: [], kcal: 100, proteinG: 3, carbsG: 14, fatG: 3, fibreG: 0,
        micros: { iron_mg: 0.1, calcium_mg: 100, magnesium_mg: 12, zinc_mg: 0.4, b12_ug: 0.3, folate_ug: 5, vitamin_c_mg: 0, vitamin_d_iu: 0 },
      });
    }
  }
}

describe("QA: a meals-only stack needs a believable picture of the day", () => {
  it("doesn't turn a near-empty log (two cups of chai a day) into a stack of supplements", async () => {
    const me = await person();
    await chaiOnly(me);
    const started = await startStack(me);
    if (started.kind === "no_data") return; // refusing is a fine answer
    assert.equal(started.kind, "started");
    if (started.kind === "started") await started.job;
    const plan = (await latestStack(me))!.plan as { items: { rule: string }[] };
    assert.deepEqual(
      plan.items.map((i) => i.rule),
      [],
      "200 kcal a day logged is missing meals, not proof of five nutrient gaps",
    );
  });

  it("doesn't build from a usual day that describes almost no food", async () => {
    const me = await person();
    const d = await db();
    await d.insert(schema.dietBaselines).values({
      userId: me,
      description: "I don't really eat much, mostly tea.",
      estimate: {
        meals: [{ meal: "snack", title: "Tea", kcal: 90, protein_g: 2, carbs_g: 12, fat_g: 3, fibre_g: 0 }],
        micros: { iron_mg: 0.1, calcium_mg: 80, magnesium_mg: 10, zinc_mg: 0.3, b12_ug: 0.2, folate_ug: 4, vitamin_c_mg: 0, vitamin_d_iu: 0 },
        patterns: [],
      },
    });
    const started = await startStack(me);
    if (started.kind === "no_data") return;
    if (started.kind === "started") await started.job;
    const plan = (await latestStack(me))!.plan as { items: { rule: string }[] };
    assert.deepEqual(plan.items.map((i) => i.rule), [], "90 kcal a day is not a usual day to dose supplements from");
  });
});
