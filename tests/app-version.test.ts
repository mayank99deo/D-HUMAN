// Forced updates: an app below APP_MIN_VERSION_IOS gets 426 update_required on its signed-in
// routes, before anything else runs; a current one, one with no header, and the web never do.
import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { call, person, type Handler } from "./support/app-people.ts";

const g = globalThis as unknown as { __after: (() => unknown)[]; __testUser?: { id: string; email: string } | null };
g.__after = [];
allowAppImports({
  "next/headers": `export const headers = async () => globalThis.__headers ?? new Headers(); export const cookies = async () => ({ get: () => undefined, set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null; export const requireUser = async () => { throw new Error(\"not here\"); };",
});
const removeDatabase = tempDatabase();

const { compareVersions, clientVersion } = await import("../lib/api/version.ts");
const routes: [string, Handler, Record<string, unknown>][] = [
  ["GET /api/me", (await import("../app/api/me/route.ts")).GET as Handler, {}],
  ["GET /api/home", (await import("../app/api/home/route.ts")).GET as Handler, {}],
  ["POST /api/profile", (await import("../app/api/profile/route.ts")).POST as Handler, { body: { name: "X" } }],
  ["POST /api/food/{id}/again", (await import("../app/api/food/[id]/again/route.ts")).POST as Handler, { body: { key: "version-key-0123456789" }, params: { id: "x" } }],
  ["GET /api/reports/{id}", (await import("../app/api/reports/[id]/route.ts")).GET as Handler, { params: { id: "x" } }],
];
const config = (await import("../app/api/app/config/route.ts")).GET as Handler;

after(async () => {
  await removeDatabase();
});
afterEach(() => {
  delete process.env.APP_MIN_VERSION_IOS;
  g.__testUser = null;
});

describe("426 update_required", () => {
  it("compares versions number by number and reads only an iOS client header", () => {
    assert.deepEqual([compareVersions("1.10.0", "1.9.3"), compareVersions("1.2", "1.2.0"), compareVersions("0.9.9", "1.0.0")], [1, 0, -1]);
    const h = (v: string) => new Request("https://www.d-human.fit/api/me", { headers: { "x-dhuman-client": v } });
    assert.deepEqual([clientVersion(h("ios/1.2.0 (42)")), clientVersion(h("android/1.0.0")), clientVersion(h("nonsense"))], ["1.2.0", null, null]);
  });

  it("below the minimum: every signed-in route answers 426 with the minimum and the store link; at it or with no header: no", async () => {
    const p = await person("version@example.com");
    process.env.APP_MIN_VERSION_IOS = "1.3.0";
    process.env.APP_STORE_URL_IOS = "https://apps.apple.com/app/id1";
    for (const [name, h, o] of routes) {
      const old = await call(h, { token: p.token, headers: { "x-dhuman-client": "ios/1.2.9 (40)" }, ...o });
      assert.deepEqual([old.status, old.body!.error, old.body!.minVersion, old.body!.updateUrl], [426, "update_required", "1.3.0", "https://apps.apple.com/app/id1"], name);
      assert.equal(old.res.headers.get("cache-control"), "private, no-store", name);
      const current = await call(h, { token: p.token, headers: { "x-dhuman-client": "ios/1.3.0 (41)" }, ...o });
      assert.notEqual(current.status, 426, name);
      assert.notEqual((await call(h, { token: p.token, ...o })).status, 426, `${name}: no header, no check`);
    }
    assert.equal((await call(config, { headers: { "x-dhuman-client": "ios/0.1.0 (1)" } })).status, 200, "config stays open, so the app can learn it must update");
    delete process.env.APP_STORE_URL_IOS;
  });
});
