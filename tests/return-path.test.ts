// Sign-in that returns people where they were going (/signin?next=…): the allow-list
// that keeps `next` from becoming an open redirect, onboarding first for new people, the
// proxy that sends signed-out visits to sign in with `next`, and the verify route.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { allowAppImports, tempDatabase } from "./support/app.ts";

const g = globalThis as unknown as { __verifiedUser?: string };
const require = createRequire(import.meta.url);
// proxy.ts imports "next/server", which Next's bundler resolves; plain Node needs the file.
const nextServer = pathToFileURL(require.resolve("next/server.js")).href;
allowAppImports({
  "@/lib/auth/codes": "export const verifyCode = async () => ({ ok: true, userId: globalThis.__verifiedUser });",
  "@/lib/auth/session": "export const startSession = async () => {};",
  "next/server": `import m from ${JSON.stringify(nextServer)}; export const { NextRequest, NextResponse } = m;`,
});
const removeDatabase = tempDatabase();

const { afterSignIn, isUnder, onboardingNext, RETURN_PREFIXES, safeNext, SIGN_IN_FIRST, signInPath } = await import("../lib/auth/next-path.ts");
const { SESSION_COOKIE } = await import("../lib/auth/cookie.ts");
const { db, schema } = await import("../lib/db/index.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

describe("safeNext", () => {
  it("keeps our own app paths, with their query and fragment", () => {
    for (const p of ["/home", "/fuel", "/fuel/past", "/wraps?week=2026-11-16&e=abc-123", "/settings#emails", "/settings?e=x#emails", "/reports/0b1c", "/upload?report=1", "/stack", "/write", "/write/0b1c/preview?x=1", "/onboarding"]) {
      assert.equal(safeNext(p), p, p);
    }
  });

  it("refuses other sites, however they're written", () => {
    const attempts = [
      "//evil.com",
      "///evil.com",
      "//evil.com/home",
      "https://evil.com",
      "https://evil.com/home",
      "http:/evil.com",
      "HTTPS://evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "\\\\evil.com",
      "\\/evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      " //evil.com",
      "/ /evil.com",
      "javascript:alert(1)",
      "/javascript:alert(1)",
      "data:text/html,hi",
      "evil.com",
      "@evil.com",
      "/@evil.com",
    ];
    for (const a of attempts) assert.equal(safeNext(a), null, JSON.stringify(a));
  });

  it("refuses encoded and dot-segment tricks that land outside the list", () => {
    // What /signin?next=… gives after the query string is decoded once.
    const decoded = (query: string) => new URLSearchParams(query).get("next");
    assert.equal(safeNext(decoded("next=%2F%2Fevil.com")), null);
    assert.equal(safeNext(decoded("next=%252F%252Fevil.com")), null); // "%2F%2Fevil.com": not a path
    assert.equal(safeNext(decoded("next=%2F%5Cevil.com")), null); // "/\evil.com"
    assert.equal(safeNext(decoded("next=https%3A%2F%2Fevil.com")), null);
    assert.equal(safeNext(decoded("next=%2F%09%2Fevil.com")), null); // a tab, which browsers strip
    assert.equal(safeNext("/%2F%2Fevil.com"), null);
    assert.equal(safeNext("/%5Cevil.com"), null);
    assert.equal(safeNext("/home/../../evil"), null);
    assert.equal(safeNext("/home/%2e%2e/evil"), null);
    assert.equal(safeNext("/home/%2E%2E/%2E%2E/api/account/delete"), null);
    // Encoded slashes inside an allowed path stay a path on this site.
    assert.equal(safeNext("/fuel/%2F%2Fevil.com"), "/fuel/%2F%2Fevil.com");
  });

  it("refuses paths that aren't app screens, look-alikes and odd input", () => {
    for (const p of ["/", "/signin", "/signin?next=/home", "/api/account/delete", "/api/auth/signout", "/blog/x", "/homework", "/home.evil.com", "/fuelish", "/HOME", "/dev/emotes", "/writer", "/feedback?t=abc", "/email/stop?t=x", ""]) {
      assert.equal(safeNext(p), null, p);
    }
    for (const v of [undefined, null, 42, ["/home"], { toString: () => "/home" }]) assert.equal(safeNext(v), null);
    assert.equal(safeNext(`/fuel?x=${"a".repeat(2000)}`), null);
  });

  it("answers with the normalised path, so what is checked is what the browser opens", () => {
    assert.equal(safeNext("/fuel/./past"), "/fuel/past");
    assert.equal(safeNext("/wraps/../fuel"), "/fuel");
    assert.equal(safeNext("/fuel?q=a b"), null, "spaces are refused outright");
  });
});

describe("after sign-in", () => {
  it("goes to next, or home, once set up", () => {
    assert.equal(afterSignIn(true, null), "/home");
    assert.equal(afterSignIn(true, "/wraps?week=2026-11-16&e=s1"), "/wraps?week=2026-11-16&e=s1");
  });

  it("puts onboarding first for new people, carrying next along", () => {
    assert.equal(afterSignIn(false, null), "/onboarding");
    assert.equal(afterSignIn(false, "/home"), "/onboarding");
    assert.equal(afterSignIn(false, "/fuel"), "/onboarding?next=%2Ffuel");
    assert.equal(afterSignIn(false, "/wraps?week=2026-11-16&e=s1"), "/onboarding?next=%2Fwraps%3Fweek%3D2026-11-16%26e%3Ds1");
    // The "didn't finish" email links to onboarding itself.
    assert.equal(afterSignIn(false, "/onboarding?e=s2"), "/onboarding?e=s2");
  });

  it("sends writers straight back to /write, onboarded or not", () => {
    assert.equal(afterSignIn(false, "/write"), "/write");
    assert.equal(afterSignIn(false, "/write/0b1c?x=1"), "/write/0b1c?x=1");
    assert.equal(afterSignIn(true, "/write/import"), "/write/import");
  });

  it("onboarding leads anywhere on the list except back to itself", () => {
    assert.equal(onboardingNext("/fuel"), "/fuel");
    assert.equal(onboardingNext(decodeURIComponent("%2Fwraps%3Fweek%3D2026-11-16")), "/wraps?week=2026-11-16");
    assert.equal(onboardingNext("/onboarding?next=/fuel"), null);
    assert.equal(onboardingNext("//evil.com"), null);
  });

  it("signInPath carries the screen, and only an allowed one", () => {
    assert.equal(signInPath("/home"), "/signin");
    assert.equal(signInPath("/fuel"), "/signin?next=%2Ffuel");
    assert.equal(signInPath("//evil.com"), "/signin");
    const back = new URLSearchParams(new URL(signInPath("/wraps?week=2026-11-16&e=s1"), "https://x.test").search).get("next");
    assert.equal(safeNext(back), "/wraps?week=2026-11-16&e=s1", "round trip through the query string");
  });

  it("isUnder matches whole segments only", () => {
    assert.ok(isUnder("/fuel/past?x=1", "/fuel"));
    assert.ok(isUnder("/fuel#top", "/fuel"));
    assert.ok(!isUnder("/fuelish", "/fuel"));
  });
});

describe("proxy: signed-out visits to app screens", async () => {
  const { getPageStaticInfo } = require("next/dist/build/analysis/get-page-static-info.js");
  const { matchHas } = require("next/dist/shared/lib/router/utils/prepare-destination.js");
  const { NextRequest } = require("next/server.js") as typeof import("next/server");
  const { proxy, config } = await import("../proxy.ts");
  // Read from the source as `next build` reads it (matchers must be literals), so a
  // matcher Next can't analyse or parse fails here first. The build loads SWC first.
  await require("next/dist/build/swc/index.js").loadBindings();
  const info = await getPageStaticInfo({ nextConfig: {}, pageFilePath: fileURLToPath(new URL("../proxy.ts", import.meta.url)), isDev: false, page: "/proxy", pageType: "root" });
  const matchers = info.middleware.matchers as { regexp: string; missing?: object[] }[];

  function runs(pathname: string, cookie?: string) {
    return matchers.some((m) => new RegExp(m.regexp).test(pathname) && matchHas({ headers: cookie ? { cookie } : {} }, {}, [], m.missing) !== false);
  }

  it("matches every sign-in-first screen and nothing else", () => {
    for (const s of SIGN_IN_FIRST) {
      assert.ok(runs(s), s);
      assert.ok(runs(`${s}/deeper`), `${s}/deeper`);
    }
    for (const p of ["/", "/signin", "/blog/x", "/calorie-tracker", "/api/profile", "/api/write/posts", "/writer", "/feedback", "/email/stop", "/homework", "/_next/static/a.js"]) {
      assert.ok(!runs(p), p);
    }
    const literal = /\(([^)]+)\)/.exec(config.matcher[0].source)![1].split("|").map((s) => `/${s}`);
    assert.deepEqual(literal, [...SIGN_IN_FIRST], "the matcher's literal list is SIGN_IN_FIRST");
    for (const s of SIGN_IN_FIRST) assert.ok((RETURN_PREFIXES as readonly string[]).includes(s));
  });

  it("never runs with a session cookie", () => {
    assert.equal(config.matcher[0].missing[0].key, SESSION_COOKIE);
    assert.ok(!runs("/wraps", `theme=dark; ${SESSION_COOKIE}=abc`));
    assert.ok(runs("/wraps", "theme=dark"));
  });

  it("sends the screen, query included, to sign-in", () => {
    const res = proxy(new NextRequest("https://www.d-human.fit/wraps?week=2026-11-16&e=s1"));
    assert.equal(res.status, 307);
    const to = new URL(res.headers.get("location")!);
    assert.equal(to.origin, "https://www.d-human.fit");
    assert.equal(to.pathname, "/signin");
    assert.equal(to.searchParams.get("next"), "/wraps?week=2026-11-16&e=s1");
    assert.equal(new URL(proxy(new NextRequest("https://www.d-human.fit/home")).headers.get("location")!).search, "");
  });

  it("sends a signed-out writer to sign in with the post they opened", () => {
    const to = new URL(proxy(new NextRequest("https://www.d-human.fit/write/0b1c/preview")).headers.get("location")!);
    assert.equal(to.pathname, "/signin");
    assert.equal(to.searchParams.get("next"), "/write/0b1c/preview");
  });

  it("lets a request with the cookie through untouched", () => {
    const res = proxy(new NextRequest("https://www.d-human.fit/fuel", { headers: { cookie: `${SESSION_COOKIE}=abc` } }));
    assert.equal(res.headers.get("location"), null);
    assert.equal(res.headers.get("x-middleware-next"), "1");
  });
});

