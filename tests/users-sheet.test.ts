// The Users tab of the founders' Google Sheet (lib/sheets/users.ts, lib/sheets/user-row.ts):
// the row each account gets and what never goes in it, the backfill and daily sync in
// batches of 200, the time budget, a Sheet that is down or still runs the old script,
// account deletion with its durable retry, rows pushed after sign-up and profile saves, and
// logs that carry counts only.
//
// Runs through production's driver (tests/support/driver-db.ts: lib/db's pool, postgres.js
// and drizzle's postgres-js driver), so a Date outside a column fails here as it would live.
// The Sheet's web app is google-apps-script/Code.gs itself, run in a sandbox
// (tests/support/apps-script.ts): every request goes through the real script.
// Times are UTC; IST is UTC+5:30. 05:00 UTC is the 10:30 IST run, 14:00 UTC the 19:30 one.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";
import { SECRET, isDate, loadScript } from "./support/apps-script.ts";
import { driverDatabase } from "./support/driver-db.ts";

type AfterFn = () => unknown;
const g = globalThis as unknown as { __testUser?: { id: string; email: string } | null; __after?: AfterFn[] };
allowAppImports({
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null; export const endSession = async () => {}; export const startSession = async () => {};",
  // after() callbacks are collected and run by the test, as Next runs them after the response.
  "next/server": "export const after = (fn) => { (globalThis.__after ??= []).push(fn); }; export const connection = async () => {};",
});
const removeDatabase = await driverDatabase();
for (const k of ["VERCEL", "VERCEL_ENV", "ANTHROPIC_API_KEY", "D_HUMAN_AI_MOCK", "EMAIL_SEND_LOCAL", "EMAIL_WEEKLY_LIVE", "EMAIL_LIFECYCLE_LIVE", "RAZORPAY_KEY_ID", "RESEND_API_KEY"]) delete process.env[k];
const ENV = {
  GOOGLE_SHEETS_WEBHOOK_URL: "https://script.example.test/macros/s/test/exec",
  GOOGLE_SHEETS_WEBHOOK_SECRET: SECRET,
  SHEET_USERS_LOCAL: "1",
  BLOG_OWNER_EMAILS: "founder@example.com",
  EMAIL_LINK_SECRET: "test-email-link-secret",
};

// ── The Sheet: the real script behind fetch ─────────────────────────────────
type Body = { action: string; rows?: Record<string, unknown>[]; ids?: string[]; respondent?: string };
let sheet = loadScript();
let calls: Body[] = [];
let sheetMode: "up" | "down" | "old" = "up";
let slowOnce = 0;
let onUsers: ((body: Body) => Promise<void>) | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as Body;
  calls.push(body);
  if (sheetMode === "down") throw new TypeError("fetch failed");
  // The script deployed before this change: an unknown action falls through to the waitlist.
  if (sheetMode === "old" && body.action.startsWith("users")) return Response.json({ ok: false, error: "missing_email" });
  if (body.action === "users" && slowOnce) {
    await sleep(slowOnce);
    slowOnce = 0;
  }
  if (body.action === "users" && onUsers) {
    const hook = onUsers;
    onUsers = null;
    await hook(body);
  }
  return new Response(sheet.script.doPost({ postData: { contents: JSON.stringify(body) } }).text, { headers: { "content-type": "application/json" } });
}) as typeof fetch;

const { eq, like, sql } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const rowLib = await import("../lib/sheets/user-row.ts");
const usersSheet = await import("../lib/sheets/users.ts");
const jobs = await import("../lib/email/jobs.ts");
const { issueCode } = await import("../lib/auth/codes.ts");
const verifyRoute = await import("../app/api/auth/verify/route.ts");
const profileRoute = await import("../app/api/profile/route.ts");
const deleteRoute = await import("../app/api/account/delete/route.ts");

after(removeDatabase);
beforeEach(async () => {
  Object.assign(process.env, ENV);
  sheet = loadScript();
  calls = [];
  sheetMode = "up";
  slowOnce = 0;
  onUsers = null;
  g.__after = [];
  g.__testUser = null;
  const d = await db();
  await d.execute(sql`truncate users, job_runs, login_codes, email_daily_counts cascade`);
});

