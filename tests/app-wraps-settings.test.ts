// The apps' Wraps (G5, G12), Settings (G6), option lists and remote config, against a real
// database for the signed-in ones and on plain values for the public ones.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, meal, person, type Handler } from "./support/app-people.ts";

const g = globalThis as unknown as { __after: (() => unknown)[] };
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
delete process.env.ANTHROPIC_API_KEY;
process.env.D_HUMAN_AI_MOCK = "1";
Object.assign(process.env, { RAZORPAY_KEY_ID: "rzp_test_wraps", RAZORPAY_KEY_SECRET: "test-secret", RAZORPAY_WEBHOOK_SECRET: "test-webhook" });

const { db, schema } = await import("../lib/db/index.ts");
const { localDate } = await import("../lib/platform/profile.ts");
const { periodRange } = await import("../lib/platform/wraps.ts");
const { configJson, optionsJson, APP_SWITCHES } = await import("../lib/api/views/app.ts");
const options = await import("../lib/domain/options.ts");
const age = await import("../components/platform/age.ts");
const contract = await import("../lib/api/schemas.ts");
const route = await import("../app/api/wraps/route.ts");
const wraps = route.GET as Handler;
const makeWrap = route.POST as Handler;
const settings = (await import("../app/api/settings/route.ts")).GET as Handler;
const optionsRoute = (await import("../app/api/app/options/route.ts")).GET as Handler;
const configRoute = (await import("../app/api/app/config/route.ts")).GET as Handler;

after(async () => {
  await removeDatabase();
});

describe("GET /api/wraps", () => {
  it("the web's five period cards, or weeks only with ?period=week (G5); an older ?week adds that week first", async () => {
    const p = await person("wraps@example.com");
    const all = contract.WrapsResponse.parse((await call(wraps, { token: p.token, url: "https://www.d-human.fit/api/wraps" })).body);
    assert.deepEqual(all.cards.map((c) => c.name), ["This week", "Last week", "This month", "Last month", "This year"]);
    const weeks = contract.WrapsResponse.parse((await call(wraps, { token: p.token, url: "https://www.d-human.fit/api/wraps?period=week" })).body);
    assert.deepEqual(weeks.cards.map((c) => c.key), ["week:0", "week:-1"]);
    const older = periodRange("week", localDate("Asia/Kolkata"), -3).start;
    const asked = contract.WrapsResponse.parse((await call(wraps, { token: p.token, url: `https://www.d-human.fit/api/wraps?period=week&week=${older}` })).body);
    assert.deepEqual(asked.cards.map((c) => [c.key, c.name]), [["week:-3", "Earlier week"], ["week:0", "This week"], ["week:-1", "Last week"]]);
    assert.deepEqual((await call(wraps, { cookie: p.cookie })).body, { error: "bearer_required" });
  });

  it("G12: a marker card that names a flagged result carries the flag; other cards none", async () => {
    const p = await person("wraps-flag@example.com");
    const d = await db();
    const reportId = randomUUID();
    await d.insert(schema.reports).values({ id: reportId, userId: p.id, status: "ready", fileName: "r.pdf" });
    await d.insert(schema.markers).values([
      { id: randomUUID(), reportId, userId: p.id, key: "vitamin_d", name: "25-OH Vitamin D", value: 6, unit: "ng/mL", status: "low", flag: "doctor" },
      { id: randomUUID(), reportId, userId: p.id, key: null, name: "Haemoglobin", value: 6, unit: "g/dL", status: "low", flag: "urgent" },
    ]);
    const { start, end } = periodRange("week", localDate("Asia/Kolkata"), 0);
    await d.insert(schema.wraps).values({
      id: randomUUID(), userId: p.id, period: "week", startsOn: start, endsOn: end, stats: {}, model: "mock",
      story: {
        title: "Your week",
        cards: [
          { kind: "stat", big: "5", label: "days logged", line: "Steady." },
          { kind: "marker", big: "Vit D", label: "from 6 to 9", line: "Vitamin D (25-OH) moved up." },
          { kind: "marker", big: "Hb", label: "Haemoglobin", line: "Haemoglobin is low." },
          { kind: "marker", big: "B12", label: "Vitamin B12", line: "B12 is fine." },
        ],
        one_thing: "Keep going.",
      },
    });
    const body = contract.WrapsResponse.parse((await call(wraps, { token: p.token, url: "https://www.d-human.fit/api/wraps?period=week" })).body);
    assert.deepEqual(body.cards[0].wrap!.cards.map((c) => [c.kind, c.flag]), [["stat", null], ["marker", "doctor"], ["marker", "urgent"], ["marker", null]]);
  });
});

