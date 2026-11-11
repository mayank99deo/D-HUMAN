import "server-only";

// Razorpay's REST API, called with the API key (HTTP Basic). Only what the ₹49
// pass needs: create an order, fetch a payment, capture an authorised one.
// Docs: razorpay.com/docs/api/orders/create and /api/payments.

const API = "https://api.razorpay.com/v1";

// Payments stay off until the webhook is set up too: it is what grants a pass when the browser never reports back.
export const paymentsOn = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET);
export const keyId = () => process.env.RAZORPAY_KEY_ID ?? "";
export const keySecret = () => process.env.RAZORPAY_KEY_SECRET ?? "";
export const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
/** Test keys make test passes, which never count under live keys. Without keys, live passes count. */
export const keyMode = (): "test" | "live" => (keyId().startsWith("rzp_test_") ? "test" : "live");

export type RzpOrder = { id: string; amount: number; currency: string; receipt: string | null; status: string };
export type RzpPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed" | string;
  method?: string | null;
  captured?: boolean;
};

export class RazorpayError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Basic ${auth}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new RazorpayError(res.status, data.error?.description ?? `Razorpay answered ${res.status}`);
  return data;
}

export const createOrder = (order: { amount: number; currency: string; receipt: string; notes: Record<string, string> }) => call<RzpOrder>("/orders", order);
export const fetchPayment = (id: string) => call<RzpPayment>(`/payments/${encodeURIComponent(id)}`);
export const orderPayments = (orderId: string) => call<{ items: RzpPayment[] }>(`/orders/${encodeURIComponent(orderId)}/payments`);
export const capturePayment = (id: string, amount: number, currency: string) =>
  call<RzpPayment>(`/payments/${encodeURIComponent(id)}/capture`, { amount, currency });
