// QA's attack on the apps' backend (lane 1B, 2026-11-26), against a real database through the
// real route handlers: every app route is found from the contract (lib/api/openapi.ts), so a
// route added later is attacked too.
//
// - Two people: A's data is full of canaries; B calls every app GET, and every [id] route with
//   A's ids. Nothing of A's comes back, a foreign id answers as a missing one, and A's ETag
//   never earns B a 304.
// - B writes on A's meal (Log again, slot, delete) and A's data doesn't move.
// - The meal limits hold through Log again, eatenAt and slot changes, in parallel too.
// - The safety floor: held or out-of-date stacks carry no dose; the urgent hold reaches
//   /api/me; the health question can't be skipped or set any other way.
// - consent_needed: every app write is gated, or on a short, reviewed list of exempt ones.
// - The store token is per person and never shows anywhere else.
// - Every word the apps are sent stays off the website (App Store guideline 3.1.1).
// - The committed demo fixtures hold demo data only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, meal, person, type Handler, type Person } from "./support/app-people.ts";

type G = { __after: (() => unknown)[]; __headers?: Headers; __cookie?: string };
const g = globalThis as unknown as G;
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/email/jobs": "export const sendWelcome = async () => {};",
  "@/lib/sheets/users": "export const pushUserRow = async () => {}; export const forgetUserRow = async () => {}; export const queueUserForget = async () => {};",
});
const removeDatabase = tempDatabase();
delete process.env.ANTHROPIC_API_KEY;
for (const k of ["APP_SWITCHES_OFF", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "BLOG_OWNER_EMAILS"]) delete process.env[k];
process.env.D_HUMAN_AI_MOCK = "1";

const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { localDate } = await import("../lib/platform/profile.ts");
const { addDays } = await import("../lib/domain/periods.ts");
const { APP_ROUTES } = await import("../lib/api/openapi.ts");
const { APP_MEAL_ERRORS, APP_REFUSALS } = await import("../lib/api/errors.ts");
const { NOT_FOR_APP_WORDS } = await import("../lib/auth/app-token.ts");
const { SIGN_IN_WORDS } = await import("../lib/auth/sign-in-words.ts");

after(async () => {
  await removeDatabase();
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.d-human.fit";
const TZ = "Asia/Kolkata";
const today = () => localDate(TZ);
const handlers = new Map<string, Handler>();
for (const r of APP_ROUTES) handlers.set(`${r.method} ${r.path}`, (await import(`../${r.file}`))[r.method.toUpperCase()] as Handler);
const route = (method: string, p: string) => handlers.get(`${method} ${p}`)!;
const runAfter = async () => {
  for (const j of g.__after.splice(0)) await j();
};

// Every message any app answer carried in this file, for the words check at the end.
const messages = new Set<string>();
async function hit(method: string, p: string, o: Parameters<typeof call>[1] & { id?: string; query?: string } = {}) {
  const url = `${SITE}${p.replace(/\{(id|publicId)\}/, o.id ?? "x")}${o.query ?? ""}`;
  const r = await call(route(method, p), { method: method.toUpperCase(), ...o, url, params: o.id ? { [p.includes("publicId") ? "publicId" : "id"]: o.id } : undefined });
  if (typeof r.body?.message === "string") messages.add(r.body.message);
  return r;
}
const form = (f: Record<string, string>) => Object.entries(f).reduce((fd, [k, v]) => (fd.append(k, v), fd), new FormData());
let keyN = 0;
const key = () => `qa-backend-key-${String(++keyN).padStart(6, "0")}`;
const logText = (p: Person, extra: Record<string, string> = {}) => hit("post", "/api/food", { token: p.token, form: form({ text: "two rotis and dal", source: "text", key: key(), ...extra }) });
const again = (p: Person, id: string, body: Record<string, unknown> = {}) => hit("post", "/api/food/{id}/again", { token: p.token, id, body: { key: key(), ...body } });

async function mealUses(p: Person) {
  const d = await db();
  return d.select().from(schema.usage).where(and(eq(schema.usage.userId, p.id), eq(schema.usage.kind, "meal")));
}
async function mealRows(p: Person) {
  const d = await db();
  return d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id));
}
/** `n` meal uses already counted on `day`, as the ledger would hold them for meals logged then. */
async function usedOn(p: Person, day: string, n: number) {
  const d = await db();
  for (let i = 0; i < n; i++) await d.insert(schema.usage).values({ id: randomUUID(), userId: p.id, kind: "meal", refId: randomUUID(), localDate: day });
}

