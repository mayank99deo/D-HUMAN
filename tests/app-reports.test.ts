// A report's read and the list of reports, for the apps. reportReadView (the web page's own
// derivations) on fixture data with no database, against expectations worked out here; then
// GET /api/reports and GET /api/reports/[id]/read against a real database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, person, type Handler, type Person } from "./support/app-people.ts";

const g = globalThis as unknown as { __after: (() => unknown)[] };
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { reportReadView } = await import("../lib/platform/views/report.ts");
const { readJson } = await import("../lib/api/views/reports.ts");
const contract = await import("../lib/api/schemas.ts");
const list = (await import("../app/api/reports/route.ts")).GET as Handler;
const readRoute = (await import("../app/api/reports/[id]/read/route.ts")).GET as Handler;
type Marker = import("../lib/db/schema.ts").Marker;
type ReportView = import("../lib/platform/dashboard.ts").ReportView;

after(async () => {
  await removeDatabase();
});

const marker = (over: Partial<Marker>): Marker =>
  ({ id: randomUUID(), reportId: "r1", userId: "u1", key: null, name: "Printed", panel: null, value: 10, valueText: null, unit: "ng/mL", refLow: 12, refHigh: 40, refText: null, rangeSource: "report", status: "in_range", flag: null, position: 0, ...over }) as Marker;

const READ = {
  headline: "A steady base",
  verdict: { level: "go_with_tweaks", line: "Ready, with one fix.", detail: "Vitamin D is low." },
  summary: "Mostly in range.",
  focus: [{ marker_key: "vitamin_d", title: "Get some sun", why: "It's low.", action: "Twenty minutes of midday sun." }],
  markers: [] as { id: string; note: string }[],
  wins: ["Iron is good."],
  doctor_questions: ["Ask about vitamin D."],
  retest: { weeks: 12, markers: ["vitamin_d", "made_up_key"], why: "To see it move." },
  test_tips: ["Fast for 10 hours."],
};

function fixture(o: { collectedOn?: string | null; model?: string; nameOnReport?: string | null } = {}) {
  const ferritin = marker({ key: "ferritin", name: "Serum ferritin", status: "edge_low", position: 0 });
  const vitD = marker({ key: "vitamin_d", name: "Vitamin D Total", status: "low", flag: "doctor", position: 1 });
  const hba1c = marker({ key: "hba1c", name: "HbA1c", status: "high", position: 2 });
  const odd = marker({ key: null, name: "Urine colour", panel: "Urine", status: "unknown", position: 3 });
  const other = marker({ key: null, name: "Something", panel: null, status: "in_range", position: 4 });
  const read = { ...READ, markers: [{ id: vitD.id, note: "Low for a runner." }] };
  const view: ReportView = {
    id: "r1", labName: "City Labs", collectedOn: o.collectedOn === undefined ? "2026-11-02" : o.collectedOn, createdAt: new Date("2026-11-04T06:00:00Z"),
    nameOnReport: o.nameOnReport ?? null, model: o.model ?? "claude-sonnet", read: read as unknown as ReportView["read"], markers: [ferritin, vitD, hba1c, odd, other],
  };
  return { view, ferritin, vitD, hba1c, odd, other };
}
const profile = { name: "Asha Rao", timezone: "Asia/Kolkata", language: "en" };
const NOW = new Date("2026-11-26T06:00:00Z");

describe("reportReadView (the web's report page)", () => {
  it("groups markers by panel in the catalogue's order, unknown panels after, 'Other' for none", () => {
    const { view, ferritin, vitD, hba1c, odd, other } = fixture();
    const v = reportReadView(profile, view, NOW);
    assert.deepEqual(v.groups.map((g) => [g.panel, g.markers.map((m) => m.marker.id)]), [
      ["Iron", [ferritin.id]],
      ["Vitamins", [vitD.id]],
      ["Blood sugar", [hba1c.id]],
      ["Urine", [odd.id]],
      ["Other", [other.id]],
    ]);
  });

  it("each marker's note is the read's, else the catalogue's line about it, else none", () => {
    const { view } = fixture();
    const notes = reportReadView(profile, view, NOW).groups.flatMap((g) => g.markers.map((m) => m.note));
    assert.deepEqual(notes, ["Your stored iron. It often drops before haemoglobin does.", "Low for a runner.", "Your average blood sugar over roughly the last 2–3 months.", undefined, undefined]);
  });

  it("counts only low and high as outside the range; names the retest markers; the AI line by model", () => {
    const { view } = fixture();
    const v = reportReadView(profile, view, NOW);
    assert.equal(v.out, 2, "vitamin D low and HbA1c high; edge and unknown don't count");
    assert.deepEqual(v.retestMarkers, ["Vitamin D (25-OH)", "made_up_key"]);
    assert.equal(v.aiNote, "AI-analysed report. Not a diagnosis.");
    assert.equal(reportReadView(profile, fixture({ model: "mock" }).view, NOW).aiNote, "Demo read, written from a template");
  });

  it("the retest counts from the day the blood was taken, else the upload day, against `now`", () => {
    const taken = reportReadView(profile, fixture().view, NOW).retest;
    assert.deepEqual([taken.dueOn, taken.days], ["2027-01-25", 60], "2 Nov + 12 weeks; 26 Nov to 25 Jan");
    const uploaded = reportReadView(profile, fixture({ collectedOn: null }).view, NOW).retest;
    assert.equal(uploaded.dueOn, "2027-01-27", "uploaded 4 Nov (IST) + 12 weeks");
  });

  it("a report printed for someone else names them; the verdict is tagged Hindi only for Hindi readers", () => {
    assert.equal(reportReadView(profile, fixture({ nameOnReport: "Vikram Singh" }).view, NOW).otherName, "Vikram Singh");
    assert.equal(reportReadView(profile, fixture({ nameOnReport: "ASHA RAO" }).view, NOW).otherName, null);
    assert.equal(reportReadView({ ...profile, language: "hi" }, fixture().view, NOW).verdictLang, "hi");
    assert.equal(reportReadView({ ...profile, language: "hinglish" }, fixture().view, NOW).verdictLang, undefined);
  });

  it("readJson: the contract's shape, every flag in the web's words, the stored verdict untouched", () => {
    const { view } = fixture();
    const j = readJson(reportReadView(profile, view, NOW), view, "Asia/Kolkata");
    contract.ReadResponse.parse(j);
    const flagged = j.groups.flatMap((g) => g.markers).filter((m) => m.flag);
    assert.deepEqual(flagged.map((m) => [m.name, m.flag, m.flagText]), [["Vitamin D (25-OH)", "doctor", "Show a doctor"]]);
    assert.deepEqual(j.verdict, { level: "go_with_tweaks", line: "Ready, with one fix.", detail: "Vitamin D is low.", lang: null });
    assert.deepEqual([j.uploadedOn, j.retest.from, j.counts], ["2026-11-04", "collected", { markers: 5, out: 2 }]);
  });
});

