// Fuel's builders on fixture data, with no database: every branch of fuelView (the web page's
// own derivations) and of the apps' shaping (fuelJson, pastJson, mealJson, planJson), each
// checked against numbers and words worked out here by hand, not against the builder itself.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();

const { fuelView } = await import("../lib/platform/views/fuel.ts");
const { fuelJson, pastJson } = await import("../lib/api/views/fuel.ts");
const { mealJson, planJson } = await import("../lib/api/views/parts.ts");
const { personaFor } = await import("../lib/platform/profile.ts");
const { FuelResponse, PastMealsResponse, MealJson, PlanJson } = await import("../lib/api/schemas.ts");
type FuelData = import("../lib/platform/views/fuel.ts").FuelData;
type Profile = import("../lib/db/schema.ts").Profile;
type FoodLog = import("../lib/db/schema.ts").FoodLog;

const profile = (over: Partial<Profile> = {}): Profile => ({
  userId: "u1", name: "Asha", birthYear: 1994, sex: "female", heightCm: 160, weightKg: 55, city: "Indore", country: "India",
  timezone: "Asia/Kolkata", language: "en", activities: ["running"], primaryActivity: "running", level: "regular", sessionsPerWeek: 4,
  goals: [], eventInMind: null, diet: "veg", conditions: [], medications: null, currentSupplements: null, supplementBudget: null,
  consentAt: new Date("2026-11-21T00:00:00Z"), onboardedAt: new Date("2026-11-21T00:00:00Z"), tourDoneAt: null, askConsentAt: null,
  updatedAt: new Date("2026-11-21T00:00:00Z"), ...over,
}) as Profile;

const log = (over: Partial<FoodLog> = {}): FoodLog => ({
  id: "m1", userId: "u1", localDate: "2026-11-26", meal: "lunch", source: "text", inputText: "dal roti", title: "Dal and two rotis",
  items: [{ name: "Dal", portion: "1 bowl" }, { name: "Roti", portion: "2" }], kcal: 400, proteinG: 15, carbsG: 60, fatG: 10, fibreG: 8,
  micros: { iron_mg: 14.5, calcium_mg: 250, vitamin_d_iu: 40, tip: "Add curd.", lang: "en" }, confidence: "medium", model: "claude-haiku",
  createdAt: new Date("2026-11-26T07:40:00Z"), ...over,
}) as FoodLog;

const noPlan = {
  view: {
    pass: null, queuedUntil: null, reads: { used: 0, limit: 2, free: true }, meals: { today: 1, perDay: 5, used: 1, freeLimit: 20 },
    readBlock: null, mealBlock: null, canBuy: true, paymentsOn: true,
  },
  passEndsAt: null,
  queuedEndsAt: null,
};

const picture = (over: Partial<FuelData["picture"]> = {}): FuelData["picture"] => ({
  source: "none", days: 0, fullDays: 0, perDay: null, gaps: [], patterns: [], usualDayShort: false, ...over,
});

const data = (over: Partial<FuelData> = {}): FuelData => ({
  today: "2026-11-26", logs: [log()], picture: picture(), base: null, plan: noPlan, report: null, stack: null,
  flags: { aiOff: false, ask: false, founder: false }, ...over,
});

const who = (p = profile()) => ({ profile: p, persona: personaFor(p) });