// ── The two people ───────────────────────────────────────────────────────────

const C = "CANARYA";
const DOSE = "CANARYDOSE 2000 IU a day";
async function readReport(p: Person, o: { tag: string; flag?: "doctor" | "urgent"; at?: Date }) {
  const d = await db();
  const id = randomUUID();
  const markerId = randomUUID();
  await d.insert(schema.reports).values({ id, userId: p.id, status: "ready", fileName: `${o.tag}.pdf`, labName: `${o.tag} Labs`, nameOnReport: `${o.tag} Printed`, collectedOn: "2026-11-02", model: "mock", analyzedAt: new Date(), createdAt: o.at ?? new Date() });
  await d.insert(schema.markers).values({ id: markerId, reportId: id, userId: p.id, key: "vitamin_d", name: `${o.tag} Vitamin D`, value: 12, unit: "ng/mL", refLow: 30, refHigh: 100, rangeSource: "report", status: "low", flag: o.flag ?? null, position: 0 });
  await d.insert(schema.analyses).values({
    reportId: id,
    userId: p.id,
    read: {
      headline: `${o.tag} headline`,
      summary: `${o.tag} summary`,
      verdict: { level: o.flag ? "doctor_first" : "go_with_tweaks", line: `${o.tag} verdict`, detail: `${o.tag} detail` },
      focus: [{ marker_key: "vitamin_d", title: `${o.tag} focus`, why: `${o.tag} why`, action: `${o.tag} action` }],
      markers: [{ id: markerId, note: `${o.tag} note` }],
      wins: [`${o.tag} win`],
      doctor_questions: [`${o.tag} question`],
      retest: { weeks: 12, markers: ["vitamin_d"], why: `${o.tag} retest` },
      test_tips: [`${o.tag} tip`],
    },
  });
  return id;
}
async function readyStack(p: Person, reportId: string | null, o: { diet?: string; at?: Date } = {}) {
  const d = await db();
  const id = randomUUID();
  await d.insert(schema.stacks).values({
    id,
    userId: p.id,
    reportId,
    status: "ready",
    model: "rules",
    createdAt: o.at ?? new Date(),
    plan: {
      items: [{ nutrient: "Vitamin D3", dose: DOSE, why: `${C} why`, markers: ["vitamin_d"], form: "Softgel", timing: "With lunch", duration: "12 weeks", rule: "vitamin_d", brands: [{ brand: "Brand", product: "D3", monthly_inr: 300 }] }],
      skip: [],
      food_first: [`${C} food first`],
      see_doctor: [],
      gaps: [],
      inputs: { diet: o.diet ?? "veg", medications: null, conditions: [] },
    },
  });
  return id;
}

const A = await person("canarya@example.com", {
  name: `${C} Name`,
  city: `${C}City`,
  medications: `${C} metformin`,
  currentSupplements: `${C} supplements`,
  eventInMind: `${C} marathon`,
  healthCheckedAt: new Date(),
});
const B = await person("plainb@example.com", { name: "Bina", sex: "male", birthYear: 1980, heightCm: 182, weightKg: 90, activities: ["strength"], primaryActivity: "strength", diet: "nonveg", city: "Patna" });
const aMeal = await meal(A, { title: `${C} dal`, slot: "lunch", micros: { iron_mg: 3, tip: `${C} tip`, lang: "en" } });
const aPast = await meal(A, { title: `${C} poha`, daysAgo: 2, slot: "breakfast" });
await meal(B, { title: "Rajma rice", daysAgo: 1, slot: "dinner" });
const aReport = await readReport(A, { tag: C });
await readReport(B, { tag: "BEE" });
const aStack = await readyStack(A, aReport);
{
  const d = await db();
  await d.insert(schema.dietBaselines).values({ userId: A.id, description: `${C} usual day`, estimate: { meals: [], micros: {}, patterns: [`${C} pattern`] }, model: "mock" });
  const { start, end } = { start: addDays(today(), -6), end: today() };
  await d.insert(schema.wraps).values({ id: randomUUID(), userId: A.id, period: "week", startsOn: start, endsOn: end, stats: {}, story: { title: `${C} wrap`, cards: [{ kind: "marker", big: "12", label: `${C} card`, line: `${C} line` }], one_thing: `${C} one thing` }, model: "mock" });
}
const aStoreToken = (await hit("post", "/api/billing/store-token", { token: A.token, body: {} })).body!.appAccountToken as string;
const aSessions = (await hit("get", "/api/me/sessions", { token: A.token })).body!.sessions as { publicId: string }[];