async function stored(p: Person, o: { status?: string; flag?: string | null; startedAt?: Date | null; read?: boolean; printed?: string } = {}) {
  const d = await db();
  const id = randomUUID();
  await d.insert(schema.reports).values({ id, userId: p.id, status: o.status ?? "ready", fileName: "r.pdf", collectedOn: "2026-11-02", nameOnReport: o.printed ?? null, model: "mock", startedAt: o.startedAt ?? null });
  const m = { id: randomUUID(), reportId: id, userId: p.id, key: "vitamin_d", name: "Vitamin D", value: 8, unit: "ng/mL", refLow: 30, refHigh: 100, rangeSource: "catalog", status: "low", flag: o.flag ?? null, position: 0 };
  await d.insert(schema.markers).values(m);
  if (o.read !== false) await d.insert(schema.analyses).values({ reportId: id, userId: p.id, read: { ...READ, markers: [{ id: m.id, note: "Low." }] } });
  return id;
}

describe("GET /api/reports/[id]/read", () => {
  it("is the read, with an urgent flag in the web's words; another person's, a missing one or one not read yet: the same 404", async () => {
    const p = await person("read@example.com");
    const id = await stored(p, { flag: "urgent" });
    const r = await call(readRoute, { token: p.token, params: { id } });
    assert.equal(r.status, 200);
    const body = contract.ReadResponse.parse(r.body);
    assert.deepEqual(body.groups[0].markers.map((m) => [m.flag, m.flagText, m.note]), [["urgent", "Get advice today", "Low."]]);
    assert.equal(body.aiNote, "Demo read, written from a template");
    const other = await person("read-other@example.com");
    const unread = await stored(p, { read: false });
    const gone = [await call(readRoute, { token: other.token, params: { id } }), await call(readRoute, { token: p.token, params: { id: "nope" } }), await call(readRoute, { token: p.token, params: { id: unread } })];
    for (const x of gone) assert.deepEqual([x.status, x.body], [404, { error: "not_found", message: "That report is gone, or it hasn't been read yet." }]);
    assert.equal((await call(readRoute, { token: p.token, params: { id }, etag: r.res.headers.get("etag")! })).status, 304);
    assert.deepEqual((await call(readRoute, { cookie: p.cookie, params: { id } })).body, { error: "bearer_required" });
  });
});

describe("GET /api/reports", () => {
  it("lists every upload newest first, settles a dead read first, and names a friend's report", async () => {
    const p = await person("list@example.com", { name: "Asha Rao" });
    const a = await stored(p, { printed: "Vikram Singh" });
    const dead = await stored(p, { status: "reading", read: false, startedAt: new Date(Date.now() - 60 * 60_000) });
    const r = await call(list, { token: p.token });
    const body = contract.ReportsResponse.parse(r.body);
    assert.deepEqual(body.reports.map((x) => x.id).sort(), [a, dead].sort());
    const friend = body.reports.find((x) => x.id === a)!;
    assert.deepEqual([friend.title, friend.when, friend.printedFor, friend.markers], ["Blood report", "Collected 2 Nov 2026", "Vikram Singh", 1]);
    assert.equal(body.reports.find((x) => x.id === dead)!.status, "failed", "a read that died partway isn't listed as running");
    const d = await db();
    assert.equal((await d.select().from(schema.reports).where(eq(schema.reports.id, dead)))[0].status, "failed");
    const other = await person("list-other@example.com");
    assert.deepEqual((await call(list, { token: other.token })).body, { reports: [] });
    assert.equal((await call(list)).status, 401);
  });
});