describe("fuelView (the web's Fuel)", () => {
  it("shows vitamin D in IU and every other nutrient as a share of a woman's need", () => {
    const v = fuelView(who(), data());
    // Female allowances (ICMR-NIN 2020, lib/domain/nutrition.ts): iron 29 mg, calcium 1000 mg.
    assert.deepEqual(v.micros.find((m) => m.label === "Iron"), { label: "Iron", pct: 50 });
    assert.deepEqual(v.micros.find((m) => m.label === "Calcium"), { label: "Calcium", pct: 25 });
    assert.deepEqual(v.micros.find((m) => m.label === "Vitamin D"), { label: "Vitamin D", iu: 40 });
    assert.deepEqual(v.micros.find((m) => m.label === "Zinc"), { label: "Zinc", pct: 0 }, "a nutrient no meal names counts as none");
    assert.equal(v.micros.length, 8);
  });

  it("adds up today's meals and lists them as the web's meal rows", () => {
    const v = fuelView(who(), data({ logs: [log(), log({ id: "m2", kcal: 250, proteinG: 20, carbsG: 10, fatG: 5, fibreG: 2, micros: {} })] }));
    assert.deepEqual(v.totals, { kcal: 650, proteinG: 35, carbsG: 70, fatG: 15, fibreG: 10 });
    assert.deepEqual(v.logs[0], {
      id: "m1", meal: "lunch", title: "Dal and two rotis", source: "text", kcal: 400, proteinG: 15, confidence: "medium", tip: "Add curd.",
      items: ["Dal, 1 bowl", "Roti, 2"], demo: false,
    });
    assert.equal(v.logs[1].tip, null);
  });

  it("no usual day: none shown; a usual day shows its words, patterns and whether it's too light", () => {
    assert.equal(fuelView(who(), data()).typical, null);
    const base = { userId: "u1", description: "Poha, dal chawal, roti sabzi", estimate: { patterns: ["Light on protein at breakfast."], meals: [] }, model: "mock", updatedAt: new Date() };
    assert.deepEqual(fuelView(who(), data({ base, picture: picture({ usualDayShort: true }) })).typical, {
      description: "Poha, dal chawal, roti sabzi", patterns: ["Light on protein at breakfast."], short: true,
    });
    assert.equal(fuelView(who(), data({ base })).typical!.short, false);
  });

  it("gaps: none without data; otherwise the four lowest, never vitamin D", () => {
    const gaps = [
      { key: "vitamin_d_iu", label: "Vitamin D", pct: 5, iu: 30 },
      { key: "iron_mg", label: "Iron", pct: 20 },
      { key: "calcium_mg", label: "Calcium", pct: 30 },
      { key: "protein", label: "Protein", pct: 40 },
      { key: "fibre", label: "Fibre", pct: 50 },
      { key: "zinc_mg", label: "Zinc", pct: 60 },
    ] as FuelData["picture"]["gaps"];
    assert.deepEqual(fuelView(who(), data({ picture: picture({ gaps }) })).gaps, [], "source none hides gaps even if some were worked out");
    assert.deepEqual(fuelView(who(), data({ picture: picture({ source: "logs", gaps }) })).gaps, [
      { label: "Iron", pct: 20 }, { label: "Calcium", pct: 30 }, { label: "Protein", pct: 40 }, { label: "Fibre", pct: 50 },
    ]);
    assert.equal(fuelView(who(), data({ picture: picture({ source: "typical_day", gaps }) })).gapSource, "typical_day");
  });

  it("offers a stack from meals only with enough food, no report and no stack", () => {
    const enough = picture({ source: "logs" });
    assert.equal(fuelView(who(), data({ picture: enough })).stackReady, true);
    assert.equal(fuelView(who(), data({ picture: picture() })).stackReady, false, "not enough food");
    assert.equal(fuelView(who(), data({ picture: enough, report: { id: "r1" } as FuelData["report"] })).stackReady, false, "a report is read");
    assert.equal(fuelView(who(), data({ picture: enough, stack: { id: "s1" } as FuelData["stack"] })).stackReady, false, "a stack exists");
  });

  it("passes the settings flags, the language and the plan through untouched, and picks facts for this person", () => {
    const v = fuelView(who(profile({ language: "hinglish" })), data({ flags: { aiOff: true, ask: true, founder: true } }));
    assert.deepEqual([v.aiOff, v.ask, v.founder, v.language], [true, true, true, "hinglish"]);
    assert.equal(v.plan, noPlan.view);
    assert.ok(v.facts.length > 0 && v.categories.length > 0);
  });

  it("targets with no height or weight say they're estimated", () => {
    assert.equal(fuelView(who(profile({ heightCm: null, weightKg: null })), data()).targets.estimated, true);
    assert.equal(fuelView(who(), data()).targets.estimated, false);
    assert.equal(fuelView(who(), data()).targets.fibreG, 30);
  });
});

