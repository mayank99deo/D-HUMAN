// Opens Razorpay Standard Checkout for the ₹49 pass. The order comes from our
// server (/api/billing/order); on success the browser hands the signed result to
// /api/billing/verify, which checks it and grants the pass. If that hand-off is
// lost, Razorpay's webhook grants it anyway.
import { OFFLINE, send } from "./net";

type Checkout = { keyId: string; orderId: string; amount: number; currency: string; email: string };
type Success = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type Rzp = { open(): void; on(event: "payment.failed", cb: (r: unknown) => void): void };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => Rzp;
  }
}

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<boolean> | null = null;

// Loads Razorpay's script once; gives up after 15 s so a button never hangs.
function loadCheckout(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  loading ??= new Promise((resolve) => {
    const s = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      loading = null;
      s.remove();
      resolve(false);
    };
    const timer = setTimeout(fail, 15_000);
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => {
      clearTimeout(timer);
      resolve(!!window.Razorpay);
    };
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return loading;
}

export type BuyResult = { state: "paid" } | { state: "pending" } | { state: "closed" } | { state: "error"; message: string };

const ORDER_ERRORS: Record<string, string> = {
  payments_off: "Payments aren't switched on yet. Try again soon.",
  covered: "You already have a pass. You can buy the next one in its last few days.",
  rate_limited: "Too many tries. Wait a few minutes and try again.",
  signed_out: "You've been signed out. Sign in and try again.",
};

export async function buyPass(): Promise<BuyResult> {
  // The script loads while the order is made, but a failed order is reported at once.
  const script = loadCheckout();
  const order = await send<Checkout>("/api/billing/order");
  if (!order.ok) {
    return { state: "error", message: order.offline ? OFFLINE : (ORDER_ERRORS[order.data.error ?? ""] ?? "We couldn't start the payment. Try again in a minute.") };
  }
  const loaded = await script;
  if (!loaded || !window.Razorpay) return { state: "error", message: "We couldn't open the payment window. Check your connection and try again." };
  const c = order.data as Checkout;
  const Razorpay = window.Razorpay;

  return new Promise((resolve) => {
    let done = false;
    const finish = (r: BuyResult) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const rzp = new Razorpay({
      key: c.keyId,
      amount: c.amount,
      currency: c.currency,
      order_id: c.orderId,
      name: "D-Human",
      description: "30 days of D-Human",
      prefill: { email: c.email },
      theme: { color: "#000000" },
      handler: async (r: Success) => {
        const v = await send("/api/billing/verify", { body: r, timeoutMs: 30_000 });
        if (v.ok && v.status === 200) return finish({ state: "paid" });
        if (v.status === 202 || v.offline) return finish({ state: "pending" });
        finish({ state: "error", message: "We couldn't confirm that payment. If money left your account, it will be matched within a few minutes, so don't pay again." });
      },
      // Checkout shows a failed attempt itself and lets them try again; closing it ends the purchase.
      modal: { ondismiss: () => finish({ state: "closed" }) },
    });
    rzp.on("payment.failed", () => {});
    rzp.open();
  });
}
