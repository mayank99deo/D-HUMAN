// A blood report uploaded from an app (G10), against a real database: Prefer: respond-async gets
// 202 at once, a resend with the same key returns the same report and claims no second read, the
// part-read pages are kept and come back with the read, and the web's upload is as before.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, person, type Handler } from "./support/app-people.ts";

type G = { __after: (() => unknown)[]; __testUser?: { id: string; email: string } | null };
const g = globalThis as unknown as G;
g.__after = [];
allowAppImports({
  "next/headers": `export const headers = async () => globalThis.__headers ?? new Headers(); export const cookies = async () => ({ get: () => undefined, set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null; export const requireUser = async () => { throw new Error('no'); };",
});
const removeDatabase = tempDatabase();

const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const contract = await import("../lib/api/schemas.ts");
const upload = (await import("../app/api/reports/route.ts")).POST as Handler;
const read = (await import("../app/api/reports/[id]/read/route.ts")).GET as Handler;

after(async () => {
  await removeDatabase();
});

const pdf = () => new Blob([Buffer.from("%PDF-1.4\n% demo\n")], { type: "application/pdf" });
const form = (f: Record<string, string | Blob>) => Object.entries(f).reduce((fd, [k, v]) => (fd.append(k, v), fd), new FormData());

describe("POST /api/reports from an app", () => {
  it("202 at once with Location; the same key again is the same report and no second read; the pages are kept and come back with the read", async () => {
    const p = await person("upload@example.com");
    const send = () => call(upload, { token: p.token, headers: { prefer: "respond-async" }, form: form({ files: pdf(), key: "upload-key-000000001", pagesSent: "6", pagesOf: "24" }) });
    const first = await send();
    assert.equal(first.status, 202);
    const { reportId } = contract.UploadAccepted.parse(first.body);
    assert.equal(first.res.headers.get("location"), `/api/reports/${reportId}`);
    assert.equal(g.__after.length, 1, "the read runs after the answer");
    g.__after.splice(0);
    const again = await send();
    assert.deepEqual([again.status, again.body], [202, { reportId, repeat: true }]);
    assert.equal(g.__after.length, 0, "no second read started");
    const d = await db();
    const [row] = await d.select().from(schema.reports).where(eq(schema.reports.id, reportId));
    assert.deepEqual([row.uploadKey, row.pages], ["upload-key-000000001", { sent: 6, of: 24 }]);
    assert.equal((await d.select().from(schema.usage).where(and(eq(schema.usage.userId, p.id), eq(schema.usage.kind, "read")))).length, 1, "one read claimed");
    // Once read, the read says how many pages it came from.
    await d.update(schema.reports).set({ status: "ready" }).where(eq(schema.reports.id, reportId));
    await d.insert(schema.analyses).values({ reportId, userId: p.id, read: { headline: "h", verdict: { level: "go", line: "Go.", detail: "d" }, summary: "s", focus: [], markers: [], wins: [], doctor_questions: [], retest: { weeks: 12, markers: [], why: "w" }, test_tips: [] } });
    const r = contract.ReadResponse.parse((await call(read, { token: p.token, params: { id: reportId } })).body);
    assert.deepEqual(r.pages, { sent: 6, of: 24 });
  });

  it("without Prefer, the web's NDJSON stream; a whole report keeps no pages; the web's own upload is as before", async () => {
    const p = await person("upload-stream@example.com");
    const r = await call(upload, { token: p.token, form: form({ files: pdf(), pagesSent: "3", pagesOf: "3" }) });
    assert.equal(r.status, 200);
    assert.match(r.text.split("\n")[0], /"type":"created"/);
    g.__after.splice(0);
    const d = await db();
    const [row] = (await d.select().from(schema.reports).where(eq(schema.reports.userId, p.id)));
    assert.deepEqual([row.uploadKey, row.pages], [null, null]);
    const w = await person("upload-web@example.com");
    g.__testUser = { id: w.id, email: w.email };
    const web = await call(upload, { form: form({ files: pdf(), key: "upload-key-000000002", pagesSent: "1", pagesOf: "9" }) });
    assert.equal(web.status, 200);
    g.__after.splice(0);
    const [wr] = await d.select().from(schema.reports).where(eq(schema.reports.userId, w.id));
    assert.deepEqual([wr.uploadKey, wr.pages], [null, null], "the web's upload ignores the apps' fields");
    g.__testUser = null;
    void randomUUID;
  });
});
