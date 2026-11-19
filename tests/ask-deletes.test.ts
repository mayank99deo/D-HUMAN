// Deletes and Ask (contract §12): deleting any report blanks every answer that used report
// data and keeps the questions (and nobody else's); deleting the account through its route
// takes every question and count by foreign-key cascade; neither hands back a question.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

const g = globalThis as unknown as { __testUser?: { id: string; email: string } | null };

allowAppImports({
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null; export const endSession = async () => {};",
  "@/lib/email/send": `export const sendFounderAlert = async () => ({ status: "sent" });`,
  "next/server": "export const after = () => {}; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { deleteReports } = await import("../lib/platform/reports.ts");
const ask = await import("../lib/platform/ask.ts");
const { POST: deleteAccount } = await import("../app/api/account/delete/route.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

const DAY = ask.istDay();
const usage = { model: "claude-haiku-5-5", inputTokens: 100, outputTokens: 10, costMicros: 1, ms: 5 };
async function person() {
  const d = await db();
  const id = crypto.randomUUID();
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  return id;
}
async function report(userId: string) {
  const d = await db();
  const id = crypto.randomUUID();
  await d.insert(schema.reports).values({ id, userId, status: "ready" });
  return id;
}
async function answered(userId: string, reportId: string | null, question: string) {
  const c = await ask.claimAsk({ userId, clientKey: crypto.randomUUID(), day: DAY, question, reportId, max: 1e6 });
  assert.ok(c.ok);
  const reply = { kind: "answer" as const, answer: `Answer to ${question}`, notice: null, links: ["report" as const], lang: "en", floorRaised: false, filter: null };
  assert.ok(await ask.completeAsk({ turnId: c.turnId, userId, reply, usage, counted: true }));
}
async function turns(userId: string) {
  const d = await db();
  return (await d.select().from(schema.askTurns).where(eq(schema.askTurns.userId, userId))).sort((a, b) => a.question.localeCompare(b.question));
}

describe("a report delete", () => {
  it("blanks every answer that used any report, keeps the questions and the count, and leaves the rest alone", async () => {
    const me = await person();
    const you = await person();
    const r1 = await report(me);
    const r2 = await report(me);
    const yours = await report(you);
    await answered(me, r1, "a: about report one");
    await answered(me, r2, "b: about report two");
    await answered(me, null, "c: before any report");
    await answered(you, yours, "d: someone else's");

    assert.equal(await deleteReports(me, [r1]), 1);
    const mine = await turns(me);
    assert.deepEqual(
      mine.map((t) => [t.question, t.answer, t.links, t.notice, t.removedAt != null]),
      [
        ["a: about report one", null, null, null, true],
        ["b: about report two", null, null, null, true],
        ["c: before any report", "Answer to c: before any report", ["report"], null, false],
      ],
    );
    const view = ask.turnView(mine[0], { newestReportId: r2 });
    assert.deepEqual([view.removed, view.answer, view.links, view.notice, view.question], ["report_deleted", null, [], null, "a: about report one"]);
    assert.equal((await turns(you))[0].answer, "Answer to d: someone else's", "another person's answers stay");
    assert.deepEqual(await ask.askCounters(me, DAY), { used: 3, attempts: 3 }, "no question handed back");
  });

  it("does nothing to Ask when no report went", async () => {
    const me = await person();
    const r = await report(me);
    await answered(me, r, "kept");
    assert.equal(await deleteReports(me, ["not-mine"]), 0);
    assert.equal((await turns(me))[0].answer, "Answer to kept");
  });
});

describe("an account delete", () => {
  it("takes every question and count with the account (cascade); everyone's totals stay", async () => {
    const me = await person();
    const r = await report(me);
    await answered(me, r, "mine");
    const c = await ask.claimAsk({ userId: me, clientKey: crypto.randomUUID(), day: DAY, question: "in flight", reportId: null, max: 1e6 });
    assert.ok(c.ok);
    const d = await db();
    const [before] = await d.select().from(schema.askTotals).where(eq(schema.askTotals.day, DAY));
    g.__testUser = { id: me, email: `${me}@example.com` };
    const res = await deleteAccount(new Request("http://localhost/api/account/delete", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) }));
    assert.equal(res.status, 200);
    assert.equal((await turns(me)).length, 0);
    assert.equal((await d.select().from(schema.askDays).where(eq(schema.askDays.userId, me))).length, 0);
    const [left] = await d.select().from(schema.askTotals).where(eq(schema.askTotals.day, DAY));
    assert.equal(left.attempts, before.attempts);
  });
});
