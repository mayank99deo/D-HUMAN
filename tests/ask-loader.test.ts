// Ask's loader (lib/platform/ask.ts loadAsk) against a real embedded database: the threats
// spec's context tests 1, 2, 7, 8 and 11 for the data half (Lane B tests the pack). Another
// person's data never reaches AskData; the shared web caches (brands, events), names,
// emails, cities and the read's words never do either; the stack's state matches what the
// Stack screen would show; the newest report is picked by collection date; reports being
// read or failed are skipped. Also: the diet picture equals dietPicture's.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

allowAppImports({ "@/lib/email/send": `export const sendFounderAlert = async () => ({ status: "sent" });` });
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { loadAsk, askStackState, istDay } = await import("../lib/platform/ask.ts");
const { newestReadyReport } = await import("../lib/platform/reports.ts");
const { dietPicture } = await import("../lib/platform/food.ts");
const { stackInputs } = await import("../lib/platform/stack.ts");
type Profile = import("../lib/db/schema.ts").Profile;

after(async () => {
  await removeDatabase();
});

const NOW = new Date();
let n = 0;
async function person(o: Partial<typeof schema.profiles.$inferInsert> = {}) {
  const d = await db();
  const id = crypto.randomUUID();
  const tag = `P${++n}`;
  await d.insert(schema.users).values({ id, email: `canary_${tag}@example.com` });
  await d.insert(schema.profiles).values({
    userId: id,
    name: `CANARY_${tag}_NAME`,
    birthYear: 1990,
    sex: "male",
    heightCm: 175,
    weightKg: 70,
    city: `CANARY_${tag}_CITY`,
    timezone: "Asia/Kolkata",
    primaryActivity: "running",
    activities: ["running"],
    level: "regular",
    goals: ["energy"],
    diet: "veg",
    eventInMind: `CANARY_${tag}_EVENT_TYPED`,
    medications: `CANARY_${tag}_MED`,
    currentSupplements: `CANARY_${tag}_SUPP`,
    consentAt: NOW,
    onboardedAt: NOW,
    askConsentAt: NOW,
    ...o,
  });
  const [profile] = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, id));
  return { id, tag, profile };
}
type Marker = { key: string | null; name: string; status: string; flag?: string | null; value?: number; valueText?: string };
async function report(userId: string, o: { status?: string; collectedOn?: string | null; createdAt?: Date; startedAt?: Date | null; nameOnReport?: string; markers?: Marker[]; level?: string } = {}) {
  const d = await db();
  const id = crypto.randomUUID();
  await d.insert(schema.reports).values({
    id,
    userId,
    status: o.status ?? "ready",
    collectedOn: o.collectedOn === undefined ? "2026-11-01" : o.collectedOn,
    createdAt: o.createdAt ?? NOW,
    startedAt: o.startedAt ?? null,
    nameOnReport: o.nameOnReport ?? null,
    labName: "CANARY_LAB",
    analyzedAt: (o.status ?? "ready") === "ready" ? (o.createdAt ?? NOW) : null,
  });
  if ((o.status ?? "ready") === "ready") await d.insert(schema.analyses).values({ reportId: id, userId, read: { verdict: { level: o.level ?? "go_with_tweaks", line: "CANARY_READ", detail: "CANARY_READ" } } });
  let position = 0;
  for (const m of o.markers ?? []) {
    await d.insert(schema.markers).values({
      id: crypto.randomUUID(), reportId: id, userId, key: m.key, name: m.name, value: m.value ?? 10, valueText: m.valueText ?? null, unit: "ng/mL",
      refText: "CANARY_REF_TEXT", status: m.status, flag: m.flag ?? null, position: position++,
    });
  }
  return id;
}
const plan = (profile: Profile, items = [{ nutrient: "Vitamin D3", dose: "1,000 IU a day" }]) => ({
  items: items.map((i) => ({ ...i, why: "low", markers: [], diet_gap: null, form: "softgel", timing: "with lunch", duration: "12 weeks", cautions: null, rule: "vitamin_d", brands: [{ brand: "CANARY_OWN_BRAND", product: "D3", url: "https://brand.example/d3" }] })),
  skip: [{ name: "Biotin", why: "no need" }],
  food_first: [],
  see_doctor: [],
  inputs: stackInputs(profile),
});
async function stack(userId: string, reportId: string | null, p: unknown, status = "ready", createdAt = NOW) {
  const d = await db();
  const id = crypto.randomUUID();
  await d.insert(schema.stacks).values({ id, userId, reportId, status, plan: p, createdAt });
  return id;
}
async function meal(userId: string, title: string, localDate = istDay(NOW), kcal = 600) {
  const d = await db();
  const id = crypto.randomUUID();
  await d.insert(schema.foodLogs).values({ id, userId, localDate, meal: "lunch", source: "text", inputText: `CANARY_INPUT_${title}`, title, items: [{ name: "CANARY_ITEM" }], kcal, proteinG: 25, carbsG: 70, fatG: 20, fibreG: 8, micros: { iron_mg: 5, calcium_mg: 300, magnesium_mg: 120, zinc_mg: 3, b12_ug: 0.5, folate_ug: 80, vitamin_c_mg: 20, vitamin_d_iu: 20 } });
  return id;
}

