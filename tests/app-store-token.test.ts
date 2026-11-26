// The in-app purchase's appAccountToken (gap G8), against a real database: made once per person,
// the same on every call (even two first calls at once), never the user id, apps only.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, person, type Handler } from "./support/app-people.ts";

const g = globalThis as unknown as { __after: (() => unknown)[] };
g.__after = [];
allowAppImports({ "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};" });
const removeDatabase = tempDatabase();

const contract = await import("../lib/api/schemas.ts");
const route = (await import("../app/api/billing/store-token/route.ts")).POST as Handler;

after(async () => {
  await removeDatabase();
});

describe("POST /api/billing/store-token (G8)", () => {
  it("one UUID per person, the same on every call and on two first calls at once; never the user id", async () => {
    const a = await person("token-a@example.com");
    const [x, y] = await Promise.all([call(route, { token: a.token, body: {} }), call(route, { token: a.token, body: {} })]);
    const t = contract.StoreTokenResponse.parse(x.body).appAccountToken;
    assert.equal(contract.StoreTokenResponse.parse(y.body).appAccountToken, t);
    assert.equal(contract.StoreTokenResponse.parse((await call(route, { token: a.token, body: {} })).body).appAccountToken, t);
    assert.notEqual(t, a.id);
    const b = await person("token-b@example.com");
    assert.notEqual(contract.StoreTokenResponse.parse((await call(route, { token: b.token, body: {} })).body).appAccountToken, t);
    assert.equal(x.res.headers.get("cache-control"), "private, no-store");
  });

  it("apps only: a web cookie gets 403, no token 401, before onboarding 409", async () => {
    const p = await person("token-web@example.com");
    assert.deepEqual([(await call(route, { cookie: p.cookie, body: {} })).status], [403]);
    assert.equal((await call(route, { token: "dht_nope", body: {} })).status, 401);
    const fresh = await person("token-fresh@example.com", {}, false);
    assert.equal((await call(route, { token: fresh.token, body: {} })).status, 409);
  });
});