const GETS = APP_ROUTES.filter((r) => r.method === "get" && r.auth === "bearer");
const aSecrets = [C, A.id, A.email, aMeal, aPast, aReport, aStack, aStoreToken, A.token, ...aSessions.map((s) => s.publicId)];

describe("one person's data never reaches another (T1, tests 26, 27, 34)", () => {
  it("B calls every app GET, with A's ids where a path takes one: nothing of A's, private every time", async () => {
    assert.ok(GETS.length >= 14, "the contract lists the apps' reads");
    for (const r of GETS) {
      const ids = r.path.includes("{publicId}") ? [aSessions[0].publicId] : r.path.includes("{id}") ? [aReport, aStack, aMeal] : [undefined];
      for (const id of ids)
        for (const query of r.path === "/api/wraps" ? ["", "?period=week", `?week=${addDays(today(), -6)}`] : [""]) {
          const res = await hit("get", r.path, { token: B.token, id, query });
          for (const s of aSecrets) assert.ok(!res.text.includes(s), `GET ${r.path}${query} (${id ?? "no id"}) as B carries A's ${s === C ? "canary" : "id"}`);
          assert.equal(res.res.headers.get("cache-control"), r.publicFor ? `public, max-age=${r.publicFor}` : "private, no-store", r.path);
          assert.equal(res.res.headers.get("set-cookie"), null, r.path);
        }
    }
  });

  it("an [id] route answers B with A's id exactly as with an id that was never made", async () => {
    for (const r of GETS.filter((x) => /\{(id|publicId)\}/.test(x.path))) {
      const theirs = r.path.includes("publicId") ? aSessions[0].publicId : r.path.startsWith("/api/stack") ? aStack : aReport;
      const a = await hit("get", r.path, { token: B.token, id: theirs });
      const none = await hit("get", r.path, { token: B.token, id: randomUUID() });
      assert.deepEqual([a.status, a.text], [none.status, none.text], r.path);
      assert.equal(a.status, 404, r.path);
    }
  });

  it("A's ETag never earns B a 304, on any read; A's own does", async () => {
    for (const r of GETS.filter((x) => !/\{/.test(x.path))) {
      const mine = await hit("get", r.path, { token: A.token });
      const tag = mine.res.headers.get("etag");
      if (!tag) continue;
      assert.equal((await hit("get", r.path, { token: A.token, etag: tag })).status, 304, `${r.path}: A's own tag`);
      const theirs = await hit("get", r.path, { token: B.token, etag: tag });
      assert.equal(theirs.status, 200, `${r.path}: B with A's tag`);
      assert.notEqual(theirs.res.headers.get("etag"), tag, r.path);
    }
  });

  it("B's writes on A's meal and A's device change nothing of A's, and answer as for a missing one", async () => {
    const before = JSON.stringify((await mealRows(A)).map((m) => [m.id, m.meal, m.localDate]).sort());
    const usesBefore = (await mealUses(A)).length;
    const pairs: [string, string, Record<string, unknown> | undefined][] = [
      ["post", "/api/food/{id}/again", { key: key() }],
      ["post", "/api/food/{id}/slot", { meal: "dinner" }],
      ["delete", "/api/food/{id}", undefined],
    ];
    for (const [method, p, body] of pairs) {
      const a = await hit(method, p, { token: B.token, id: aMeal, body });
      const none = await hit(method, p, { token: B.token, id: randomUUID(), body: body && "key" in body ? { key: key() } : body });
      assert.deepEqual([a.status, a.body], [none.status, none.body], p);
    }
    const s = await hit("delete", "/api/me/sessions/{publicId}", { token: B.token, id: aSessions[0].publicId });
    assert.equal(s.status, 404);
    assert.equal((await hit("get", "/api/me", { token: A.token })).status, 200, "A is still signed in");
    assert.equal(JSON.stringify((await mealRows(A)).map((m) => [m.id, m.meal, m.localDate]).sort()), before);
    assert.equal((await mealUses(A)).length, usesBefore);
    assert.equal((await mealRows(B)).length, 1, "nothing was logged for B from A's meal");
  });

  it("the store token is A's alone: the same every time, not the user id, and B's is another", async () => {
    assert.match(aStoreToken, /^[0-9a-f-]{36}$/);
    assert.notEqual(aStoreToken, A.id);
    assert.equal((await hit("post", "/api/billing/store-token", { token: A.token, body: {} })).body!.appAccountToken, aStoreToken);
    const b = (await hit("post", "/api/billing/store-token", { token: B.token, body: {} })).body!.appAccountToken;
    assert.ok(b && b !== aStoreToken);
    // And no read ever carries it (the sweep above looked for A's as B; here, A's own reads).
    for (const r of GETS.filter((x) => !/\{/.test(x.path))) assert.ok(!(await hit("get", r.path, { token: A.token })).text.includes(aStoreToken), r.path);
  });
});

describe("the meal limits hold through Log again, eatenAt and slot changes", () => {
  it("5 a day: Log again, a backdated time today and a slot change can't make a sixth; a delete doesn't hand one back", async () => {
    const p = await person("five-a-day@example.com");
    const source = await meal(p, { title: "Idli", daysAgo: 1, slot: "breakfast" });
    for (let i = 0; i < 3; i++) assert.equal((await logText(p)).status, 200);
    assert.equal((await again(p, source)).status, 200);
    const fifth = await logText(p, { eatenAt: new Date(Date.now() - 30 * 60_000).toISOString() });
    assert.equal(fifth.status, 200);
    const todays = (await mealRows(p)).filter((m) => m.localDate === today());
    assert.equal(todays.length, 5);
    // Moving meals between slots frees nothing.
    for (const m of todays) assert.equal((await hit("post", "/api/food/{id}/slot", { token: p.token, id: m.id, body: { meal: "snack" } })).status, 200);
    const refusals = [
      await again(p, source),
      await again(p, source, { eatenAt: new Date(Date.now() - 60 * 60_000).toISOString(), meal: "dinner" }),
      await logText(p),
      await logText(p, { eatenAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() }),
      await logText(p, { meal: "snack" }),
    ];
    for (const r of refusals) assert.deepEqual([r.status, r.body!.refusal], [402, "meals_today_used"]);
    assert.equal((await hit("delete", "/api/food/{id}", { token: p.token, id: todays[0].id })).status, 200);
    assert.equal((await again(p, source)).status, 402, "a deleted meal still counts");
    assert.equal((await logText(p)).status, 402);
    assert.equal((await mealUses(p)).filter((u) => u.localDate === today()).length, 5);
  });

  it("parallel Log again with new keys at 4 of 5: exactly one gets through", async () => {
    const p = await person("parallel-again@example.com");
    const source = await meal(p, { title: "Upma", daysAgo: 1 });
    await usedOn(p, today(), 4);
    const rs = await Promise.all(Array.from({ length: 6 }, () => again(p, source)));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 402, 402, 402, 402, 402]);
    assert.equal((await mealUses(p)).filter((u) => u.localDate === today()).length, 5);
  });

  it("backdating counts on the day eaten, whose own 5 hold; past 48 hours or ahead of the clock is refused", async () => {
    const p = await person("backdate@example.com");
    const source = await meal(p, { title: "Paratha", daysAgo: 0 });
    // 26 hours ago is yesterday in IST at any time of day.
    const yesterdayAt = new Date(Date.now() - 26 * 60 * 60_000);
    const yesterday = localDate(TZ, yesterdayAt);
    await usedOn(p, yesterday, 4);
    assert.equal((await logText(p, { eatenAt: yesterdayAt.toISOString() })).status, 200);
    for (const r of [await logText(p, { eatenAt: yesterdayAt.toISOString() }), await again(p, source, { eatenAt: yesterdayAt.toISOString() })])
      assert.deepEqual([r.status, r.body!.refusal], [402, "meals_today_used"], "yesterday is full");
    // Today is untouched by yesterday's.
    assert.equal((await logText(p)).status, 200);
    for (const at of [new Date(Date.now() - 49 * 60 * 60_000), new Date(Date.now() + 6 * 60_000)]) {
      assert.deepEqual([(await logText(p, { eatenAt: at.toISOString() })).status], [400]);
      assert.deepEqual([(await again(p, source, { eatenAt: at.toISOString() })).status], [400]);
    }
    for (const bad of ["yesterday", "2026-11-25", "2026-11-25T10:00:00", "1e12"]) assert.equal((await logText(p, { eatenAt: bad })).status, 400, bad);
    const uses = await mealUses(p);
    assert.deepEqual([uses.filter((u) => u.localDate === yesterday).length, uses.filter((u) => u.localDate === today()).length], [5, 1]);
  });

  it("the 20 you start with: Log again, backdating and deletes can't make a 21st", async () => {
    const p = await person("twenty@example.com");
    const source = await meal(p, { title: "Khichdi", daysAgo: 3 });
    for (let day = 3; day <= 6; day++) await usedOn(p, addDays(today(), -day), 5);
    await usedOn(p, addDays(today(), -1), 0);
    assert.equal((await mealUses(p)).length, 20);
    for (const r of [await again(p, source), await logText(p), await logText(p, { eatenAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString() })])
      assert.deepEqual([r.status, r.body!.refusal], [402, "free_meals_used"]);
    assert.equal((await mealUses(p)).length, 20);
  });
});