describe("POST /api/wraps from an app", () => {
  it("makes this week's wrap from its meals; nothing to wrap is { empty }; old consent is 409", async () => {
    const p = await person("wrap-make@example.com");
    assert.deepEqual((await call(makeWrap, { token: p.token, body: { period: "week", offset: -2 } })).body, { empty: true });
    await meal(p);
    const r = await call(makeWrap, { token: p.token, body: { period: "week", offset: 0 } });
    assert.equal(r.status, 200);
    const { id } = r.body as { id: string };
    const listed = contract.WrapsResponse.parse((await call(wraps, { token: p.token, url: "https://www.d-human.fit/api/wraps?period=week" })).body);
    assert.equal(listed.cards[0].wrap?.id, id);
    const old = await person("wrap-old@example.com", { consentAt: new Date("2026-11-01T00:00:00Z") });
    assert.equal((await call(makeWrap, { token: old.token, body: { period: "week", offset: 0 } })).body!.error, "consent_needed");
  });
});

describe("GET /api/settings", () => {
  it("the plan, passes with dates and never an amount, the email settings, and the weekly channel (G6)", async () => {
    const p = await person("settings@example.com");
    const d = await db();
    const startsAt = new Date(Date.now() - 86_400_000);
    await d.insert(schema.payments).values({ id: randomUUID(), userId: p.id, orderId: `order_${randomUUID()}`, amount: 4900, currency: "INR", status: "paid", mode: "test", startsAt, endsAt: new Date(startsAt.getTime() + 30 * 86_400_000), paidAt: startsAt });
    const r = await call(settings, { token: p.token });
    const body = contract.SettingsResponse.parse(r.body);
    assert.equal(body.passes.length, 1);
    assert.ok(!r.text.includes("₹") && !r.text.includes("4900") && !r.text.includes("49"), "no amount or price anywhere");
    assert.deepEqual([body.weekly.channel, body.emails.weekly, body.email], ["email", true, p.email]);
    assert.ok(body.plan.pass);
  });
});

describe("GET /api/app/options and /api/app/config", () => {
  it("options: the domain's own lists and labels, ages as the web allows, public for an hour", async () => {
    const r = await call(optionsRoute);
    const body = contract.OptionsResponse.parse(r.body);
    assert.equal(r.res.headers.get("cache-control"), "public, max-age=3600");
    assert.deepEqual(body.activities.map((a) => a.id), options.ACTIVITY_IDS);
    assert.deepEqual(body.conditions.map((c) => [c.id, c.label]), options.CONDITIONS.map((c) => [c.id, c.label]));
    assert.ok(body.conditions.some((c) => c.id === "pregnant"));
    const year = new Date().getFullYear();
    assert.deepEqual(optionsJson(year).birthYears, { min: year - age.MAX_AGE, max: year - age.MIN_AGE }, "the same ages as components/platform/age.ts");
    assert.equal((await call(optionsRoute, { etag: r.res.headers.get("etag")! })).status, 304);
  });

  it("config: switches only ever turn off, unknown names are ignored, links only https; public for 5 minutes", async () => {
    assert.deepEqual(configJson({}).off, []);
    // Any case and spacing counts, so a typo turns a switch off rather than leaving it on (QA, round 2).
    assert.deepEqual(configJson({ APP_SWITCHES_OFF: "doses, voice,teleport,IAP" }).off, ["voice", "iap", "doses"]);
    assert.deepEqual(configJson({ APP_SWITCHES_OFF: APP_SWITCHES.join(",") }).off, [...APP_SWITCHES]);
    assert.deepEqual(contract.APP_SWITCH_NAMES, APP_SWITCHES);
    const c = configJson({ APP_MIN_VERSION_IOS: "1.2.0", APP_STORE_URL_IOS: "https://apps.apple.com/app/id1", APP_PRIVACY_URL: "http://insecure.example" });
    assert.deepEqual([c.minSupported, c.updateUrl, c.links.privacy, c.apiBase], ["1.2.0", "https://apps.apple.com/app/id1", null, "https://www.d-human.fit"]);
    assert.equal(configJson({}).minSupported, "1.0.0");
    const r = await call(configRoute);
    contract.ConfigResponse.parse(r.body);
    assert.equal(r.res.headers.get("cache-control"), "public, max-age=300");
  });
});
