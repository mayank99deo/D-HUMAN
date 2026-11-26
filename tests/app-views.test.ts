// The apps' screen reads, GET /api/me and GET /api/home, against a real database (PGlite, or
// Postgres with TEST_DATABASE_URL). They come from the same builders as the web's pages, parse
// strictly against the contract, carry nothing of another person's, keep medicines and
// conditions to /api/me alone, and answer 304 to their own ETag. Numbers are QA's tests.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Handler = (request: Request) => Promise<Response>;
type G = { __headers?: Headers; __cookie?: string; __after: (() => unknown)[] };
const g = globalThis as unknown as G;
g.__after = [];

allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
delete process.env.ANTHROPIC_API_KEY;

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { sha256 } = await import("../lib/auth/crypto.ts");
const { startAppSession } = await import("../lib/auth/bearer.ts");
const { localDate, personaFor, getProfile } = await import("../lib/platform/profile.ts");
const { CONSENT_VERSION, meJson, meView } = await import("../lib/platform/views/me.ts");
const contract = await import("../lib/api/schemas.ts");
const { VERDICT_LEVELS } = await import("../lib/ai/schemas.ts");
const me = (await import("../app/api/me/route.ts")).GET as Handler;
const home = (await import("../app/api/home/route.ts")).GET as Handler;

after(async () => {
  await removeDatabase();
});

const SITE = "https://www.d-human.fit";

