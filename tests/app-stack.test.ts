// The Stack for the apps. stackView (the web page's own derivations) and stackJson (the apps'
// shaping: fits for every slab, no doses when held or out of date, the hold's words) on fixture
// data with no database, against expectations worked out here; then GET /api/stack against a
// real database. The hold words and note splitting are checked against the web's own client code.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, person, type Handler } from "./support/app-people.ts";

const g = globalThis as unknown as { __after: (() => unknown)[] };
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();

const { db, schema } = await import("../lib/db/index.ts");
const { personaFor } = await import("../lib/platform/profile.ts");
const { stackView } = await import("../lib/platform/views/stack.ts");
const { holdLine, splitNote, stackJson } = await import("../lib/api/views/stack.ts");
const web = await import("../components/platform/stack-state.ts");
const contract = await import("../lib/api/schemas.ts");
const stackRoute = (await import("../app/api/stack/route.ts")).GET as Handler;
type StackData = import("../lib/platform/views/stack.ts").StackData;
type Profile = import("../lib/db/schema.ts").Profile;

after(async () => {
  await removeDatabase();
});

const profile = (over: Partial<Profile> = {}) =>
  ({ userId: "u1", name: "Ravi", birthYear: 2002, sex: "male", heightCm: 175, weightKg: 70.4, primaryActivity: "gym", activities: ["gym"], level: "regular", goals: [], diet: "veg", conditions: [], medications: null, supplementBudget: "under_1000", timezone: "Asia/Kolkata", ...over }) as Profile;
const who = (p = profile()) => ({ profile: p, persona: personaFor(p) });
const PLAN = {
  items: [
    { nutrient: "Vitamin D3", dose: "1000 IU a day", why: "Low", markers: ["vitamin_d"], form: "Softgel", timing: "With lunch", duration: "12 weeks", rule: "vitamin_d", brands: [{ brand: "Best", product: "D3", monthly_inr: 500 }, { brand: "Cheap", product: "D3", monthly_inr: 300 }] },
    { nutrient: "Magnesium", dose: "200 mg", why: "Food gap", markers: [], form: "Tablet", timing: "Night", duration: "8 weeks", rule: "magnesium", brands: [{ brand: "Mag", product: "Gly", monthly_inr: 900 }] },
  ],
  skip: [{ name: "Biotin", why: "No need." }],
  food_first: ["Dal at lunch."],
  see_doctor: [],
  gaps: [{ key: "magnesium_mg", label: "Magnesium", pct: 40, outcome: "stack", note: "Short.", rule: "magnesium" }],
  inputs: { diet: "veg", medications: null, conditions: [] },
};
const stack = (over: Record<string, unknown> = {}) => ({ id: "s1", userId: "u1", reportId: "r1", status: "ready", plan: PLAN, model: "rules", error: null, createdAt: new Date("2026-11-20T00:00:00Z"), ...over });
const data = (over: Partial<StackData> = {}): StackData => ({
  report: { id: "r1" } as StackData["report"],
  stack: stack() as StackData["stack"],
  picture: null,
  markers: [],
  flags: { aiOff: false, ask: false },
  ...over,
});

