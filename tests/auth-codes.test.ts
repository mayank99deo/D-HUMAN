// Sign-in codes against a real embedded database: the five-try lock holds under
// parallel guesses, a code works once, codes are capped per email, accounts get
// their profile, and deleting an account removes its codes.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type TestGlobals = { __testUser?: { id: string; email: string } | null };
const g = globalThis as TestGlobals;

allowAppImports({
  // The delete route reads the signed-in user from cookies; tests set it directly.
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null; export const endSession = async () => {};",
});
const removeDatabase = tempDatabase();
const { and, eq } = await import("drizzle-orm");
const { issueCode, verifyCode } = await import("../lib/auth/codes.ts");
const { db, schema } = await import("../lib/db/index.ts");
const { POST: deleteAccount } = await import("../app/api/account/delete/route.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

const wrongFor = (code: string) => (code === "000000" ? "111111" : "000000");

async function issued(email: string) {
  const r = await issueCode(email);
  assert.ok(r.ok, "code issued");
  return r.code;
}

describe("sign-in codes", () => {
  it("never allows more than five tries, even when guesses arrive at once", async () => {
    const email = "parallel@example.com";
    const code = await issued(email);
    const results = await Promise.all(Array.from({ length: 20 }, () => verifyCode(email, wrongFor(code))));
    const d = await db();
    const [row] = await d.select({ attempts: schema.loginCodes.attempts }).from(schema.loginCodes).where(eq(schema.loginCodes.email, email));
    assert.equal(row.attempts, 5);
    assert.equal(results.filter((r) => !r.ok && r.reason === "invalid").length, 4);
    assert.equal(results.filter((r) => !r.ok && r.reason === "locked").length, 16);
    assert.deepEqual(await verifyCode(email, code), { ok: false, reason: "locked" });
  });

  it("lets a code be used once, even when sent twice at once", async () => {
    const email = "twice@example.com";
    const code = await issued(email);
    const results = await Promise.all([verifyCode(email, code), verifyCode(email, code), verifyCode(email, code)]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal((await verifyCode(email, code)).ok, false);
  });

  it("creates the account with its profile, and finds it the next time", async () => {
    const email = "new@example.com";
    const first = await verifyCode(email, await issued(email));
    assert.ok(first.ok && first.isNew);
    const d = await db();
    const profiles = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, first.userId));
    assert.equal(profiles.length, 1);
    const again = await verifyCode(email, await issued(email));
    assert.ok(again.ok && !again.isNew && again.userId === first.userId);
  });

  it("says expired for an expired code", async () => {
    const email = "late@example.com";
    const code = await issued(email);
    const d = await db();
    await d.update(schema.loginCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.loginCodes.email, email));
    assert.deepEqual(await verifyCode(email, code), { ok: false, reason: "expired" });
  });

  it("caps codes at five an hour per email, even when asked for at once", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => issueCode("flood@example.com")));
    assert.equal(results.filter((r) => r.ok).length, 5);
  });

  it("caps codes at ten a day per email", async () => {
    const email = "daily@example.com";
    const d = await db();
    const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
    await d.insert(schema.loginCodes).values(
      Array.from({ length: 9 }, (_, i) => ({ id: `old-${i}`, email, codeHash: "x", expiresAt: hoursAgo(2 + i), createdAt: hoursAgo(2 + i) })),
    );
    assert.equal((await issueCode(email)).ok, true);
    assert.deepEqual(await issueCode(email), { ok: false, reason: "too_many" });
    // Codes older than a day don't count.
    await d.update(schema.loginCodes).set({ createdAt: hoursAgo(25) }).where(and(eq(schema.loginCodes.email, email), eq(schema.loginCodes.id, "old-0")));
    assert.equal((await issueCode(email)).ok, true);
  });
});

describe("account delete", () => {
  it("removes the account and that email's sign-in codes, and nobody else's", async () => {
    const email = "leaving@example.com";
    const signedIn = await verifyCode(email, await issued(email));
    assert.ok(signedIn.ok);
    await issued(email);
    await issued("staying@example.com");
    g.__testUser = { id: signedIn.userId, email };
    const res = await deleteAccount(new Request("http://localhost/api/account/delete", { method: "POST", body: JSON.stringify({ confirm: "DELETE" }) }));
    g.__testUser = null;
    assert.equal(res.status, 200);
    const d = await db();
    assert.equal((await d.select().from(schema.users).where(eq(schema.users.email, email))).length, 0);
    assert.equal((await d.select().from(schema.profiles).where(eq(schema.profiles.userId, signedIn.userId))).length, 0);
    assert.equal((await d.select().from(schema.loginCodes).where(eq(schema.loginCodes.email, email))).length, 0);
    assert.equal((await d.select().from(schema.loginCodes).where(eq(schema.loginCodes.email, "staying@example.com"))).length, 1);
  });
});