async function call(handler: Handler, o: { token?: string; cookie?: string; origin?: string; etag?: string } = {}) {
  const headers = new Headers();
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  if (o.origin) headers.set("origin", o.origin);
  if (o.etag) headers.set("if-none-match", o.etag);
  g.__headers = headers;
  g.__cookie = o.cookie;
  const res = await handler(new Request(`${SITE}/api/x`, { headers }));
  const text = await res.text();
  return { res, status: res.status, text, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

type Person = { id: string; email: string; token: string; cookie: string };

/** An onboarded person (unless told otherwise), signed in on a phone and on the web. */
async function person(email: string, profile: Partial<typeof schema.profiles.$inferInsert> = {}, onboarded = true): Promise<Person> {
  const d = await db();
  const id = randomUUID();
  await d.insert(schema.users).values({ id, email });
  await d.insert(schema.profiles).values({
    userId: id,
    name: "Asha",
    birthYear: 1994,
    sex: "female",
    heightCm: 160,
    weightKg: 55,
    city: "Indore",
    activities: ["running"],
    primaryActivity: "running",
    level: "regular",
    sessionsPerWeek: 4,
    goals: ["energy"],
    diet: "veg",
    timezone: "Asia/Kolkata",
    consentAt: new Date(),
    onboardedAt: onboarded ? new Date() : null,
    tourDoneAt: new Date(),
    ...profile,
  });
  const { token } = await startAppSession(id, { label: "iPhone18,1", client: null });
  const cookie = randomUUID();
  await d.insert(schema.sessions).values({ id: sha256(cookie), userId: id, expiresAt: new Date(Date.now() + 86_400_000) });
  return { id, email, token, cookie };
}

/** A read report with markers on the persona's own priorities, one flagged if asked. */
async function report(p: Person, o: { flag?: "doctor" | "urgent"; printed?: string; note?: string; name?: string; file?: string } = {}) {
  const d = await db();
  const profile = (await getProfile(p.id))!;
  const keys = personaFor(profile).priorities.slice(0, 5);
  const reportId = randomUUID();
  await d.insert(schema.reports).values({ id: reportId, userId: p.id, status: "ready", fileName: o.file ?? "report.pdf", collectedOn: "2026-11-02", nameOnReport: o.printed ?? null, model: "mock" });
  const markers = keys.map((key, i) => ({
    id: randomUUID(),
    reportId,
    userId: p.id,
    key,
    name: o.name ?? `Printed ${key}`,
    value: 10 + i,
    unit: "ng/mL",
    refLow: 12,
    refHigh: 40,
    rangeSource: "report",
    status: i === 0 ? "low" : "in_range",
    flag: i === 0 ? (o.flag ?? null) : null,
    position: i,
  }));
  await d.insert(schema.markers).values(markers);
  await d.insert(schema.analyses).values({
    reportId,
    userId: p.id,
    read: {
      headline: "A steady base",
      verdict: { level: o.flag ? "doctor_first" : "go_with_tweaks", line: o.flag ? "See a doctor before your race." : "Ready, with one fix.", detail: "Your first marker is low." },
      summary: "Mostly in range.",
      focus: [{ marker_key: keys[0], title: "Lift it with food", why: "It matters for running.", action: "Eat more leafy greens." }],
      markers: markers.map((m) => ({ id: m.id, note: o.note ?? `About ${m.key}.` })),
      wins: [],
      doctor_questions: [],
      retest: { weeks: 12, markers: [keys[0]], why: "To see it move." },
      test_tips: [],
    },
  });
  return reportId;
}

async function meal(p: Person, title = "Dal, two rotis") {
  const d = await db();
  await d.insert(schema.foodLogs).values({
    id: randomUUID(),
    userId: p.id,
    localDate: localDate("Asia/Kolkata"),
    meal: "lunch",
    source: "text",
    inputText: title,
    title,
    items: [{ name: title }],
    kcal: 420,
    proteinG: 18,
    carbsG: 60,
    fatG: 10,
    fibreG: 8,
    micros: {},
  });
}

/** Every key anywhere in a JSON value. */
const keysOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];

describe("GET /api/me", () => {
  it("answers before onboarding, with no persona until a profile is set; Home waits with a 409", async () => {
    const p = await person("new@example.com", { name: null, primaryActivity: null, activities: [] }, false);
    const r = await call(me, { token: p.token });
    assert.equal(r.status, 200);
    contract.MeResponse.parse(r.body);
    assert.equal(r.body!.onboarded, false);
    const h = await call(home, { token: p.token });
    assert.deepEqual([h.status, h.body], [409, { error: "not_onboarded", message: "Finish setting up first." }]);
    assert.equal(h.res.headers.get("cache-control"), "private, no-store");
  });

  it("is meView's answer, with the whole profile; consent is current only from the current wording", async () => {
    const p = await person("me@example.com", { medications: "Thyroxine 50", conditions: ["thyroid", "pregnant"], consentAt: new Date("2026-11-15T10:00:00Z") });
    const r = await call(me, { token: p.token });
    const parsed = contract.MeResponse.parse(r.body);
    assert.deepEqual(r.body, meJson(meView({ id: p.id, email: p.email }, await getProfile(p.id))));
    assert.equal(parsed.profile.medications, "Thyroxine 50");
    assert.deepEqual(parsed.profile.conditions, ["thyroid", "pregnant"]);
    assert.deepEqual([parsed.consent.version, parsed.consent.current], [CONSENT_VERSION, false]);
    const d = await db();
    await d.update(schema.profiles).set({ consentAt: new Date() }).where(eq(schema.profiles.userId, p.id));
    assert.equal(((await call(me, { token: p.token })).body!.consent as { current: boolean }).current, true);
    // Apps only: the web reads its own pages, so these JSON reads add nothing a cookie can reach.
    for (const handler of [me, home]) {
      const r = await call(handler, { cookie: p.cookie });
      assert.deepEqual([r.status, r.body, r.res.headers.get("cache-control")], [403, { error: "bearer_required" }, "private, no-store"]);
    }
  });
});

describe("GET /api/home", () => {
  const people: Record<string, Person> = {};
  before(async () => {
    people.fresh = await person("nothing@example.com");
    people.report = await person("report@example.com");
    await report(people.report);
    await meal(people.report);
    people.urgent = await person("urgent@example.com");
    await report(people.urgent, { flag: "urgent" });
    people.doctor = await person("doctor@example.com");
    await report(people.doctor, { flag: "doctor" });
    people.friend = await person("friend@example.com", { name: "Asha Rao" });
    await report(people.friend, { printed: "Vikram Singh" });
    people.pregnant = await person("pregnant@example.com", { conditions: ["pregnant"] });
    people.meals = await person("meals@example.com");
    const d = await db();
    await d.insert(schema.stacks).values({ id: randomUUID(), userId: people.meals.id, reportId: null, status: "ready", plan: { items: [{ name: "Vitamin B12" }], see_doctor: [], inputs: { diet: "veg", medications: null, conditions: [] } } });
    people.building = await person("building@example.com");
    await d.insert(schema.stacks).values({ id: randomUUID(), userId: people.building.id, reportId: null, status: "building" });
    // A stack from meals, then a report read: rebuild with the report.
    people.rebuildReport = await person("rebuild-report@example.com");
    await d.insert(schema.stacks).values({ id: randomUUID(), userId: people.rebuildReport.id, reportId: null, status: "ready", plan: { items: [{ name: "Vitamin B12" }], see_doctor: [] } });
    await report(people.rebuildReport);
    // A stack from one report, then a newer report.
    people.rebuildNewer = await person("rebuild-newer@example.com");
    const older = await report(people.rebuildNewer);
    await d.update(schema.reports).set({ createdAt: new Date(Date.now() - 86_400_000) }).where(eq(schema.reports.id, older));
    await d.insert(schema.stacks).values({ id: randomUUID(), userId: people.rebuildNewer.id, reportId: older, status: "ready", plan: { items: [{ name: "Vitamin D3" }], see_doctor: [] } });
    await report(people.rebuildNewer);
    // A stack built for a non-vegetarian; the person is vegetarian now.
    people.rebuildProfile = await person("rebuild-profile@example.com");
    const built = await report(people.rebuildProfile);
    await d.insert(schema.stacks).values({ id: randomUUID(), userId: people.rebuildProfile.id, reportId: built, status: "ready", plan: { items: [{ name: "Vitamin D3" }], see_doctor: [], inputs: { diet: "non_veg", medications: null, conditions: [] } } });
    // No report and no stack, but a usual day that's a full day's food.
    people.buildMeals = await person("build-meals@example.com");
    await d.insert(schema.dietBaselines).values({
      userId: people.buildMeals.id,
      description: "Poha, dal chawal, roti sabzi, curd",
      estimate: { meals: [{ kcal: 3200, protein_g: 90, carbs_g: 420, fat_g: 90, fibre_g: 40 }], patterns: [], micros: {} },
    });
  });

  // What each state must show, written out here rather than worked out by the builder under
  // test: the stack line's code and words, the verdict, and the report's own fields.
  const STACK = {
    start: ["Log meals on 3 days, or describe a normal day, and we'll build it. No report needed.", "Start my stack"],
    build_meals: ["Your meals are enough to start: we build it from what you eat, measured against your body and training. No report needed.", "Build my stack"],
    build_report: ["Built from this report and what you eat. Only what a marker or a real gap points to.", "Build my stack"],
    building: ["Building your stack…", "See progress"],
    ready: ["1 supplement, each tied to a gap in what you eat. A blood report adds what food can't show.", "Open my stack"],
    rebuild_report: ["Your report is read. Rebuild your stack so it covers your markers too.", "Rebuild with my report"],
    rebuild_newer: ["A newer report is in. Rebuild your stack from it.", "Rebuild my stack"],
    rebuild_profile: ["Your diet, medicines or health details changed. Rebuild your stack so it fits them.", "Rebuild my stack"],
  } as const;
  const GO = ["go_with_tweaks", "Ready, with one fix."] as const;
  const DOCTOR = ["doctor_first", "See a doctor before your race."] as const;
  const EXPECT: Record<string, { stack: keyof typeof STACK; verdict: readonly [string, string] | null; printedFor?: string }> = {
    fresh: { stack: "start", verdict: null },
    report: { stack: "build_report", verdict: GO },
    urgent: { stack: "build_report", verdict: DOCTOR },
    doctor: { stack: "build_report", verdict: DOCTOR },
    friend: { stack: "build_report", verdict: GO, printedFor: "Vikram Singh" },
    pregnant: { stack: "start", verdict: null },
    meals: { stack: "ready", verdict: null },
    building: { stack: "building", verdict: null },
    rebuildReport: { stack: "rebuild_report", verdict: GO },
    rebuildNewer: { stack: "rebuild_newer", verdict: GO },
    rebuildProfile: { stack: "rebuild_profile", verdict: GO },
    buildMeals: { stack: "build_meals", verdict: null },
  };

  it("shows each state as written out, and parses strictly against the contract", async () => {
    assert.deepEqual(Object.keys(EXPECT).sort(), Object.keys(people).sort());
    assert.deepEqual([...new Set(Object.values(EXPECT).map((e) => e.stack))].sort(), Object.keys(STACK).sort(), "every stack state is covered");
    for (const [state, p] of Object.entries(people)) {
      const r = await call(home, { token: p.token });
      assert.equal(r.status, 200, state);
      const body = contract.HomeResponse.parse(r.body);
      const want = EXPECT[state];
      assert.deepEqual([body.stack.state, body.stack.line, body.stack.button], [want.stack, ...STACK[want.stack]], state);
      assert.equal(body.bib.name, "Asha", state);
      assert.equal(body.reading, null, state);
      if (want.verdict) {
        assert.ok(body.report, state);
        assert.deepEqual([body.report.verdict.level, body.report.verdict.line], [...want.verdict], state);
        assert.equal(body.report.printedFor, want.printedFor ?? null, state);
        assert.equal(body.report.matter.length, 5, state);
        assert.deepEqual([body.report.matter[0].status, body.report.matter[0].statusText], ["low", "Below range"], state);
        assert.equal(body.report.contour.length, 5, state);
        assert.equal(body.report.source, "collected 2 Nov", state);
        assert.match(body.bib.next, /^Retest (due|was due) /, state);
        assert.equal(body.lastFailed, null, state);
      } else {
        assert.equal(body.report, null, state);
        assert.equal(body.bib.next, "Next: your first blood report", state);
      }
      assert.ok(r.text.length < 64 * 1024, `${state}: ${r.text.length} bytes`);
      assert.equal(r.res.headers.get("cache-control"), "private, no-store");
      assert.equal(r.res.headers.get("set-cookie"), null);
    }
  });

  it("carries the doctor and urgent flags in the web's words, and the safety verdict as stored", async () => {
    const tile = async (p: Person) => {
      const body = (await call(home, { token: p.token })).body as { report: { verdict: { level: string }; matter: { flag: string | null; flagText: string | null }[] } };
      return { level: body.report.verdict.level, flagged: body.report.matter.filter((m) => m.flag).map((m) => [m.flag, m.flagText]) };
    };
    assert.deepEqual(await tile(people.urgent), { level: "doctor_first", flagged: [["urgent", "Get advice today"]] });
    assert.deepEqual(await tile(people.doctor), { level: "doctor_first", flagged: [["doctor", "Show a doctor"]] });
    const friend = (await call(home, { token: people.friend.token })).body as { report: { printedFor: string | null } };
    assert.equal(friend.report.printedFor, "Vikram Singh");
  });

  it("28: no row ids, hashes, bytes or email; medicines and conditions only on /api/me", async () => {
    const p = people.pregnant;
    const d = await db();
    await d.update(schema.profiles).set({ medications: "Metformin 500" }).where(eq(schema.profiles.userId, p.id));
    await report(p);
    const r = await call(home, { token: p.token });
    for (const k of ["userId", "user_id", "reportId_", "codeHash", "bytes", "email", "medications", "conditions", "plan", "items"]) assert.ok(!keysOf(r.body).includes(k), k);
    for (const word of ["Metformin", "pregnant", p.email]) assert.ok(!r.text.includes(word), word);
    assert.ok((await call(me, { token: p.token })).text.includes("Metformin"));
  });

  it("26, 29: one person's answers hold nothing of another's", async () => {
    const a = await person("canary-a@example.com", { name: "CANARY_A_NAME", medications: "CANARY_A_MED", eventInMind: "CANARY_A_EVENT race" });
    await report(a, { printed: "CANARY_A_PRINTED", note: "CANARY_A_NOTE", name: "CANARY_A_MARKER", file: "CANARY_A_FILE.pdf" });
    await meal(a, "CANARY_A_MEAL");
    const d = await db();
    await d.insert(schema.events).values({ id: randomUUID(), activity: "running", region: "indore", query: "canary_a_event race", name: "CANARY_A_PRIVATE_EVENT", startsOn: "2027-01-10" });
    const b = await person("canary-b@example.com");
    await report(b);
    for (const handler of [me, home]) {
      const r = await call(handler, { token: b.token });
      assert.equal(r.status, 200);
      assert.ok(!r.text.includes("CANARY_A") && !r.text.includes("canary-a@") && !r.text.includes(a.id), r.text.slice(0, 200));
    }
    assert.ok((await call(home, { token: a.token })).text.includes("CANARY_A_PRIVATE_EVENT"), "A sees their own typed event");
  });

  it("33: a deleted report is gone from Home at once", async () => {
    const p = await person("deleted@example.com");
    const id = await report(p);
    assert.ok((await call(home, { token: p.token })).body!.report);
    const d = await db();
    await d.delete(schema.reports).where(eq(schema.reports.id, id));
    assert.equal((await call(home, { token: p.token })).body!.report, null);
  });

  it("answers 304 to its own ETag, and a new one when the day changes", async () => {
    const p = people.fresh;
    const first = await call(home, { token: p.token });
    const etag = first.res.headers.get("etag")!;
    const again = await call(home, { token: p.token, etag });
    assert.deepEqual([again.status, again.text, again.res.headers.get("etag"), again.res.headers.get("cache-control")], [304, "", etag, "private, no-store"]);
    await meal(p);
    const changed = await call(home, { token: p.token, etag });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.res.headers.get("etag"), etag);
    const m = await call(me, { token: p.token });
    assert.equal((await call(me, { token: p.token, etag: m.res.headers.get("etag")! })).status, 304);
  });

  it("refuses without a valid token, with a page's Origin, and never mixes a cookie in", async () => {
    const p = people.report;
    for (const handler of [me, home]) {
      assert.equal((await call(handler)).status, 401);
      assert.equal((await call(handler, { token: p.token, origin: SITE })).status, 401);
      assert.equal((await call(handler, { token: `${p.token.slice(0, -1)}x`, cookie: p.cookie })).status, 401);
      const r = await call(handler, { token: people.fresh.token, cookie: p.cookie });
      assert.equal(r.res.headers.get("cache-control"), "private, no-store");
      if (handler === me) assert.equal(r.body!.email, people.fresh.email, "the token's person, not the cookie's");
    }
  });

  it("the view builders import only from lib, never from the web's components", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../lib/platform/views/", import.meta.url);
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), "utf8");
      assert.doesNotMatch(src, /from ["']@\/components\//, f);
    }
  });

  it("the contract's enums are the lists they mirror", () => {
    assert.deepEqual([...contract.VERDICT_LEVELS], [...VERDICT_LEVELS]);
  });
});