describe("the safety floor", () => {
  const noDose = (text: string, what: string) => {
    assert.ok(!text.includes("CANARYDOSE"), `${what}: a dose reached the phone`);
    assert.ok(!/"fits":\{/.test(text), `${what}: budget fits reached the phone`);
  };

  it("an urgent result holds the stack with no dose, and the hold reaches /api/me and Home", async () => {
    const p = await person("urgent-hold@example.com", { healthCheckedAt: new Date() });
    const r = await readReport(p, { tag: "URG", flag: "urgent" });
    await readyStack(p, r);
    const s = await hit("get", "/api/stack", { token: p.token });
    noDose(s.text, "urgent");
    assert.equal(s.body!.hold, "urgent");
    assert.ok(String(s.body!.holdLine).includes("medical advice today"));
    assert.equal((await hit("get", "/api/me", { token: p.token })).body!.hold, "urgent");
    const home = await hit("get", "/api/home", { token: p.token });
    assert.ok(!home.text.includes("CANARYDOSE"));
  });

  it("pregnancy, a newer report, or changed health answers: no dose either", async () => {
    const pregnant = await person("pregnant-hold@example.com", { conditions: ["pregnant"], healthCheckedAt: new Date() });
    await readyStack(pregnant, await readReport(pregnant, { tag: "PRG" }));
    const ps = await hit("get", "/api/stack", { token: pregnant.token });
    noDose(ps.text, "pregnant");
    assert.equal(ps.body!.hold, "pregnant");
    assert.equal((await hit("get", "/api/me", { token: pregnant.token })).body!.hold, "pregnant");

    const newer = await person("newer-report@example.com", { healthCheckedAt: new Date() });
    await readyStack(newer, await readReport(newer, { tag: "OLD", at: new Date(Date.now() - 86_400_000) }), { at: new Date(Date.now() - 86_000_000) });
    await readReport(newer, { tag: "NEW" });
    const ns = await hit("get", "/api/stack", { token: newer.token });
    noDose(ns.text, "newer report");
    assert.equal(ns.body!.staleReason, "report");

    const changed = await person("changed-diet@example.com", { diet: "vegan", healthCheckedAt: new Date() });
    await readyStack(changed, await readReport(changed, { tag: "CHG" }), { diet: "veg" });
    const cs = await hit("get", "/api/stack", { token: changed.token });
    noDose(cs.text, "changed diet");
    assert.equal(cs.body!.staleReason, "profile");

    // The control: the same stack, current, does carry its dose.
    const fine = await person("current-stack@example.com", { healthCheckedAt: new Date() });
    await readyStack(fine, await readReport(fine, { tag: "OK" }));
    assert.ok((await hit("get", "/api/stack", { token: fine.token })).text.includes("CANARYDOSE"));
  });

  it("the health question can't be skipped: no build without it, and nothing but a full answer sets it", async () => {
    const p = await person("health-skip@example.com");
    await readReport(p, { tag: "HQ" });
    const d = await db();
    const stacks = async () => (await d.select().from(schema.stacks).where(eq(schema.stacks.userId, p.id))).length;
    const healthAt = async () => (await d.select().from(schema.profiles).where(eq(schema.profiles.userId, p.id)))[0].healthCheckedAt;
    const build = async () => hit("post", "/api/stack", { token: p.token, body: {} });
    assert.deepEqual([(await build()).status, (await build()).body!.error], [409, "health_check_needed"]);
    // Ways to set it that must not work.
    const tries: Record<string, unknown>[] = [
      { healthCheckedAt: new Date().toISOString(), health_checked_at: new Date().toISOString() },
      { healthChecked: true },
      { healthChecked: true, conditions: [] },
      { healthChecked: true, medications: null },
      { healthChecked: "true", conditions: [], medications: null },
      { healthChecked: 1, conditions: [], medications: null },
      { conditions: [], medications: null, complete: true },
    ];
    for (const body of tries) {
      await hit("post", "/api/profile", { token: p.token, body });
      assert.equal(await healthAt(), null, JSON.stringify(body));
    }
    // The web's save never sets it, whatever it sends.
    g.__cookie = p.cookie;
    g.__headers = new Headers({ origin: SITE });
    await call(route("post", "/api/profile"), { cookie: p.cookie, origin: SITE, body: { healthChecked: true, conditions: [], medications: null } });
    g.__cookie = undefined;
    assert.equal(await healthAt(), null, "from the web");
    assert.equal((await build()).status, 409);
    assert.equal(await stacks(), 0);
    assert.equal((await hit("post", "/api/profile", { token: p.token, body: { healthChecked: true, conditions: [], medications: null } })).status, 200);
    assert.ok(await healthAt());
    assert.equal((await build()).status, 200);
    await runAfter();
  });
});

describe("consent_needed can't be gone around", () => {
  // App writes that don't ask for current consent, each for a reason: signing out, deleting the
  // account or a meal or a device (always allowed), saving the profile (the consent step itself),
  // and the store token (it sends nothing to an AI and writes no health data).
  const EXEMPT = new Set(["post /api/auth/signout", "post /api/account/delete", "delete /api/me/sessions/{publicId}", "post /api/profile", "delete /api/food/{id}", "post /api/billing/store-token"]);

  it("every app write is either consent-gated or on the reviewed exempt list", () => {
    const writes = APP_ROUTES.filter((r) => r.method !== "get" && r.auth === "bearer");
    for (const r of writes) assert.ok(r.consent || EXEMPT.has(`${r.method} ${r.path}`), `${r.method} ${r.path} writes without asking for current consent`);
  });

  it("each gated write answers 409 consent_needed for old consent and writes nothing; agreeing again opens it", async () => {
    const p = await person("old-consent-qa@example.com", { consentAt: new Date("2026-11-01T00:00:00Z"), healthCheckedAt: new Date() });
    const source = await meal(p, { title: "Dosa", daysAgo: 1 });
    await readReport(p, { tag: "OLDC" });
    const d = await db();
    const counts = async () =>
      Promise.all([schema.foodLogs, schema.stacks, schema.wraps, schema.dietBaselines, schema.usage].map(async (t) => (await d.select().from(t).where(eq(t.userId, p.id))).length));
    const before = await counts();
    const bodies: Record<string, { body?: Record<string, unknown>; form?: FormData; id?: string }> = {
      "post /api/food": { form: form({ text: "dal", source: "text", key: key() }) },
      "post /api/food/{id}/again": { id: source, body: { key: key() } },
      "post /api/food/{id}/slot": { id: source, body: { meal: "dinner" } },
      "post /api/food/typical": { body: { description: "Poha for breakfast, dal rice for lunch, roti sabzi for dinner." } },
      "post /api/stack": { body: {} },
      "post /api/wraps": { body: { period: "week", offset: 0 } },
    };
    for (const r of APP_ROUTES.filter((x) => x.consent)) {
      const k = `${r.method} ${r.path}`;
      assert.ok(bodies[k], `${k}: add a request for it here`);
      const res = await hit(r.method, r.path, { token: p.token, ...bodies[k] });
      assert.deepEqual([res.status, res.body!.error], [409, "consent_needed"], k);
    }
    // Saying "I agreed" any other way doesn't count.
    for (const body of [{ consentAt: new Date().toISOString() }, { consent: "true" }, { consent: 1 }, { consentVersion: "2026-11-20" }]) await hit("post", "/api/profile", { token: p.token, body });
    assert.deepEqual((await hit("post", "/api/food/{id}/slot", { token: p.token, ...bodies["post /api/food/{id}/slot"] })).body!.error, "consent_needed");
    assert.deepEqual(await counts(), before);
    const [{ meal: slotBefore }] = await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.id, source));
    assert.equal(slotBefore, "lunch", "the slot didn't move");
    assert.equal((await hit("post", "/api/profile", { token: p.token, body: { consent: true } })).status, 200);
    assert.equal((await hit("post", "/api/food/{id}/slot", { token: p.token, ...bodies["post /api/food/{id}/slot"] })).status, 200);
  });
});

