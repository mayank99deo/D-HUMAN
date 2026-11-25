// The Resend webhook (app/api/email/webhook): checked with the installed SDK's own
// Standard Webhooks verification over the raw body; bounces, spam reports and Resend's
// suppression list mirrored into email_suppressions (hashed) and the send ledger; replays
// harmless. And the sign-in screen's plain warning for an address on that list, which
// never stops the code itself from going.
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

const g = globalThis as unknown as { __codes: { email: string; code: string }[] };
g.__codes = [];
allowAppImports({
  "@/lib/auth/email": "export const sendSignInCode = async (email, code) => { globalThis.__codes.push({ email, code }); return true; };",
});
const removeDatabase = tempDatabase();
const SECRET_BYTES = randomBytes(24);
process.env.RESEND_WEBHOOK_SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
delete process.env.RESEND_API_KEY;

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { POST: webhook } = await import("../app/api/email/webhook/route.ts");
const { POST: codeRoute } = await import("../app/api/auth/code/route.ts");
const { emailHash, isSuppressed } = await import("../lib/email/suppress.ts");
const { getPrefs } = await import("../lib/email/prefs.ts");

after(async () => {
  await removeDatabase();
});

// Signs the way Resend (Svix) does: base64 HMAC-SHA-256 of "id.timestamp.body" with the
// secret's decoded bytes, sent as "v1,<sig>".
function signed(body: string, opts: { id?: string; at?: number; key?: Buffer } = {}) {
  const id = opts.id ?? `msg_${randomBytes(6).toString("hex")}`;
  const ts = String(Math.floor((opts.at ?? Date.now()) / 1000));
  const sig = createHmac("sha256", opts.key ?? SECRET_BYTES).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "content-type": "application/json" };
}
const post = (body: string, headers: Record<string, string>) => webhook(new Request("https://www.d-human.fit/api/email/webhook", { method: "POST", headers, body }));
const emailEvent = (type: string, data: Record<string, unknown>) =>
  JSON.stringify({ type, created_at: new Date().toISOString(), data: { created_at: new Date().toISOString(), from: "D-Human <hello@dhuman.fit>", subject: "Your week", message_id: "<m@resend>", ...data } });

