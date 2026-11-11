// The plan's rules (lib/domain/plan.ts) and Razorpay's signatures (lib/billing/signature.ts).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { checkoutSignatureOk, webhookSignatureOk } from "../lib/billing/signature.ts";
import { PLAN, canBuy, passWindow, refusalFor } from "../lib/domain/plan.ts";

const counts = (c: Partial<{ readsTotal: number; readsInPass: number; mealsTotal: number; mealsToday: number }> = {}) => ({
  readsTotal: 0, readsInPass: 0, mealsTotal: 0, mealsToday: 0, ...c,
});
const DAY = 24 * 60 * 60_000;
const now = new Date("2026-11-11T06:00:00Z");
const pass = { startsAt: new Date(now.getTime() - 5 * DAY), endsAt: new Date(now.getTime() + 25 * DAY) };

describe("plan rules", () => {
  it("gives 2 free reads, then asks for a pass", () => {
    assert.equal(refusalFor("read", null, counts({ readsTotal: 1 })), null);
    assert.equal(refusalFor("read", null, counts({ readsTotal: 2 })), "free_reads_used");
  });
  it("gives 3 reads in a pass, whatever was used before it", () => {
    assert.equal(refusalFor("read", pass, counts({ readsTotal: 9, readsInPass: 2 })), null);
    assert.equal(refusalFor("read", pass, counts({ readsTotal: 9, readsInPass: 3 })), "pass_reads_used");
  });
  it("gives 20 free meal logs and 5 a day for everyone", () => {
    assert.equal(refusalFor("meal", null, counts({ mealsTotal: 19, mealsToday: 4 })), null);
    assert.equal(refusalFor("meal", null, counts({ mealsTotal: 12, mealsToday: 5 })), "meals_today_used");
    assert.equal(refusalFor("meal", null, counts({ mealsTotal: 20, mealsToday: 0 })), "free_meals_used");
    assert.equal(refusalFor("meal", pass, counts({ mealsTotal: 400, mealsToday: 4 })), null);
    assert.equal(refusalFor("meal", pass, counts({ mealsTotal: 400, mealsToday: 5 })), "meals_today_used");
  });
  it("says to pay before saying to wait when both apply", () => {
    assert.equal(refusalFor("meal", null, counts({ mealsTotal: 20, mealsToday: 5 })), "free_meals_used");
  });
  it("sells a pass only without one or in its last days", () => {
    assert.equal(canBuy(null, now), true);
    assert.equal(canBuy({ endsAt: new Date(now.getTime() + 10 * DAY) }, now), false);
    assert.equal(canBuy({ endsAt: new Date(now.getTime() + 2 * DAY) }, now), true);
  });
  it("starts a pass now, or when the current one ends", () => {
    const fresh = passWindow(null, now);
    assert.equal(fresh.startsAt.getTime(), now.getTime());
    assert.equal(fresh.endsAt.getTime() - fresh.startsAt.getTime(), PLAN.days * DAY);
    const next = passWindow(pass.endsAt, now);
    assert.equal(next.startsAt.getTime(), pass.endsAt.getTime());
    const lapsed = passWindow(new Date(now.getTime() - DAY), now);
    assert.equal(lapsed.startsAt.getTime(), now.getTime());
  });
  it("charges ₹49", () => {
    assert.equal(PLAN.pricePaise, 4900);
    assert.equal(PLAN.currency, "INR");
  });
});

describe("Razorpay signatures", () => {
  const hex = (secret: string, message: string) => createHmac("sha256", secret).update(message).digest("hex");
  it("checks Checkout's signature over order id | payment id with the key secret", () => {
    const sig = hex("key_secret", "order_ABC|pay_XYZ");
    assert.equal(checkoutSignatureOk("order_ABC", "pay_XYZ", sig, "key_secret"), true);
    assert.equal(checkoutSignatureOk("order_ABC", "pay_XYZ", sig.toUpperCase(), "key_secret"), true);
    assert.equal(checkoutSignatureOk("order_OTHER", "pay_XYZ", sig, "key_secret"), false);
    assert.equal(checkoutSignatureOk("order_ABC", "pay_XYZ", hex("key_secret", "pay_XYZ|order_ABC"), "key_secret"), false);
    assert.equal(checkoutSignatureOk("order_ABC", "pay_XYZ", sig, "other_secret"), false);
    assert.equal(checkoutSignatureOk("order_ABC", "pay_XYZ", sig, ""), false);
    assert.equal(checkoutSignatureOk("order_ABC", "pay_XYZ", "short", "key_secret"), false);
  });
  it("checks a webhook's signature over the raw body with the webhook secret", () => {
    const body = '{"event":"payment.captured","payload":{}}';
    const sig = hex("whsec", body);
    assert.equal(webhookSignatureOk(body, sig, "whsec"), true);
    assert.equal(webhookSignatureOk(body.replace("captured", "failed"), sig, "whsec"), false);
    assert.equal(webhookSignatureOk(JSON.stringify(JSON.parse(body), null, 1), sig, "whsec"), false);
    assert.equal(webhookSignatureOk(body, sig, ""), false);
  });
});