describe("the words the apps get (App Store guideline 3.1.1)", () => {
  // No web address and no steer to the website, least of all about paying. not_for_browsers is
  // left out: only a browser is ever sent it (a request with Origin or Sec-Fetch-*).
  const OFF_SITE = /d-?human\.fit|https?:|www\.|website|\bweb\b|browser|online at|\bsite\b|₹|\bfree\b/i;

  it("not_for_app says only that the app can't do it yet", async () => {
    assert.equal(NOT_FOR_APP_WORDS, "This isn't available in the app yet.");
    const tour = (await import("../app/api/profile/tour/route.ts")).POST as Handler;
    const r = await call(tour, { token: A.token, body: {} });
    assert.deepEqual([r.status, r.body], [403, { error: "not_for_app", message: NOT_FOR_APP_WORDS }]);
  });

  it("no word table, and no message any route sent in this file, points at the website or a price", () => {
    const signIn = Object.fromEntries(Object.entries(SIGN_IN_WORDS).filter(([k]) => k !== "not_for_browsers"));
    const tables = [APP_MEAL_ERRORS, APP_REFUSALS, signIn, { NOT_FOR_APP_WORDS }];
    const all = [...tables.flatMap((t) => Object.values(t)), ...messages];
    assert.ok(messages.size >= 8, `saw ${messages.size} messages`);
    for (const m of all) assert.doesNotMatch(m, OFF_SITE, m);
  });
});

