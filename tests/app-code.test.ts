// POST /api/auth/code for the apps (G14, G15): the App Review address gets no email while review
// sign-in is on, and a used-up daily email allowance answers unavailable_today. The web's requests
// (no X-DHuman-Client header) are answered exactly as before.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, type Handler } from "./support/app-people.ts";

const g = globalThis as unknown as { __sent: string[] };
g.__sent = [];
allowAppImports({
  "@/lib/auth/email": `export const sendSignInCode = async (email, code, o = {}) => {
    if (email.startsWith("quota@")) { o.why?.("daily_quota_exceeded"); return false; }
    globalThis.__sent.push(email); return true; };`,
});
const removeDatabase = tempDatabase();
const code = (await import("../app/api/auth/code/route.ts")).POST as Handler;

after(async () => {
  await removeDatabase();
});

const APP = { "x-dhuman-client": "ios/1.0.0 (1)" };
let ip = 0;
const send = (email: string, app: boolean) => call(code, { body: { email }, headers: { ...(app ? APP : {}), "x-forwarded-for": `10.9.0.${++ip}` } });

describe("POST /api/auth/code for the apps", () => {
  it("G15: the review address, while review sign-in is on, answers sent with no email from the app; the web's still sends", async () => {
    Object.assign(process.env, { REVIEW_SIGNIN_ON: "1", REVIEW_ACCOUNT_EMAIL: "review@example.com", REVIEW_CODE_HASH: "a".repeat(43) });
    g.__sent = [];
    assert.deepEqual((await send("review@example.com", true)).body, { status: "sent" });
    assert.deepEqual(g.__sent, [], "no email for the reviewer");
    assert.deepEqual((await send("review@example.com", false)).body, { status: "sent" });
    assert.deepEqual(g.__sent, ["review@example.com"], "the web's request is as before");
    delete process.env.REVIEW_SIGNIN_ON;
    assert.equal((await send("review@example.com", true)).status, 200);
    assert.equal(g.__sent.length, 2, "switched off: an ordinary code");
  });

  it("G14: the day's email allowance used up is unavailable_today with Retry-After for the app, unavailable for the web", async () => {
    const r = await send("quota@example.com", true);
    assert.deepEqual([r.status, r.body!.error], [503, "unavailable_today"]);
    const wait = Number(r.res.headers.get("retry-after"));
    assert.ok(wait > 0 && wait <= 86_400, String(wait));
    const w = await send("quota@example.com", false);
    assert.deepEqual([w.status, w.body], [503, { error: "unavailable" }]);
  });
});
