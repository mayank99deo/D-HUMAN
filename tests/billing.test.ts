// The paywall and the ₹49 pass against a real embedded database, with Razorpay
// stubbed: free and paid limits hold under parallel requests, failures hand uses
// back, a pass is granted once per order however many times it's confirmed, and
// the webhook only acts on a valid signature.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Payment = { id: string; order_id: string; amount: number; currency: string; status: string; method?: string };
type TestGlobals = {
  __testUser?: { id: string; email: string } | null;
  __payments: Record<string, Payment>;
  __orders: number;
  __captures: string[];
  __captureFails: Set<string>;
  __mode: "test" | "live";
  __orderCalls: number;
};
const g = globalThis as unknown as TestGlobals;
g.__payments = {};
g.__orders = 0;
g.__captures = [];
g.__captureFails = new Set();
g.__mode = "test";
g.__orderCalls = 0;

allowAppImports({
  // Claude is never called here: the claim and plan code only need these names to exist.
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "mock";`,
  "@/lib/ai/report": `export const extractReport = () => { throw new Error("AI in a test"); }; export const interpretReport = extractReport;`,
  "@/lib/ai/events": `export const searchEvents = () => { throw new Error("AI in a test"); };`,
  "@/lib/ai/food": `export const estimateMeal = () => { throw new Error("AI in a test"); }; export const estimateTypicalDay = estimateMeal;`,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "@/lib/billing/razorpay": `
    export const paymentsOn = () => true;
    export const keyId = () => "rzp_test_key";
    export const keySecret = () => "key_secret";
    export const webhookSecret = () => "whsec";
    export const keyMode = () => globalThis.__mode;
    export class RazorpayError extends Error { constructor(status, message) { super(message); this.status = status; } }
    export const createOrder = async (o) => ({ id: "order_" + (++globalThis.__orders), amount: o.amount, currency: o.currency, receipt: o.receipt, status: "created" });
    export const fetchPayment = async (id) => { const p = globalThis.__payments[id]; if (!p) throw new RazorpayError(404, "not found"); return { ...p }; };
    export const capturePayment = async (id) => {
      if (globalThis.__captureFails.has(id)) throw new RazorpayError(502, "capture failed");
      globalThis.__captures.push(id); globalThis.__payments[id].status = "captured"; return { ...globalThis.__payments[id] };
    };
    export const orderPayments = async (orderId) => { globalThis.__orderCalls++; return { items: Object.values(globalThis.__payments).filter((p) => p.order_id === orderId) }; };
  `,
});
const removeDatabase = tempDatabase();
const { eq, sql } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { claimReport, settleStaleRead, settleStaleReads } = await import("../lib/platform/analyze.ts");
const { claimMeal, planView, releaseUse } = await import("../lib/platform/plan.ts");
const { reconcileOrders, settle, startPass } = await import("../lib/platform/billing.ts");
const { POST: foodRoute } = await import("../app/api/food/route.ts");
const { POST: verifyRoute } = await import("../app/api/billing/verify/route.ts");
const { POST: webhookRoute } = await import("../app/api/billing/webhook/route.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

let n = 0;
async function newUser() {
  const d = await db();
  const id = `user-${++n}`;
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  return { id, email: `${id}@example.com` };
}
async function newReport(userId: string) {
  const d = await db();
  const id = `report-${++n}`;
  await d.insert(schema.reports).values({ id, userId });
  return id;
}
const sign = (secret: string, message: string) => createHmac("sha256", secret).update(message).digest("hex");
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

async function paidPass(user: { id: string; email: string }) {
  const r = await startPass(user);
  assert.ok(r.ok);
  const payId = `pay_${++n}`;
  g.__payments[payId] = { id: payId, order_id: r.checkout.orderId, amount: 4900, currency: "INR", status: "captured", method: "upi" };
  return { orderId: r.checkout.orderId, payId };
}

describe("free limits", () => {
  it("allows 2 free reads, even when many start at once, and hands back a failed one", async () => {
    const user = await newUser();
    const reports = await Promise.all(Array.from({ length: 6 }, () => newReport(user.id)));
    const claims = await Promise.all(reports.map((r) => claimReport(r, user.id)));
    const won = reports.filter((_, i) => claims[i].ok);
    assert.equal(won.length, 2);
    const refused = claims.filter((c) => !c.ok);
    assert.ok(refused.every((c) => !c.ok && c.reason === "plan_limit" && c.refusal === "free_reads_used"));

    await releaseUse("read", won[0]);
    const again = await claimReport(reports.find((r) => !won.includes(r))!, user.id);
    assert.ok(again.ok, "a failed read doesn't count");
  });

  it("never reads a finished report again", async () => {
    const user = await newUser();
    const id = await newReport(user.id);
    assert.ok((await claimReport(id, user.id)).ok);
    const d = await db();
    await d.update(schema.reports).set({ status: "ready" }).where(eq(schema.reports.id, id));
    const c = await claimReport(id, user.id);
    assert.ok(!c.ok && c.reason === "already_read");
  });

  it("allows 5 meal logs a day and 20 in all", async () => {
    const user = await newUser();
    const today = await Promise.all(Array.from({ length: 12 }, (_, i) => claimMeal(user.id, `meal-a${i}`, "2026-11-11")));
    assert.equal(today.filter((r) => r === null).length, 5);
    assert.ok(today.filter((r) => r !== null).every((r) => r === "meals_today_used"));

    const days = ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
    const results: (string | null)[] = [];
    for (const day of days) for (let i = 0; i < 5; i++) results.push(await claimMeal(user.id, `meal-${day}-${i}`, day));
    assert.equal(results.filter((r) => r === null).length, 15, "20 in all");
    assert.equal(results.at(-1), "free_meals_used");
  });
});

describe("the ₹49 pass", () => {
  let user: { id: string; email: string };
  before(async () => {
    user = await newUser();
  });

  it("is granted once per order, for 30 days, however often it's confirmed", async () => {
    const { payId } = await paidPass(user);
    const results = await Promise.all([settle(g.__payments[payId]), settle(g.__payments[payId]), settle(g.__payments[payId])]);
    assert.deepEqual(results.filter((r) => r === "granted").length, 1);
    const d = await db();
    const rows = await d.select().from(schema.payments).where(eq(schema.payments.userId, user.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "paid");
    assert.equal(rows[0].paymentId, payId);
    assert.equal(rows[0].endsAt!.getTime() - rows[0].startsAt!.getTime(), 30 * 24 * 60 * 60_000);

    const view = await planView(user.id, "Asia/Kolkata");
    assert.ok(view.pass);
    assert.deepEqual(view.reads, { used: 0, limit: 3, free: false });
    assert.equal(view.meals.freeLimit, null);
    assert.equal(view.canBuy, false);
  });

  it("isn't sold again while a pass has more than 3 days left", async () => {
    const r = await startPass(user);
    assert.ok(!r.ok && r.reason === "covered");
  });

  it("gives 3 reads in the pass", async () => {
    const reports = await Promise.all(Array.from({ length: 5 }, () => newReport(user.id)));
    const claims = await Promise.all(reports.map((r) => claimReport(r, user.id)));
    assert.equal(claims.filter((c) => c.ok).length, 3);
    assert.ok(claims.filter((c) => !c.ok).every((c) => !c.ok && c.reason === "plan_limit" && c.refusal === "pass_reads_used"));
  });

  it("refuses a payment for the wrong amount or someone else's order", async () => {
    const other = await newUser();
    const r = await startPass(other);
    assert.ok(r.ok);
    assert.equal(await settle({ id: "pay_cheap", order_id: r.checkout.orderId, amount: 100, currency: "INR", status: "captured" }), "mismatch");
    assert.equal(await settle({ id: "pay_stray", order_id: "order_not_ours", amount: 4900, currency: "INR", status: "captured" }), "unknown_order");
    assert.equal((await planView(other.id, null)).pass, null);
  });

  it("captures an authorised payment before granting", async () => {
    const other = await newUser();
    const { payId } = await paidPass(other);
    g.__payments[payId].status = "authorized";
    assert.equal(await settle(g.__payments[payId]), "granted");
    assert.ok(g.__captures.includes(payId));
  });

  it("starts a pass bought in the last days when the current one ends", async () => {
    const other = await newUser();
    const first = await paidPass(other);
    await settle(g.__payments[first.payId]);
    const d = await db();
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60_000);
    await d.update(schema.payments).set({ endsAt: soon }).where(eq(schema.payments.orderId, first.orderId));
    const second = await paidPass(other);
    assert.equal(await settle(g.__payments[second.payId]), "granted");
    const [row] = await d.select().from(schema.payments).where(eq(schema.payments.orderId, second.orderId));
    assert.equal(row.startsAt!.getTime(), soon.getTime());
    const view = await planView(other.id, null);
    assert.ok(view.queuedUntil);
    assert.equal(view.canBuy, false);
  });
});

describe("billing routes", () => {
  it("verify grants only with Checkout's signature over the stored order", async () => {
    const user = await newUser();
    g.__testUser = user;
    const { orderId, payId } = await paidPass(user);
    const bad = await verifyRoute(post({ razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sign("key_secret", `order_x|${payId}`) }));
    assert.equal(bad.status, 400);
    const good = await verifyRoute(post({ razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sign("key_secret", `${orderId}|${payId}`) }));
    assert.equal(good.status, 200);
    assert.ok((await planView(user.id, null)).pass);

    // Someone else can't confirm this order, even with a valid signature.
    g.__testUser = await newUser();
    const stranger = await verifyRoute(post({ razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sign("key_secret", `${orderId}|${payId}`) }));
    assert.equal(stranger.status, 400);
    g.__testUser = null;
  });

  it("the webhook acts only on a valid signature, and repeats are harmless", async () => {
    const user = await newUser();
    const { payId } = await paidPass(user);
    const body = JSON.stringify({ entity: "event", event: "payment.captured", contains: ["payment"], payload: { payment: { entity: g.__payments[payId] } } });

    const forged = await webhookRoute(post(body, { "x-razorpay-signature": sign("wrong", body) }));
    assert.equal(forged.status, 401);
    assert.equal((await planView(user.id, null)).pass, null);

    const real = await webhookRoute(post(body, { "x-razorpay-signature": sign("whsec", body), "x-razorpay-event-id": "evt_1" }));
    assert.equal(real.status, 200);
    assert.ok((await planView(user.id, null)).pass);
    const again = await webhookRoute(post(body, { "x-razorpay-signature": sign("whsec", body), "x-razorpay-event-id": "evt_1" }));
    assert.equal(again.status, 200);

    const ignored = JSON.stringify({ event: "refund.created", payload: {} });
    assert.equal((await webhookRoute(post(ignored, { "x-razorpay-signature": sign("whsec", ignored) }))).status, 200);
  });
});

describe("review fixes", () => {
  it("records a meal's use under the meal's own id, so the migration's backfill can't count it twice", async () => {
    const user = await newUser();
    const d = await db();
    await d.update(schema.profiles).set({ onboardedAt: new Date() }).where(eq(schema.profiles.userId, user.id)).catch(() => {});
    const [hasProfile] = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    if (!hasProfile) await d.insert(schema.profiles).values({ userId: user.id, onboardedAt: new Date() });
    g.__testUser = user;
    const form = new FormData();
    form.append("source", "text");
    form.append("text", "2 rotis and dal");
    const res = await foodRoute(new Request("http://localhost/api/food", { method: "POST", body: form }));
    g.__testUser = null;
    assert.equal(res.status, 200);
    const [log] = await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, user.id));
    const uses = await d.select().from(schema.usage).where(eq(schema.usage.userId, user.id));
    assert.equal(uses.length, 1);
    assert.equal(uses[0].refId, log.id);
    // The backfill in 0004, run again: nothing new.
    await d.execute(sql.raw(`INSERT INTO "usage" ("id","user_id","kind","ref_id","local_date","created_at") SELECT gen_random_uuid()::text, "user_id", 'meal', "id", "local_date", "created_at" FROM "food_logs" ON CONFLICT DO NOTHING`));
    assert.equal((await d.select().from(schema.usage).where(eq(schema.usage.userId, user.id))).length, 1);
  });

  it("hands back the use of a read that died, and keeps a finished read's", async () => {
    const user = await newUser();
    const d = await db();
    const dead = await newReport(user.id);
    const done = await newReport(user.id);
    assert.ok((await claimReport(dead, user.id)).ok);
    assert.ok((await claimReport(done, user.id)).ok);
    const old = new Date(Date.now() - 60 * 60_000);
    await d.update(schema.reports).set({ startedAt: old }).where(eq(schema.reports.id, dead));
    await d.update(schema.reports).set({ status: "ready", startedAt: old }).where(eq(schema.reports.id, done));
    assert.equal((await planView(user.id, null)).reads.used, 2);
    assert.equal(await settleStaleRead(done, user.id), false);
    assert.equal(await settleStaleReads(user.id), 1);
    assert.equal((await planView(user.id, null)).reads.used, 1);
    const [r] = await d.select().from(schema.reports).where(eq(schema.reports.id, dead));
    assert.equal(r.status, "failed");
    assert.ok((await claimReport(dead, user.id)).ok, "the dead read can be retried");
  });

  it("asks Razorpay to retry a webhook when a capture fails", async () => {
    const user = await newUser();
    const { payId } = await paidPass(user);
    g.__payments[payId].status = "authorized";
    g.__captureFails.add(payId);
    const body = JSON.stringify({ event: "payment.authorized", payload: { payment: { entity: g.__payments[payId] } } });
    const res = await webhookRoute(post(body, { "x-razorpay-signature": sign("whsec", body) }));
    assert.equal(res.status, 503);
    assert.equal((await planView(user.id, null)).pass, null);
    g.__captureFails.delete(payId);
    const retry = await webhookRoute(post(body, { "x-razorpay-signature": sign("whsec", body) }));
    assert.equal(retry.status, 200);
    assert.ok((await planView(user.id, null)).pass);
  });

  it("never counts a test-mode pass under live keys", async () => {
    const user = await newUser();
    const { payId } = await paidPass(user);
    await settle(g.__payments[payId]);
    assert.ok((await planView(user.id, null)).pass);
    g.__mode = "live";
    try {
      const live = await planView(user.id, null);
      assert.equal(live.pass, null);
      assert.equal(live.reads.free, true);
    } finally {
      g.__mode = "test";
    }
  });

  it("finds a paid order the webhook missed, checking each order at most every 2 minutes", async () => {
    const user = await newUser();
    const { payId } = await paidPass(user);
    const before = g.__orderCalls;
    assert.equal(await reconcileOrders(user.id), true);
    assert.ok((await planView(user.id, null)).pass);
    assert.equal(g.__orderCalls, before + 1);

    const other = await newUser();
    const r = await startPass(other); // opened Checkout, never paid
    assert.ok(r.ok);
    assert.equal(await reconcileOrders(other.id), false);
    assert.equal(await reconcileOrders(other.id), false);
    assert.equal(g.__orderCalls, before + 2, "an unpaid order isn't asked about again straight away");
    void payId;
  });
});