describe("the committed demo fixtures (docs/api/fixtures)", () => {
  const dir = path.join(ROOT, "docs/api/fixtures");
  const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? files(path.join(d, n)) : [path.join(d, n)]));

  it("hold demo people only: no real address, token, key, phone number or web words", () => {
    const all = files(dir);
    assert.ok(all.length > 80);
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      const where = path.relative(ROOT, f);
      for (const m of text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) assert.match(m, /@demo\.dhuman\.local$/, `${where}: ${m}`);
      assert.doesNotMatch(text, /dht_[A-Za-z0-9_-]{8,}|sk-ant|rzp_(live|test)_|whsec_|\bre_[A-Za-z0-9]{8,}/, where);
      assert.doesNotMatch(text, /(\+91[\s-]?)?\b[6-9]\d{9}\b/, `${where}: a phone number`);
      for (const u of text.match(/https?:\/\/[^\s"]+/g) ?? []) assert.match(u, /^https:\/\/www\.d-human\.fit$/, `${where}: ${u}`);
      if (where.includes("errors")) assert.doesNotMatch(text, /d-human\.fit/, `${where}: steers to the website`);
    }
  });

  it("held stacks carry no dose and no fits", () => {
    for (const s of ["urgent", "pregnancy"]) {
      const { body } = JSON.parse(readFileSync(path.join(dir, s, "stack.json"), "utf8"));
      assert.ok(body.hold);
      assert.deepEqual([body.stack?.plan ?? null, body.fits], [null, null], s);
    }
  });
});