describe("Ask's loader", () => {
  it("1–2. never carries another person's data, names, email, city, the lab, the read's words, brands or events from the web", async () => {
    const a = await person();
    const b = await person();
    const reportA = await report(a.id, { nameOnReport: "CANARY_P1_PRINTED", markers: [{ key: "vitamin_d", name: "CANARY_P1_MARKER", status: "low", valueText: "CANARY_P1_VT" }] });
    const mealA = await meal(a.id, "CANARY_P1_MEAL");
    const d = await db();
    await d.insert(schema.dietBaselines).values({ userId: a.id, description: "CANARY_P1_USUAL", estimate: { meals: [], micros: {}, patterns: ["CANARY_P1_PATTERN"] } });
    const stackA = await stack(a.id, reportA, plan(a.profile));
    await d.insert(schema.brandPicks).values({ key: "vitamin_d:veg", nutrient: "Vitamin D3", brands: [{ brand: "CANARY_BRAND", url: "https://shop.example" }], status: "ok" });
    await d.insert(schema.events).values({ id: crypto.randomUUID(), activity: "running", region: "delhi", name: "CANARY_EVENT", url: "https://race.example" });

    const forA = JSON.stringify((await loadAsk(a.id, a.profile, { now: NOW, plan: true })).data);
    const forB = JSON.stringify((await loadAsk(b.id, b.profile, { now: NOW, plan: true })).data);
    assert.ok(!forB.includes("CANARY_P1"), "nothing of A's reaches B");
    assert.ok(forA.includes("CANARY_P1_MEAL") && forA.includes("CANARY_P1_MED") && forA.includes("CANARY_P1_MARKER"), "A's own data is there");
    for (const absent of [
      "CANARY_P1_NAME", "canary_P1@example.com", "CANARY_P1_CITY", "CANARY_P1_PRINTED", "CANARY_LAB", "CANARY_READ", "CANARY_REF_TEXT",
      "CANARY_INPUT_", "CANARY_ITEM", "CANARY_BRAND", "CANARY_EVENT", "http", a.id, mealA, stackA,
    ]) {
      assert.ok(!forA.includes(absent), `A's data holds no ${absent}`);
    }
    assert.ok(forA.includes(reportA), "the newest report's id is there, for the report link only");
    const dataA = (await loadAsk(a.id, a.profile, { now: NOW })).data;
    assert.deepEqual(dataA.stackBrands, ["CANARY_OWN_BRAND"], "their own stack's brands, for the brand filter");
    assert.equal(dataA.person.eventTyped, "CANARY_P1_EVENT_TYPED", "only the event they typed");
  });

  it("7. gives the stack's state as the Stack screen shows it, with no doses when held or out of date", async () => {
    // Urgent haemoglobin: held, no items.
    const u = await person();
    const r = await report(u.id, { markers: [{ key: "hemoglobin", name: "Haemoglobin", status: "low", flag: "urgent", value: 6.2 }] });
    await stack(u.id, r, plan(u.profile));
    const held = (await loadAsk(u.id, u.profile, { now: NOW })).data.stack;
    assert.equal(held.state, "held");
    assert.ok(held.state === "held" && held.reason === "urgent" && held.leftForDoctor.includes("Haemoglobin"));
    assert.doesNotMatch(JSON.stringify(held), /\d\s*(mg|mcg|µg|IU)\b/i);

    // Pregnancy: held.
    const p = await person({ conditions: ["pregnant"] });
    await stack(p.id, null, plan(p.profile));
    const preg = (await loadAsk(p.id, p.profile, { now: NOW })).data.stack;
    assert.ok(preg.state === "held" && preg.reason === "pregnant");

    // Diet changed since the build: stale, no doses.
    const c = await person();
    await stack(c.id, null, plan(c.profile));
    const d = await db();
    await d.update(schema.profiles).set({ diet: "vegan" }).where(eq(schema.profiles.userId, c.id));
    const [changed] = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, c.id));
    const stale = (await loadAsk(c.id, changed, { now: NOW })).data.stack;
    assert.deepEqual(stale, { state: "stale", reason: "profile", builtOn: istDay(NOW) });

    // A report newer than the stack's: stale.
    const s = await person();
    await stack(s.id, null, plan(s.profile));
    await report(s.id, { markers: [{ key: "vitamin_d", name: "Vitamin D", status: "low" }] });
    assert.deepEqual((await loadAsk(s.id, s.profile, { now: NOW })).data.stack, { state: "stale", reason: "report", builtOn: istDay(NOW) });

    // Current: items from the plan, no brands.
    const ok = await person();
    await stack(ok.id, null, plan(ok.profile));
    const current = (await loadAsk(ok.id, ok.profile, { now: NOW })).data.stack;
    assert.equal(current.state, "current");
    assert.ok(current.state === "current" && current.basis === "meals" && current.items[0].dose === "1,000 IU a day" && current.skip[0] === "Biotin");
    assert.ok(!JSON.stringify(current).includes("CANARY_OWN_BRAND"));

    // Building or failed: none.
    const b = await person();
    await stack(b.id, null, null, "building");
    assert.deepEqual((await loadAsk(b.id, b.profile, { now: NOW })).data.stack, { state: "none" });
    assert.deepEqual(askStackState(null, null, b.profile), { state: "none" });
  });

  it("8. picks the newest report by when the blood was taken, not upload order, and keeps its flags", async () => {
    const me = await person();
    const older = new Date(NOW.getTime() - 86_400_000);
    const a = await report(me.id, { collectedOn: "2026-11-01", createdAt: older, markers: [{ key: "ferritin", name: "Ferritin", status: "low", flag: "urgent", value: 4 }] });
    await report(me.id, { collectedOn: "2025-06-01", createdAt: NOW, markers: [{ key: "ferritin", name: "Ferritin", status: "in_range", value: 60 }] });
    const load = await loadAsk(me.id, me.profile, { now: NOW });
    assert.equal(load.data.report?.id, a);
    assert.equal(load.data.report?.markers[0].flag, "urgent");
    assert.equal((await newestReadyReport(me.id))?.id, a, "the helper agrees");

    // A report with no collection date counts from its upload day, so it isn't buried under last year's.
    const undated = await report(me.id, { collectedOn: null, createdAt: NOW, markers: [] });
    assert.equal((await loadAsk(me.id, me.profile, { now: NOW })).data.report?.id, undated);
    assert.equal((await newestReadyReport(me.id))?.id, undated);
  });

  it("9. says the report may not be theirs without saying whose, and keeps the verdict level and marker order", async () => {
    const me = await person({ name: "Asha Rao" });
    await report(me.id, {
      nameOnReport: "Ravi Kumar",
      level: "doctor_first",
      markers: [
        { key: "tsh", name: "TSH", status: "in_range" },
        { key: "hemoglobin", name: "Hb", status: "low", flag: "doctor" },
      ],
    });
    const r = (await loadAsk(me.id, me.profile, { now: NOW })).data.report!;
    assert.equal(r.mayNotBeTheirs, true);
    assert.ok(!JSON.stringify(r).includes("Ravi"));
    assert.equal(r.verdictLevel, "doctor_first");
    assert.deepEqual(r.markers.map((m) => [m.key, m.printedName, m.flag]), [["tsh", "TSH", null], ["hemoglobin", "Hb", "doctor"]]);
  });

  it("11. skips reports being read or failed, and a deleted report's markers are gone", async () => {
    const me = await person();
    const ready = await report(me.id, { collectedOn: "2026-10-01", markers: [{ key: "b12", name: "B12", status: "low" }] });
    await report(me.id, { status: "reading", collectedOn: "2026-11-10", startedAt: NOW, markers: [] });
    await report(me.id, { status: "failed", collectedOn: "2026-11-12", markers: [] });
    const load = await loadAsk(me.id, me.profile, { now: NOW });
    assert.equal(load.data.report?.id, ready);
    assert.equal(load.reading, true, "a read in progress shows as reading");
    const d = await db();
    await d.delete(schema.reports).where(eq(schema.reports.id, ready));
    const after = await loadAsk(me.id, me.profile, { now: NOW });
    assert.equal(after.data.report, null);
    assert.ok(!JSON.stringify(after.data).includes("B12"));
  });

  it("works out the diet picture exactly as dietPicture does, from its own batch", async () => {
    const me = await person();
    for (let i = 0; i < 4; i++) {
      const day = new Date(NOW.getTime() - i * 86_400_000);
      await meal(me.id, `breakfast ${i}`, istDay(day), 900);
      await meal(me.id, `dinner ${i}`, istDay(day), 1200);
    }
    const load = await loadAsk(me.id, me.profile, { now: NOW });
    assert.deepEqual(load.data.diet, await dietPicture(me.id, me.profile));
    assert.equal(load.data.diet.source, "logs");
    assert.equal(load.data.today.meals.length, 2);
    assert.equal(load.mealsEver, true);
    assert.deepEqual(Object.keys(load.data.today.meals[0]).sort(), ["at", "kcal", "meal", "proteinG", "title"]);
  });
});