const MORNING = new Date("2026-11-25T05:00:00Z"); // 10:30 IST
const EVENING = new Date("2026-11-25T14:00:00Z"); // 19:30 IST, same Indian day
const NEXT_MORNING = new Date("2026-11-26T05:00:00Z");
const BASE = Date.parse("2026-10-01T00:00:00Z");
const SITE = "https://www.d-human.fit";

const tab = () => sheet.ss.getSheetByName("Users");
// Copied out of the sandbox, whose arrays have their own prototype.
const HEADERS = () => Array.from(sheet.script.USER_COLUMNS, (c) => c[0]);
const SCRIPT_FIELDS = () => Array.from(sheet.script.USER_COLUMNS, (c) => c[1]);
const cell = (row: unknown[], header: string) => row[HEADERS().indexOf(header)];
const sheetIds = () => (tab()?.body() ?? []).map((r) => r[0]);
const usersCalls = () => calls.filter((c) => c.action === "users");
const runAfter = async () => {
  const fns = g.__after ?? [];
  g.__after = [];
  for (const fn of fns) await fn();
};

let n = 0;
const idOf = (k: number) => `30000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
const keyOf = (k: number) => `u_${String(k).padStart(12, "0")}`;
/** People who signed up in order, a minute apart, with nothing changed since. */
async function people(count: number, over: Partial<typeof schema.profiles.$inferInsert> = {}) {
  const d = await db();
  const rows = Array.from({ length: count }, () => {
    const k = ++n;
    return { k, id: idOf(k), email: `p${k}@example.com`, createdAt: new Date(BASE + k * 60_000) };
  });
  await d.insert(schema.users).values(rows.map(({ id, email, createdAt }) => ({ id, email, createdAt })));
  await d.insert(schema.profiles).values(
    rows.map((r) => ({
      userId: r.id,
      name: `Person ${r.k}`,
      birthYear: 1994,
      sex: "female",
      city: "Indore",
      language: "hi",
      primaryActivity: "running",
      level: "regular",
      goals: ["energy"],
      diet: "veg",
      onboardedAt: new Date(r.createdAt.getTime() + 10 * 60_000),
      updatedAt: new Date(r.createdAt.getTime() + 10 * 60_000),
      ...over,
    })),
  );
  return rows;
}

let m = 0;
async function meal(userId: string, createdAt: Date, title = "Dal rice") {
  const d = await db();
  await d.insert(schema.foodLogs).values({
    id: `users-sheet-meal-${++m}`,
    userId,
    localDate: new Date(createdAt.getTime() + 330 * 60_000).toISOString().slice(0, 10),
    meal: "lunch",
    source: "text",
    title,
    inputText: title,
    items: [{ name: title }],
    kcal: 500,
    proteinG: 20,
    carbsG: 60,
    fatG: 10,
    fibreG: 5,
    micros: {},
    createdAt,
  });
}

async function state() {
  const d = await db();
  const [row] = await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, usersSheet.USERS_SHEET_JOB));
  return row;
}
const markers = async () => (await (await db()).select({ job: schema.jobRuns.job }).from(schema.jobRuns).where(like(schema.jobRuns.job, `${usersSheet.USER_FORGET_PREFIX}%`))).map((r) => r.job);

// ── The row ─────────────────────────────────────────────────────────────────

describe("one account's row", () => {
  const facts = (over: Partial<import("../lib/sheets/user-row.ts").UserFacts> = {}) => ({
    id: "9b2c7e41-5d3a-4f8e-a1b2-c3d4e5f6a7b8",
    email: "asha@example.com",
    createdAt: new Date("2026-11-24T20:00:00Z"),
    lastSeenAt: new Date("2026-11-25T03:00:00Z"),
    name: " Asha Rao ",
    birthYear: 1994,
    sex: "female",
    city: "Indore",
    language: "hinglish",
    primaryActivity: "hyrox",
    level: "competitive",
    goals: ["energy", "deficiency", "muscle"],
    diet: "jain",
    onboardedAt: new Date("2026-11-24T20:20:00Z"),
    profileUpdatedAt: new Date("2026-11-24T20:20:00Z"),
    weekly: null,
    weeklyPausedAt: null,
    meals: 14,
    lastMealAt: new Date("2026-11-25T07:45:00Z"),
    reports: 2,
    lastReportAt: new Date("2026-11-25T01:00:00Z"),
    payments: 1,
    passActive: true,
    passUntil: new Date("2026-12-03T20:00:00Z"),
    ...over,
  });

  it("every column, labels people read, Indian time, and the fields in the script's order", () => {
    const row = rowLib.userSheetRow(facts(), new Date("2026-11-25T08:00:00Z"), "founder@example.com");
    assert.deepEqual(row, {
      id: "u_c3d4e5f6a7b8",
      founder: "No",
      name: "Asha Rao",
      email: "asha@example.com",
      signedUp: "2026-11-25 01:30",
      onboarded: "2026-11-25 01:50",
      lastActive: "2026-11-25 13:15",
      language: "Hinglish",
      city: "Indore",
      age: 32,
      sex: "Female",
      activity: "HYROX & functional",
      level: "Competitive",
      goals: "More energy, Build muscle",
      diet: "Jain",
      plan: "Pass until 04 Dec 2026",
      payments: 1,
      meals: 14,
      reports: 2,
      weeklyEmail: "On",
      synced: "2026-11-25 13:30",
    });
    assert.deepEqual(Object.keys(row), [...rowLib.USER_SHEET_FIELDS]);
    assert.deepEqual([...rowLib.USER_SHEET_FIELDS], SCRIPT_FIELDS(), "the site's fields are the script's columns, in order");
  });

  it("founder, plan, weekly email and blanks", () => {
    const now = new Date("2026-11-25T08:00:00Z");
    assert.equal(rowLib.userSheetRow(facts({ email: "Founder@Example.com" }), now, "founder@example.com").founder, "Yes");
    assert.equal(rowLib.userSheetRow(facts({ passActive: false }), now).plan, "Free", "an ended pass");
    assert.equal(rowLib.userSheetRow(facts({ weekly: false }), now).weeklyEmail, "Off");
    assert.equal(rowLib.userSheetRow(facts({ weekly: true, weeklyPausedAt: now }), now).weeklyEmail, "Paused");
    const empty = rowLib.userSheetRow(
      facts({ name: null, birthYear: null, sex: null, city: null, primaryActivity: null, level: null, goals: [], diet: null, onboardedAt: null, lastSeenAt: null, lastMealAt: null, lastReportAt: null, payments: 0, passActive: false, passUntil: null }),
      now,
    );
    assert.deepEqual([empty.name, empty.age, empty.sex, empty.city, empty.activity, empty.level, empty.goals, empty.diet, empty.onboarded, empty.plan], ["", null, "", "", "", "", "", "", "", "Free"]);
    assert.equal(empty.lastActive, "2026-11-25 01:50", "the latest of sign-up and profile save");
  });

  it("User IDs: 12 random hex characters of the account's UUID, or of a hash for anything else", () => {
    assert.equal(rowLib.userKey("9B2C7E41-5D3A-4F8E-A1B2-C3D4E5F6A7B8"), "u_c3d4e5f6a7b8");
    const other = rowLib.userKey("demo-ankit");
    assert.match(other, rowLib.USER_KEY);
    assert.equal(rowLib.userKey("demo-ankit"), other, "stable");
    assert.notEqual(rowLib.userKey("demo-mayank"), other);
  });

  it("a Settings change counts only for fields the Sheet shows", () => {
    const base = { name: "Asha", birthYear: 1994, sex: "female", city: "Indore", language: "en", primaryActivity: "running", level: "regular", goals: ["energy"], diet: "veg" };
    assert.equal(rowLib.sheetFieldsChanged(base, { ...base }), false);
    assert.equal(rowLib.sheetFieldsChanged({ ...base, weightKg: 60 } as typeof base, { ...base, weightKg: 61 } as typeof base), false, "weight isn't in the Sheet");
    assert.equal(rowLib.sheetFieldsChanged(base, { ...base, city: "Pune" }), true);
    assert.equal(rowLib.sheetFieldsChanged(base, { ...base, goals: ["energy", "muscle"] }), true);
    assert.equal(rowLib.sheetFieldsChanged(null, base), true);
  });
});

// ── What never leaves the database ──────────────────────────────────────────

describe("health and payment details never reach the Sheet", () => {
  it("weight, height, medicines, conditions, supplements, the deficiency goal, markers, reads, meals, Ask and payment ids stay out", async () => {
    const d = await db();
    const [p] = await people(1, {
      weightKg: 81.3,
      heightCm: 171.9,
      medications: "Metformin 500",
      conditions: ["pregnant", "thyroid"],
      currentSupplements: "Ashwagandha gummies",
      goals: ["deficiency"],
      supplementBudget: "1000_2000",
    });
    await meal(p.id, new Date("2026-11-20T07:00:00Z"), "Paneer tikka masala");
    await d.insert(schema.reports).values({ id: "rep-1", userId: p.id, status: "ready", labName: "Secret Labs", nameOnReport: "ASHA R", createdAt: new Date("2026-11-21T07:00:00Z") });
    await d.insert(schema.markers).values({ id: "mk-1", reportId: "rep-1", userId: p.id, key: "ferritin", name: "Ferritin", value: 11.37, unit: "ng/mL", status: "low", flag: "doctor" });
    await d.insert(schema.analyses).values({ reportId: "rep-1", userId: p.id, read: { verdict: "Iron stores look low" } });
    await d.insert(schema.askTurns).values({ id: "ask-1", userId: p.id, clientKey: "k1", day: "2026-11-25", status: "answered", question: "Can I double my metformin dose", answer: "Ask your doctor." });
    await d.insert(schema.payments).values({ id: "pay-row-1", userId: p.id, orderId: "order_SECRET111", paymentId: "pay_SECRET222", amount: 4900, currency: "INR", status: "paid", mode: "live", method: "upi", startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-20T00:00:00Z"), paidAt: new Date("2026-11-20T00:00:00Z") });
    await d.insert(schema.feedbackAnswers).values({ id: "fa-1", userId: p.id, survey: "fb-1", question: "text", answer: "My thyroid meds", source: "page" });

    const r = await usersSheet.syncUsersSheet({ now: MORNING });
    assert.equal(r.status, "ok", r.error);
    const sent = JSON.stringify(calls);
    const inSheet = JSON.stringify(tab()!.data);
    for (const secret of ["81.3", "171.9", "Metformin", "metformin", "regnan", "Thyroid", "thyroid", "Ashwagandha", "deficiency", "Fix a known", "1000_2000", "Paneer", "Secret Labs", "ASHA R", "Ferritin", "11.37", "Iron stores", "order_SECRET", "pay_SECRET", "4900", "upi", "r_"]) {
      assert.ok(!sent.includes(secret), `"${secret}" was sent to the Sheet`);
      assert.ok(!inSheet.includes(secret), `"${secret}" is in the Sheet`);
    }
    const [row] = tab()!.body();
    assert.equal(cell(row, "Meals logged"), 1);
    assert.equal(cell(row, "Reports uploaded"), 1);
    assert.equal(cell(row, "Payments"), 1);
    assert.equal(cell(row, "Plan"), "Pass until 20 Dec 2026");
    assert.equal(cell(row, "Goals"), "", "the only goal says something about their health");
  });
});

// ── The daily sync ──────────────────────────────────────────────────────────

describe("the daily sync", () => {
  it("the first run backfills everyone, 200 a request, in sign-up order; later runs send only what changed", async () => {
    const all = await people(450);
    const first = await usersSheet.syncUsersSheet({ now: MORNING });
    assert.deepEqual(first, { status: "ok", mode: "full", sent: 450, left: 0, forgotten: 0, forgetsPending: 0, fullOn: "2026-11-25" });
    assert.deepEqual(
      usersCalls().map((c) => c.rows!.length),
      [200, 200, 50],
    );
    assert.deepEqual(sheetIds(), all.map((p) => keyOf(p.k)), "one row each, in sign-up order");
    const row = tab()!.body()[0];
    assert.equal(cell(row, "Name"), `Person ${all[0].k}`);
    assert.equal(cell(row, "Language"), "हिंदी");
    assert.ok(isDate(cell(row, "Signed up (IST)")));
    const saved = await state();
    assert.equal(saved.lastOkAt?.toISOString(), MORNING.toISOString());
    assert.equal((saved.lastResult as { status: string; since: string }).status, "ok");
    assert.equal((saved.lastResult as { since: string }).since, new Date(MORNING.getTime() - 5 * 60_000).toISOString());

    // During the day: a meal, a sign-in, the weekly email turned off, a pass paid, a pass ended.
    const d = await db();
    const [a, b, c, e, f] = all;
    await meal(a.id, new Date("2026-11-25T08:00:00Z"));
    await d.update(schema.users).set({ lastSeenAt: new Date("2026-11-25T09:00:00Z") }).where(eq(schema.users.id, b.id));
    await d.insert(schema.emailPrefs).values({ userId: c.id, weekly: false, updatedAt: new Date("2026-11-25T09:00:00Z") });
    await d.insert(schema.payments).values({ id: "pay-e", userId: e.id, orderId: "order_e", amount: 4900, currency: "INR", status: "paid", mode: "live", startsAt: new Date("2026-11-25T09:00:00Z"), endsAt: new Date("2026-12-25T09:00:00Z"), paidAt: new Date("2026-11-25T09:00:00Z") });
    await d.insert(schema.payments).values({ id: "pay-f", userId: f.id, orderId: "order_f", amount: 4900, currency: "INR", status: "paid", mode: "live", startsAt: new Date("2026-10-26T10:00:00Z"), endsAt: new Date("2026-11-25T10:00:00Z"), paidAt: new Date("2026-10-26T10:00:00Z") });
    calls = [];

    const evening = await usersSheet.syncUsersSheet({ now: EVENING });
    assert.deepEqual([evening.status, evening.mode, evening.sent], ["ok", "changed", 5]);
    assert.deepEqual(
      usersCalls()[0].rows!.map((r) => r.id),
      [a, b, c, e, f].map((p) => keyOf(p.k)),
    );
    assert.equal(calls.filter((x) => x.action === "users-ids").length, 0, "leftovers are checked by the full rewrite only");
    const byId = new Map(tab()!.body().map((r) => [r[0], r]));
    assert.equal(cell(byId.get(keyOf(a.k))!, "Meals logged"), 1);
    assert.equal(cell(byId.get(keyOf(c.k))!, "Weekly email"), "Off");
    assert.equal(cell(byId.get(keyOf(e.k))!, "Plan"), "Pass until 25 Dec 2026");
    assert.equal(cell(byId.get(keyOf(f.k))!, "Plan"), "Free", "a pass that ended today");
    assert.equal(cell(byId.get(keyOf(f.k))!, "Payments"), 1);
    assert.equal(tab()!.body().length, 450);

    // Nothing changed: nothing sent.
    calls = [];
    const again = await usersSheet.syncUsersSheet({ now: new Date(EVENING.getTime() + 10 * 60_000) });
    assert.deepEqual([again.mode, again.sent], ["changed", 0]);
    assert.equal(usersCalls().length, 0);

    // The next Indian day: everyone again, then the leftover check.
    calls = [];
    const next = await usersSheet.syncUsersSheet({ now: NEXT_MORNING });
    assert.deepEqual([next.mode, next.sent, next.fullOn], ["full", 450, "2026-11-26"]);
    assert.equal(calls.at(-1)?.action, "users-ids");
  });

  it("out of time: stops between batches and carries on from there next run", async () => {
    const all = await people(450);
    // The first request outlasts the deadline: the run stops before the second.
    slowOnce = 2_000;
    const cut = await usersSheet.syncUsersSheet({ now: MORNING, deadline: Date.now() + 1_500 });
    assert.deepEqual([cut.status, cut.mode, cut.sent, cut.left, cut.fullOn], ["partial", "full", 200, 250, null]);
    const progress = (await state()).lastResult as { pass: { from: string } };
    assert.equal(progress.pass.from, all[199].createdAt.toISOString());
    assert.equal((await state()).lastOkAt, null);

    calls = [];
    const rest = await usersSheet.syncUsersSheet({ now: EVENING });
    assert.deepEqual([rest.status, rest.mode, rest.left, rest.fullOn], ["ok", "full", 0, "2026-11-25"]);
    assert.equal(usersCalls()[0].rows![0].id, keyOf(all[199].k), "from the last one sent (sent again, harmlessly)");
    assert.deepEqual(sheetIds(), all.map((p) => keyOf(p.k)), "everyone, once");
  });

  it("a Sheet still on the old script: 'outdated', nothing breaks, and the next run after the deploy backfills", async () => {
    await people(3);
    sheetMode = "old";
    const logs = await captureLogs(() => usersSheet.syncUsersSheet({ now: MORNING }));
    const old = logs.result;
    assert.deepEqual([old.status, old.sent, old.left], ["outdated", 0, 3]);
    assert.ok(logs.lines.some((l) => /paste the new Code\.gs, run setupUsers, deploy a new version/.test(l)), "one clear line");
    assert.equal(tab(), null);

    sheetMode = "up";
    const fixed = await usersSheet.syncUsersSheet({ now: EVENING });
    assert.deepEqual([fixed.status, fixed.mode, fixed.sent], ["ok", "full", 3]);
    assert.equal(sheetIds().length, 3);
  });

  it("a Sheet that is down: 'failed', the rows wait for the next run", async () => {
    await people(3);
    sheetMode = "down";
    const down = await usersSheet.syncUsersSheet({ now: MORNING });
    assert.deepEqual([down.status, down.sent, down.left, down.error], ["failed", 0, 3, "fetch failed"]);
    sheetMode = "up";
    const up = await usersSheet.syncUsersSheet({ now: EVENING });
    assert.deepEqual([up.status, up.mode, up.sent], ["ok", "full", 3]);
  });

  it("rows of accounts that no longer exist go at the end of the full rewrite; other rows stay", async () => {
    const [p] = await people(1);
    sheet.post({ secret: SECRET, action: "users", rows: [{ id: "u_ffffffffffff", name: "Deleted by hand" }] });
    tab()!.appendRow(["notes", "", "a founder's own row"]);
    const r = await usersSheet.syncUsersSheet({ now: MORNING });
    assert.deepEqual([r.status, r.forgotten], ["ok", 1]);
    assert.deepEqual(
      calls.filter((c) => c.action === "users-forget").map((c) => c.ids),
      [["u_ffffffffffff"]],
    );
    assert.deepEqual(sheetIds(), ["notes", keyOf(p.k)]);
  });

  it("an account deleted while its row was on the way is removed again", async () => {
    const [a, b] = await people(2);
    const d = await db();
    onUsers = async () => {
      await d.delete(schema.users).where(eq(schema.users.id, a.id));
    };
    const r = await usersSheet.syncUsersSheet({ now: MORNING });
    assert.equal(r.status, "ok", r.error);
    assert.ok(r.forgotten >= 1);
    assert.deepEqual(sheetIds(), [keyOf(b.k)]);
    assert.deepEqual(await markers(), []);
  });

  it("local and preview runs never write the real Sheet; no URL or secret means not configured", async () => {
    await people(2);
    delete process.env.SHEET_USERS_LOCAL;
    assert.equal((await usersSheet.syncUsersSheet({ now: MORNING })).status, "not_production");
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.SHEET_USERS_LOCAL = "1";
    try {
      assert.equal((await usersSheet.syncUsersSheet({ now: MORNING })).status, "not_production", "the local switch is for local runs only");
    } finally {
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
    }
    delete process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    assert.equal((await usersSheet.syncUsersSheet({ now: MORNING })).status, "not_configured");
    assert.equal(calls.length, 0);
    assert.equal(await state(), undefined, "nothing recorded");
  });
});

// ── After a request ─────────────────────────────────────────────────────────

describe("rows sent after a request", () => {
  it("a new account's row goes after the sign-in response; signing in again sends nothing", async () => {
    const email = "new.person@example.com";
    const signIn = async () => {
      const issued = await issueCode(email);
      assert.ok(issued.ok);
      const res = await verifyRoute.POST(new Request(`${SITE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }, body: JSON.stringify({ email, code: issued.code }) }));
      assert.equal(res.status, 200);
    };
    await signIn();
    assert.equal(calls.length, 0, "not before the response");
    await runAfter();
    const [row] = tab()!.body();
    assert.equal(cell(row, "Email"), email);
    assert.equal(cell(row, "Onboarding finished (IST)"), "");
    assert.equal(cell(row, "Founder"), "No");

    calls = [];
    await signIn();
    await runAfter();
    assert.equal(calls.length, 0, "an existing account's sign-in waits for the daily job");
  });

  it("onboarding steps wait for the end; finishing sends the row; Settings sends it only for a field the Sheet shows", async () => {
    const d = await db();
    const id = idOf(++n);
    await d.insert(schema.users).values({ id, email: "founder@example.com" });
    await d.insert(schema.profiles).values({ userId: id });
    g.__testUser = { id, email: "founder@example.com" };
    const save = async (body: Record<string, unknown>) => {
      const res = await profileRoute.POST(new Request(`${SITE}/api/profile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      assert.equal(res.status, 200);
      await runAfter();
    };
    await save({ consent: true, language: "en" });
    await save({ name: "Mayank", city: "Delhi", weightKg: 70 });
    assert.equal(usersCalls().length, 0, "mid-onboarding");
    await save({ complete: true });
    assert.equal(usersCalls().length, 1);
    const [row] = tab()!.body();
    assert.deepEqual([cell(row, "Name"), cell(row, "City"), cell(row, "Founder")], ["Mayank", "Delhi", "Yes"]);
    assert.ok(isDate(cell(row, "Onboarding finished (IST)")));

    await save({ weightKg: 71 });
    assert.equal(usersCalls().length, 1, "weight isn't in the Sheet");
    await save({ city: "Patna" });
    assert.equal(usersCalls().length, 2);
    assert.equal(cell(tab()!.body()[0], "City"), "Patna");
  });

  it("a push that fails is only logged, and the daily job sends the row", async () => {
    const [p] = await people(1);
    sheetMode = "down";
    assert.equal(await usersSheet.pushUserRow(p.id, MORNING), "failed");
    sheetMode = "old";
    assert.equal(await usersSheet.pushUserRow(p.id, MORNING), "outdated");
    sheetMode = "up";
    assert.equal((await usersSheet.syncUsersSheet({ now: MORNING })).sent, 1);
    assert.deepEqual(sheetIds(), [keyOf(p.k)]);
  });
});

// ── Deleting an account ─────────────────────────────────────────────────────

describe("deleting an account removes its row", () => {
  const remove = async (user: { id: string; email: string }) => {
    g.__testUser = user;
    const res = await deleteRoute.POST(new Request(`${SITE}/api/account/delete`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ confirm: "DELETE" }) }));
    assert.equal(res.status, 200);
  };

  it("promised inside the delete itself, then removed after the response", async () => {
    const [a, b] = await people(2);
    await usersSheet.syncUsersSheet({ now: MORNING });
    calls = [];
    await remove(a);
    assert.deepEqual(await markers(), [`sheet-forget-user:${keyOf(a.k)}`], "kept in the database before anything is asked");
    assert.equal(calls.length, 0);
    await runAfter();
    assert.deepEqual(
      calls.filter((c) => c.action === "users-forget").map((c) => c.ids),
      [[keyOf(a.k)]],
    );
    assert.deepEqual(sheetIds(), [keyOf(b.k)]);
    assert.deepEqual(await markers(), [], "the promise is kept and cleared");
  });

  it("with the Sheet down, or the function stopped, the daily job finishes it", async () => {
    const [a, b, c] = await people(3);
    await usersSheet.syncUsersSheet({ now: MORNING });
    await remove(a);
    g.__after = []; // the function stopped right after the response
    await remove(b);
    sheetMode = "down";
    g.__after = [];
    assert.equal(await usersSheet.forgetUserRow(keyOf(b.k), { tries: 2, waitMs: 0 }), "queued");
    assert.deepEqual((await markers()).sort(), [`sheet-forget-user:${keyOf(a.k)}`, `sheet-forget-user:${keyOf(b.k)}`]);

    sheetMode = "old";
    const stale = await usersSheet.syncUsersSheet({ now: EVENING });
    assert.deepEqual([stale.status, stale.forgetsPending], ["outdated", 2], "an old script can't remove them: they wait");

    sheetMode = "up";
    calls = [];
    const r = await usersSheet.syncUsersSheet({ now: new Date(EVENING.getTime() + 60_000) });
    assert.deepEqual([r.status, r.forgotten, r.forgetsPending], ["ok", 2, 0]);
    assert.equal(calls[0].action, "users-forget", "removals go first");
    assert.deepEqual(sheetIds(), [keyOf(c.k)]);
    assert.deepEqual(await markers(), []);
  });

  it("a local run promises nothing and asks nothing", async () => {
    const [a] = await people(1);
    delete process.env.SHEET_USERS_LOCAL;
    await remove(a);
    await runAfter();
    assert.deepEqual(await markers(), []);
    assert.equal(calls.filter((c) => c.action.startsWith("users")).length, 0);
  });
});

// ── The daily job ───────────────────────────────────────────────────────────

describe("in the daily job", () => {
  it("runs after the email steps, even when one of them fails, and records its result", async () => {
    const [a] = await people(2);
    const d = await db();
    // Every email step reads email_sends; the Users tab doesn't.
    await d.execute(sql`alter table email_sends rename to email_sends_away`);
    let run;
    try {
      run = await jobs.runDaily({ now: MORNING, paceMs: 0, origin: SITE });
    } finally {
      await d.execute(sql`alter table email_sends_away rename to email_sends`);
    }
    assert.equal(run.status, "error");
    assert.ok(run.housekeeping, "housekeeping ran");
    const users = run.usersSheet as import("../lib/sheets/users.ts").UsersSheetResult;
    assert.deepEqual([users.status, users.mode, users.sent], ["ok", "full", 2]);
    assert.ok(sheetIds().includes(keyOf(a.k)));
    const [daily] = await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, "daily"));
    assert.equal((daily.lastResult as { usersSheet: { status: string } }).usersSheet.status, "ok");
  });

  it("a dry run (?dry=1) leaves the Sheet and job_runs alone", async () => {
    await people(2);
    const run = await jobs.runDaily({ now: MORNING, dry: true, paceMs: 0, origin: SITE });
    assert.equal(run.usersSheet, null);
    assert.equal(calls.length, 0);
    assert.equal(await state(), undefined);
  });
});

// ── Logs ────────────────────────────────────────────────────────────────────

async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const saved = { info: console.info, error: console.error, warn: console.warn, log: console.log };
  const keep = (...args: unknown[]) => lines.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
  Object.assign(console, { info: keep, error: keep, warn: keep, log: keep });
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

describe("logs", () => {
  it("carry counts and statuses, never names, addresses or account ids", async () => {
    const all = await people(3, { name: "Zarina Unique" });
    const lines: string[] = [];
    lines.push(...(await captureLogs(() => usersSheet.syncUsersSheet({ now: MORNING }))).lines);
    sheetMode = "down";
    lines.push(...(await captureLogs(() => usersSheet.pushUserRow(all[0].id, MORNING))).lines);
    lines.push(...(await captureLogs(() => usersSheet.forgetUserRow(keyOf(all[1].k), { tries: 1 }))).lines);
    lines.push(...(await captureLogs(() => usersSheet.syncUsersSheet({ now: NEXT_MORNING }))).lines);
    sheetMode = "old";
    lines.push(...(await captureLogs(() => usersSheet.syncUsersSheet({ now: new Date(NEXT_MORNING.getTime() + 60_000) }))).lines);
    assert.ok(lines.length >= 4);
    const text = lines.join("\n");
    assert.doesNotMatch(text, /@example\.com|Zarina|u_0000|30000000-/);
  });
});