describe("stackView (the web's Stack page)", () => {
  it("with no report, no stack and too little food: the two ways to start", () => {
    const v = stackView(who(), data({ report: null, stack: null, picture: { source: "none", fullDays: 1, usualDayShort: true } as StackData["picture"] }));
    assert.deepEqual(v, { state: "start_with_food", fullDays: 1, usualDayShort: true });
    const enough = stackView(who(), data({ report: null, stack: null, picture: { source: "logs", fullDays: 3, usualDayShort: false } as StackData["picture"] }));
    assert.equal(enough.state, "stack", "enough food: the build button, from meals");
    assert.deepEqual(enough.state === "stack" && [enough.basis, enough.stack, enough.hasReport], ["meals", null, false]);
  });

  it("out of date: a newer report than the stack's, or a meals stack once a report is read; or changed health answers", () => {
    const newer = stackView(who(), data({ report: { id: "r2" } as StackData["report"] }));
    assert.equal(newer.state === "stack" && newer.staleReason, "report");
    const meals = stackView(who(), data({ stack: stack({ reportId: null }) as StackData["stack"] }));
    assert.deepEqual(meals.state === "stack" && [meals.basis, meals.staleReason], ["meals", "report"]);
    const vegan = stackView(who(profile({ diet: "vegan" })), data());
    assert.equal(vegan.state === "stack" && vegan.staleReason, "profile");
    const same = stackView(who(), data());
    assert.equal(same.state === "stack" && same.staleReason, null);
  });

  it("flags come from the newest report's markers; an urgent one holds the stack, else pregnancy does", () => {
    const markers = [{ key: "vitamin_d", name: "Vit D printed", flag: "doctor" }, { key: null, name: "Haemoglobin (printed)", flag: "urgent" }, { key: "ferritin", name: "F", flag: null }];
    const v = stackView(who(), data({ markers }));
    assert.deepEqual(v.state === "stack" && [v.flagged, v.hold], [[{ name: "Vitamin D (25-OH)", urgent: false }, { name: "Haemoglobin (printed)", urgent: true }], "urgent"]);
    const pregnant = stackView(who(profile({ conditions: ["pregnant"] })), data({ markers: [markers[0]] }));
    assert.equal(pregnant.state === "stack" && pregnant.hold, "pregnant");
  });

  it("the body line, the marker names, the budget and the flags pass through", () => {
    const v = stackView(who(), data({ flags: { aiOff: true, ask: true } }));
    assert.ok(v.state === "stack");
    // Age, height and weight rounded, with no-break spaces, then the persona's label in lower case.
    assert.equal(v.body, `${new Date().getFullYear() - 2002}, 175\u00a0cm, 70\u00a0kg, ${personaFor(profile()).label.toLowerCase()}`);
    assert.deepEqual(v.markerNames, { vitamin_d: "Vitamin D (25-OH)" });
    assert.deepEqual([v.budget, v.aiOff, v.ask], ["under_1000", true, true]);
  });
});