describe("the verify route", async () => {
  const verify = await import("../app/api/auth/verify/route.ts");
  let n = 0;
  async function person(onboarded: boolean) {
    const d = await db();
    const id = `20000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    await d.insert(schema.users).values({ id, email: `v${n}@example.com` });
    if (onboarded) await d.insert(schema.profiles).values({ userId: id, onboardedAt: new Date() });
    return id;
  }
  async function signIn(userId: string, next?: unknown) {
    g.__verifiedUser = userId;
    const res = await verify.POST(
      new Request("https://www.d-human.fit/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${n}` },
        body: JSON.stringify({ email: "v@example.com", code: "123456", next }),
      }),
    );
    assert.equal(res.status, 200);
    return ((await res.json()) as { next: string }).next;
  }

  it("returns to next for someone set up, and drops anything not ours", async () => {
    const id = await person(true);
    assert.equal(await signIn(id), "/home");
    assert.equal(await signIn(id, "/wraps?week=2026-11-16&e=s1#top"), "/wraps?week=2026-11-16&e=s1#top");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "/api/account/delete", 12, "x".repeat(5000)]) {
      assert.equal(await signIn(id, bad), "/home", String(bad).slice(0, 40));
    }
  });

  it("sends a new person to onboarding first, with next", async () => {
    const id = await person(false);
    assert.equal(await signIn(id), "/onboarding");
    assert.equal(await signIn(id, "/fuel"), "/onboarding?next=%2Ffuel");
    assert.equal(await signIn(id, "//evil.com"), "/onboarding");
  });
});