describe("the apps' Fuel (fuelJson)", () => {
  it("each nutrient carries its key, with a share or (vitamin D only) IU, and nothing the apps don't use", () => {
    const p = profile();
    const d = data();
    const j = fuelJson(fuelView(who(p), d), d, p.timezone);
    FuelResponse.parse(j);
    assert.deepEqual(j.micros.find((m) => m.key === "vitamin_d_iu"), { key: "vitamin_d_iu", label: "Vitamin D", pct: null, iu: 40 });
    assert.deepEqual(j.micros.find((m) => m.key === "iron_mg"), { key: "iron_mg", label: "Iron", pct: 50, iu: null });
    for (const k of ["ask", "founder", "facts", "categories", "language", "logs"]) assert.ok(!(k in j), k);
    assert.equal(j.day, "2026-11-26");
  });
});

describe("mealJson", () => {
  it("is the web's meal row plus the time on the person's clock, the moment, and the reply language", () => {
    const j = mealJson(log(), "Asia/Kolkata");
    MealJson.parse(j);
    assert.deepEqual([j.time, j.at, j.lang], ["1:10 pm", "2026-11-26T07:40:00.000Z", "en"]);
    assert.equal(mealJson(log(), "Europe/London").time, "7:40 am");
  });

  it("tags Hinglish as hi-Latn, Devanagari as hi, a mock meal as demo, and falls back to the title's script", () => {
    assert.equal(mealJson(log({ title: "Do roti aur dal", micros: { lang: "hinglish" } }), null).lang, "hi-Latn");
    assert.equal(mealJson(log({ title: "दो रोटी और दाल", micros: { lang: "hi" } }), null).lang, "hi");
    assert.equal(mealJson(log({ title: "दो रोटी और दाल", micros: {} }), null).lang, "hi", "no reply language saved: the script decides");
    assert.equal(mealJson(log({ title: "Two rotis", micros: {} }), null).lang, null);
    assert.equal(mealJson(log({ model: "mock" }), null).demo, true);
  });
});

describe("planJson", () => {
  it("no pass: the counts and blocks as they are, no dates, and no words or price", () => {
    const j = planJson({ ...noPlan, view: { ...noPlan.view, mealBlock: "free_meals_used" } });
    PlanJson.parse(j);
    assert.deepEqual([j.pass, j.queued, j.mealBlock], [null, null, "free_meals_used"]);
    assert.ok(!JSON.stringify(j).includes("₹") && !/free\b(?!_)/i.test(JSON.stringify(j).replace(/"free":/g, "")));
  });

  it("a pass, and one bought ahead: the web's dates beside the moments they stand for", () => {
    const ends = new Date("2026-12-14T10:00:00Z");
    const next = new Date("2027-01-13T10:00:00Z");
    const j = planJson({ view: { ...noPlan.view, pass: { until: "14 Dec 2026" }, queuedUntil: "13 Jan 2027" }, passEndsAt: ends, queuedEndsAt: next });
    assert.deepEqual(j.pass, { until: "14 Dec 2026", endsAt: "2026-12-14T10:00:00.000Z" });
    assert.deepEqual(j.queued, { until: "13 Jan 2027", endsAt: "2027-01-13T10:00:00.000Z" });
  });
});

describe("pastJson", () => {
  it("days with meals, newest first, labelled Yesterday or by date, each day's meals in logged order", () => {
    const logs = [
      log({ id: "a", localDate: "2026-11-24", createdAt: new Date("2026-11-24T03:00:00Z") }),
      log({ id: "b", localDate: "2026-11-25", createdAt: new Date("2026-11-25T03:00:00Z") }),
      log({ id: "c", localDate: "2026-11-24", createdAt: new Date("2026-11-24T14:00:00Z"), meal: "dinner" }),
    ];
    const j = pastJson(who(), { today: "2026-11-26", logs });
    PastMealsResponse.parse(j);
    assert.deepEqual(j.days.map((d) => [d.date, d.label, d.meals.map((m) => m.id)]), [
      ["2026-11-25", "Yesterday", ["b"]],
      ["2026-11-24", "Tue, 24 Nov", ["a", "c"]],
    ]);
    assert.equal(j.days[1].meals[1].time, "7:30 pm");
    assert.deepEqual(pastJson(who(), { today: "2026-11-26", logs: [] }).days, []);
  });
});