describe("stackJson (the apps' Stack)", () => {
  it("a stack to show: the plan, and a fit for every budget slab worked out as the web's budget does", () => {
    const j = stackJson(stackView(who(), data()));
    contract.StackResponse.parse(j);
    assert.ok(j.state === "stack" && j.fits && j.stack?.plan);
    assert.deepEqual(Object.keys(j.fits).sort(), ["1000_2000", "2000_3000", "3000_4000", "4000_5000", "5000_plus", "not_sure", "under_1000"]);
    // Under ₹1,000: vitamin D at its cheapest (300), magnesium (900) waits; then D upgrades to the best brand (500).
    assert.deepEqual(j.fits.under_1000, { included: [0], later: [1], pick: [0, null], cost: [500, null], typical: [false, false], total: 500, cap: 1000 });
    // ₹1,000–2,000: both, then D upgrades: 500 + 900.
    assert.deepEqual([j.fits["1000_2000"].included, j.fits["1000_2000"].total], [[0, 1], 1400]);
    assert.equal(j.fits.not_sure.cap, null);
    assert.equal(j.stack.plan.items[0].brands[1].monthlyInr, 300);
    assert.deepEqual(j.stack.plan.gaps[0], { key: "magnesium_mg", label: "Magnesium", pct: 40, iu: null, outcome: "stack", note: "Short.", lead: "Short.", more: null, rule: "magnesium" });
    assert.equal(j.holdLine, null);
  });

  it("held or out of date: no plan and no fits anywhere in the answer, and the hold's words", () => {
    const urgent = stackJson(stackView(who(), data({ markers: [{ key: null, name: "Haemoglobin", flag: "urgent" }, { key: null, name: "Platelets", flag: "urgent" }] })));
    contract.StackResponse.parse(urgent);
    assert.ok(urgent.state === "stack");
    assert.deepEqual([urgent.stack?.plan, urgent.fits], [null, null]);
    assert.equal(urgent.holdLine, "Haemoglobin and Platelets need medical advice today, so we've held your stack until a doctor has seen them.");
    assert.ok(!JSON.stringify(urgent).includes("1000 IU"), "no dose reaches the phone");
    const pregnant = stackJson(stackView(who(profile({ conditions: ["pregnant"] })), data()));
    assert.ok(pregnant.state === "stack");
    assert.deepEqual([pregnant.stack?.plan, pregnant.holdLine], [null, "You're pregnant or breastfeeding, so we've held your stack: take nothing new without your doctor."]);
    const stale = stackJson(stackView(who(profile({ diet: "vegan" })), data()));
    assert.ok(stale.state === "stack");
    assert.deepEqual([stale.staleReason, stale.stack?.plan, stale.fits, stale.holdLine], ["profile", null, null, null]);
    assert.equal(holdLine("urgent", ["Haemoglobin"]), "Haemoglobin needs medical advice today, so we've held your stack until a doctor has seen it.");
  });

  it("the hold's words and the note split are the web's own (components/platform/Stack.tsx, stack-state.ts)", () => {
    const src = readFileSync(new URL("../components/platform/Stack.tsx", import.meta.url), "utf8");
    for (const words of ["needs\"} medical advice today, so we've held your stack until a doctor has seen ${", "You're pregnant or breastfeeding, so we've held your stack: take nothing new without your doctor.", 'const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);'])
      assert.ok(src.includes(words), words);
    const long = "Food gives little vitamin D, so only a blood test shows if you're low. A 60,000 IU sachet a week is a common dose but stacking it with a daily one can go too high, so ask first.";
    for (const note of ["Short.", long, "x".repeat(150), "पहला वाक्य यहाँ बहुत लंबा है और चलता रहता है ताकि एक सौ चालीस अक्षर पार हो जाएँ और विभाजन हो। दूसरा वाक्य यहाँ है जो बाकी हिस्सा है और पीछे छिपा रहेगा।"])
      assert.deepEqual(splitNote(note), web.splitNote(note), note.slice(0, 20));
  });
});

describe("GET /api/stack", () => {
  it("a ready stack with its fits; an urgent result holds it with no doses; a cookie gets 403; 304 to its ETag", async () => {
    const p = await person("stack@example.com", { supplementBudget: "1000_2000", healthCheckedAt: new Date() });
    const d = await db();
    await d.insert(schema.stacks).values({ id: randomUUID(), userId: p.id, reportId: null, status: "ready", plan: { ...PLAN, inputs: { diet: "veg", medications: null, conditions: [] } }, model: "rules" });
    const r = await call(stackRoute, { token: p.token });
    const body = contract.StackResponse.parse(r.body);
    assert.ok(body.state === "stack" && body.stack?.plan && body.fits);
    assert.deepEqual([body.basis, body.budget, body.fits["1000_2000"].total], ["meals", "1000_2000", 1400]);
    assert.equal((await call(stackRoute, { token: p.token, etag: r.res.headers.get("etag")! })).status, 304);
    assert.deepEqual((await call(stackRoute, { cookie: p.cookie })).body, { error: "bearer_required" });

    const reportId = randomUUID();
    await d.insert(schema.reports).values({ id: reportId, userId: p.id, status: "ready", fileName: "r.pdf", model: "mock" });
    await d.insert(schema.markers).values({ id: randomUUID(), reportId, userId: p.id, key: null, name: "Haemoglobin", value: 6, unit: "g/dL", status: "low", flag: "urgent" });
    const held = contract.StackResponse.parse((await call(stackRoute, { token: p.token })).body);
    assert.ok(held.state === "stack");
    assert.deepEqual([held.hold, held.stack?.plan, held.fits, held.staleReason], ["urgent", null, null, "report"]);
    assert.match(held.holdLine!, /^Haemoglobin needs medical advice today/);

    const fresh = await person("stack-fresh@example.com");
    assert.deepEqual((await call(stackRoute, { token: fresh.token })).body, { state: "start_with_food", fullDays: 0, usualDayShort: false });
  });
});