let n = 0;
async function personWithSend(status = "sent") {
  const d = await db();
  const id = `40000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const email = `inbox${n}@example.com`;
  await d.insert(schema.users).values({ id, email });
  const sendId = `send-${n}`;
  await d.insert(schema.emailSends).values({ id: sendId, userId: id, kind: "weekly", dedupeKey: "2026-11-16", localDate: "2026-11-22", status, providerId: `re_${n}`, sentAt: new Date() });
  return { id, email, sendId, providerId: `re_${n}` };
}
const sendRow = async (id: string) => {
  const d = await db();
  const [r] = await d.select().from(schema.emailSends).where(eq(schema.emailSends.id, id));
  return r;
};

describe("signature", () => {
  it("accepts a correctly signed event and refuses any change to it", async () => {
    const p = await personWithSend();
    const body = emailEvent("email.delivered", { email_id: p.providerId, to: [p.email] });
    assert.equal((await post(body, signed(body))).status, 200);

    const headers = signed(body);
    assert.equal((await post(body.replace("Your week", "Your weel"), headers)).status, 401, "one changed byte");
    assert.equal((await post(body, { ...headers, "svix-signature": "v1,AAAA" })).status, 401);
    assert.equal((await post(body, signed(body, { key: randomBytes(24) }))).status, 401, "another secret");
    assert.equal((await post(body, signed(body, { at: Date.now() - 10 * 60_000 }))).status, 401, "too old to be fresh");
    const noId: Record<string, string> = signed(body);
    delete noId["svix-id"];
    assert.equal((await post(body, noId)).status, 401);
    assert.equal((await post(body, { "content-type": "application/json" })).status, 401);
  });

  it("answers 503 until RESEND_WEBHOOK_SECRET is set, and 413 for an oversized body", async () => {
    const body = emailEvent("email.delivered", { email_id: "x", to: ["a@example.com"] });
    const saved = process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.RESEND_WEBHOOK_SECRET;
    try {
      assert.equal((await post(body, signed(body))).status, 503);
    } finally {
      process.env.RESEND_WEBHOOK_SECRET = saved;
    }
    const big = "x".repeat(300 * 1024);
    assert.equal((await post(big, signed(big))).status, 413);
  });
});

describe("events", () => {
  it("a hard bounce suppresses the address (hashed) and marks the send", async () => {
    const p = await personWithSend();
    const body = emailEvent("email.bounced", { email_id: p.providerId, to: [p.email], bounce: { type: "Permanent", subType: "General", message: "no such user" } });
    assert.equal((await post(body, signed(body))).status, 200);
    assert.equal((await sendRow(p.sendId)).status, "bounced");
    assert.equal(await isSuppressed(p.email.toUpperCase()), true);
    const d = await db();
    const rows = await d.select().from(schema.emailSuppressions).where(eq(schema.emailSuppressions.emailHash, emailHash(p.email)));
    assert.equal(rows[0].reason, "bounce");
    assert.doesNotMatch(JSON.stringify(rows), /@/, "no address is stored");
  });

  it("a soft bounce marks the send but doesn't suppress the address", async () => {
    const p = await personWithSend();
    const body = emailEvent("email.bounced", { email_id: p.providerId, to: [p.email], bounce: { type: "Transient", subType: "MailboxFull", message: "full" } });
    assert.equal((await post(body, signed(body))).status, 200);
    assert.equal((await sendRow(p.sendId)).status, "bounced");
    assert.equal(await isSuppressed(p.email), false);
  });

  it("a spam report suppresses the address and turns off every email the person could stop", async () => {
    const p = await personWithSend();
    const body = emailEvent("email.complained", { email_id: p.providerId, to: [p.email] });
    assert.equal((await post(body, signed(body))).status, 200);
    assert.equal((await sendRow(p.sendId)).status, "complained");
    assert.equal(await isSuppressed(p.email), true);
    const prefs = await getPrefs(p.id);
    assert.deepEqual([prefs.weekly, prefs.questions], [false, false]);
    const d = await db();
    const [row] = await d.select().from(schema.emailPrefs).where(eq(schema.emailPrefs.userId, p.id));
    assert.equal(row.updatedVia, "complaint");

    // Replays and late events change nothing: a "failed" arriving afterwards can't hide the report.
    assert.equal((await post(body, signed(body))).status, 200);
    const late = emailEvent("email.failed", { email_id: p.providerId, to: [p.email], failed: { reason: "late" } });
    assert.equal((await post(late, signed(late))).status, 200);
    assert.equal((await sendRow(p.sendId)).status, "complained");
  });

  it("finds a send by its send_id tag when Resend's id was never recorded", async () => {
    const p = await personWithSend("sending");
    const d = await db();
    await d.update(schema.emailSends).set({ providerId: null }).where(eq(schema.emailSends.id, p.sendId));
    const body = emailEvent("email.suppressed", { email_id: "re_new", to: [p.email], tags: { kind: "weekly", send_id: p.sendId }, suppressed: { type: "OnAccountSuppressionList", message: "suppressed" } });
    assert.equal((await post(body, signed(body))).status, 200);
    const r = await sendRow(p.sendId);
    assert.equal(r.status, "suppressed");
    assert.equal(r.providerId, "re_new");
    assert.equal(await isSuppressed(p.email), true);
  });

  it("marks a send delivered; a later bounce or spam report still counts, and a late 'delivered' can't hide one", async () => {
    const p = await personWithSend();
    const delivered = emailEvent("email.delivered", { email_id: p.providerId, to: [p.email] });
    assert.equal((await post(delivered, signed(delivered))).status, 200);
    assert.equal((await sendRow(p.sendId)).status, "delivered");
    assert.equal(await isSuppressed(p.email), false, "a delivery touches no list");

    // Mail servers can take a message and bounce it later.
    const bounce = emailEvent("email.bounced", { email_id: p.providerId, to: [p.email], bounce: { type: "Permanent", subType: "General", message: "gone" } });
    assert.equal((await post(bounce, signed(bounce))).status, 200);
    assert.equal((await sendRow(p.sendId)).status, "bounced");
    assert.equal((await post(delivered, signed(delivered))).status, 200, "a replayed delivery");
    assert.equal((await sendRow(p.sendId)).status, "bounced");

    const q = await personWithSend();
    const qDelivered = emailEvent("email.delivered", { email_id: q.providerId, to: [q.email] });
    await post(qDelivered, signed(qDelivered));
    const complaint = emailEvent("email.complained", { email_id: q.providerId, to: [q.email] });
    await post(complaint, signed(complaint));
    assert.equal((await sendRow(q.sendId)).status, "complained");
  });

  it("a delivery that beats our own write of Resend's answer is kept, found by its send_id tag", async () => {
    const p = await personWithSend("sending");
    const d = await db();
    await d.update(schema.emailSends).set({ providerId: null }).where(eq(schema.emailSends.id, p.sendId));
    const body = emailEvent("email.delivered", { email_id: "re_early", to: [p.email], tags: { kind: "weekly", send_id: p.sendId } });
    assert.equal((await post(body, signed(body))).status, 200);
    const r = await sendRow(p.sendId);
    assert.deepEqual([r.status, r.providerId], ["delivered", "re_early"]);
  });

  it("a delivered sign-in code (no send of ours) changes nothing", async () => {
    const p = await personWithSend();
    const body = emailEvent("email.delivered", { email_id: "re_code_only", to: ["someone@example.com"] });
    assert.equal((await post(body, signed(body))).status, 200);
    assert.equal((await sendRow(p.sendId)).status, "sent");
  });

  it("records a failed send with Resend's reason", async () => {
    const p = await personWithSend();
    const body = emailEvent("email.failed", { email_id: p.providerId, to: [p.email], failed: { reason: "reached_daily_quota" } });
    assert.equal((await post(body, signed(body))).status, 200);
    const r = await sendRow(p.sendId);
    assert.equal(r.status, "failed");
    assert.equal(r.error, "resend:reached_daily_quota");
  });

  it("follows Resend's own list: added and removed in its dashboard", async () => {
    const address = "Someone <Removed@Example.com>";
    const added = JSON.stringify({ type: "suppression.added", created_at: new Date().toISOString(), data: { id: "sup_1", email: address, origin: "manual", source_id: null, created_at: new Date().toISOString() } });
    assert.equal((await post(added, signed(added))).status, 200);
    assert.equal(await isSuppressed("removed@example.com"), true);
    const removed = added.replace("suppression.added", "suppression.removed");
    assert.equal((await post(removed, signed(removed))).status, 200);
    assert.equal(await isSuppressed("removed@example.com"), false);
  });

  it("ignores events it doesn't use, and sign-in codes (no send of ours) only touch the list", async () => {
    const opened = emailEvent("email.opened", { email_id: "re_x", to: ["x@example.com"] });
    assert.equal((await post(opened, signed(opened))).status, 200);
    const codeBounce = emailEvent("email.bounced", { email_id: "re_code", to: ["code-only@example.com"], bounce: { type: "Permanent", subType: "General", message: "" } });
    assert.equal((await post(codeBounce, signed(codeBounce))).status, 200);
    assert.equal(await isSuppressed("code-only@example.com"), true);
  });
});

describe("sign-in with a suppressed address", () => {
  const ask = (email: string, ip: string) =>
    codeRoute(new Request("https://www.d-human.fit/api/auth/code", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email }) }));

  it("still sends the code, and says plainly why it may not arrive", async () => {
    const before = g.__codes.length;
    const res = await ask("Code-Only@Example.com", "203.0.113.1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "sent");
    assert.equal(body.notice, "suppressed");
    assert.match(body.message, /bounced or were marked as spam/);
    assert.match(body.message, /hello@dhuman\.fit/);
    assert.equal(g.__codes.length, before + 1, "the code went anyway: our copy of the list may be out of date");
  });

  it("says nothing extra for everyone else", async () => {
    const res = await ask("fresh@example.com", "203.0.113.2");
    assert.deepEqual(await res.json(), { status: "sent" });
  });
});
