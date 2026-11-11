import "server-only";
import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { newId } from "@/lib/auth/crypto";
import { capturePayment, createOrder, fetchPayment, keyId, keyMode, keySecret, orderPayments, paymentsOn, type RzpPayment } from "@/lib/billing/razorpay";
import { checkoutSignatureOk } from "@/lib/billing/signature";
import { db, schema } from "@/lib/db";
import { PLAN, canBuy, passWindow } from "@/lib/domain/plan";
import { coveredUntil } from "./plan";

// The ₹49 pass through Razorpay Orders and Standard Checkout:
// 1. startPass creates an order for this person and remembers it.
// 2. Checkout takes the payment; the browser sends its signature to confirmCheckout,
//    which checks it against the order we stored and fetches the payment itself.
// 3. Razorpay's signed webhook (payment.captured, order.paid) settles the same order,
//    so a person who closes the tab mid-payment still gets their pass.
// settle() is the one place a pass is granted; it's safe to run any number of times.

const pay = schema.payments;

export type Checkout = { keyId: string; orderId: string; amount: number; currency: string; email: string };

export async function startPass(user: { id: string; email: string }): Promise<{ ok: true; checkout: Checkout } | { ok: false; reason: "payments_off" | "covered" }> {
  if (!paymentsOn()) return { ok: false, reason: "payments_off" };
  const d = await db();
  const until = await coveredUntil(d, user.id);
  if (!canBuy(until && until > new Date() ? { endsAt: until } : null)) return { ok: false, reason: "covered" };
  const id = newId();
  const order = await createOrder({ amount: PLAN.pricePaise, currency: PLAN.currency, receipt: id, notes: { user_id: user.id } });
  await d.insert(pay).values({ id, userId: user.id, orderId: order.id, amount: PLAN.pricePaise, currency: PLAN.currency, mode: keyMode() });
  return { ok: true, checkout: { keyId: keyId(), orderId: order.id, amount: PLAN.pricePaise, currency: PLAN.currency, email: user.email } };
}

export type Settled = "granted" | "already" | "pending" | "mismatch" | "unknown_order";

/** Grants the pass for a captured payment on one of our orders. Captures an authorised one first. */
export async function settle(payment: RzpPayment): Promise<Settled> {
  if (!payment?.id || !payment.order_id) return "unknown_order";
  const d = await db();
  const [row] = await d.select().from(pay).where(eq(pay.orderId, payment.order_id)).limit(1);
  // Not ours (the same Razorpay account may take payments for other things; never touch those),
  // or the order of an account deleted since. Logged so a person charged for nothing can be refunded.
  if (!row) {
    if (payment.status === "captured") console.warn(`[billing] ALERT captured payment ${payment.id} on order ${payment.order_id}, which isn't ours or belongs to a deleted account`);
    return "unknown_order";
  }
  if (row.status === "paid") return "already";
  if (payment.amount !== row.amount || payment.currency !== row.currency) {
    console.error(`[billing] ALERT payment ${payment.id} on order ${row.orderId}: ${payment.amount} ${payment.currency}, expected ${row.amount} ${row.currency}; refund by hand`);
    return "mismatch";
  }

  let p = payment;
  if (p.status === "authorized") {
    // Accounts set to manual capture leave payments authorised; uncaptured ones are refunded after 3 days.
    p = await capturePayment(p.id, row.amount, row.currency).catch(async (error) => {
      console.warn(`[billing] capture of ${p.id} failed; checking its state`, error);
      return fetchPayment(p.id);
    });
  }
  if (p.status !== "captured") return "pending";

  return d.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pass:${row.userId}`}))`);
    const [fresh] = await tx.select({ status: pay.status }).from(pay).where(eq(pay.id, row.id)).limit(1);
    if (!fresh || fresh.status === "paid") return "already" as const;
    // A pass bought before the current one ends starts when it ends.
    const window = passWindow(await coveredUntil(tx, row.userId));
    const now = new Date();
    const done = await tx
      .update(pay)
      .set({ status: "paid", paymentId: p.id, method: p.method ?? null, startsAt: window.startsAt, endsAt: window.endsAt, paidAt: now })
      .where(and(eq(pay.id, row.id), ne(pay.status, "paid")))
      .returning({ id: pay.id });
    if (done.length) console.info(`[billing] pass ${row.id} paid by ${p.id}, ${window.startsAt.toISOString()} to ${window.endsAt.toISOString()}`);
    return done.length ? ("granted" as const) : ("already" as const);
  });
}

/** The browser's word that Checkout succeeded. Trusted only after the signature and Razorpay's own record agree. */
export async function confirmCheckout(
  userId: string,
  { orderId, paymentId, signature }: { orderId: string; paymentId: string; signature: string },
): Promise<Settled | "invalid"> {
  const d = await db();
  const [row] = await d
    .select()
    .from(pay)
    .where(and(eq(pay.orderId, orderId), eq(pay.userId, userId)))
    .limit(1);
  if (!row) return "invalid";
  // The order id signed over is the one we stored, never one the browser sent us.
  if (!checkoutSignatureOk(row.orderId, paymentId, signature, keySecret())) return "invalid";
  if (row.status === "paid") return "already";
  const payment = await fetchPayment(paymentId);
  if (payment.order_id !== row.orderId) return "invalid";
  return settle(payment);
}

const DAY_MS = 24 * 60 * 60_000;
const CHECK_EVERY_MS = 2 * 60_000;

/**
 * The fallback when a webhook is missed or a capture failed: asks Razorpay about
 * this person's recent unpaid orders and settles any that were paid. Orders are
 * checked at most every 2 minutes, and only for 3 days, after which Razorpay
 * refunds an uncaptured payment anyway.
 */
export async function reconcileOrders(userId: string): Promise<boolean> {
  if (!paymentsOn()) return false;
  const d = await db();
  const now = Date.now();
  const open = await d
    .select()
    .from(pay)
    .where(
      and(
        eq(pay.userId, userId),
        eq(pay.status, "created"),
        eq(pay.mode, keyMode()),
        gt(pay.createdAt, new Date(now - 3 * DAY_MS)),
        or(isNull(pay.checkedAt), lt(pay.checkedAt, new Date(now - CHECK_EVERY_MS))),
      ),
    )
    .orderBy(desc(pay.createdAt))
    .limit(3);
  let granted = false;
  for (const row of open) {
    await d.update(pay).set({ checkedAt: new Date() }).where(eq(pay.id, row.id));
    const { items } = await orderPayments(row.orderId);
    const paid = items.find((p) => p.status === "captured") ?? items.find((p) => p.status === "authorized");
    if (paid && (await settle(paid)) === "granted") granted = true;
  }
  return granted;
}

type WebhookEvent = { event?: string; payload?: { payment?: { entity?: RzpPayment } } };
const SETTLING_EVENTS = new Set(["payment.authorized", "payment.captured", "order.paid"]);

/** A webhook whose signature has been checked. Other events are acknowledged and ignored. */
export async function handleWebhook(event: WebhookEvent): Promise<Settled | "ignored"> {
  if (!event?.event || !SETTLING_EVENTS.has(event.event)) return "ignored";
  const payment = event.payload?.payment?.entity;
  if (!payment?.id) return "ignored";
  return settle(payment);
}
