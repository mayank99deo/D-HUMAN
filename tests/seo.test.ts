// Search plumbing: one canonical host, redirects from the other hosts that leave the
// API alone, robots.txt keeping the app out, a sitemap of public pages only, and
// structured data that parses and matches the pages.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { LEGACY_HOSTS, SITE_ORIGIN, absoluteUrl, siteUrl } = await import("../lib/site-url.ts");
const { APP_PATHS, GUIDES, guideLd, homeLd, ldJson } = await import("../lib/seo.ts");

const saved = { site: process.env.NEXT_PUBLIC_SITE_URL, vercel: process.env.VERCEL };
afterEach(() => {
  for (const [key, value] of [["NEXT_PUBLIC_SITE_URL", saved.site], ["VERCEL", saved.vercel]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("the canonical address", () => {
  it("reads any of the site's other hosts as the canonical one", () => {
    for (const host of LEGACY_HOSTS) {
      process.env.NEXT_PUBLIC_SITE_URL = `https://${host}/`;
      assert.equal(siteUrl(), SITE_ORIGIN);
    }
    assert.equal(SITE_ORIGIN, "https://www.dhuman.fit");
  });
  it("keeps an override that names somewhere else", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.example.com/";
    assert.equal(siteUrl(), "https://staging.example.com");
  });
  it("uses the canonical host on Vercel and nothing locally", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL = "1";
    assert.equal(siteUrl(), SITE_ORIGIN);
    delete process.env.VERCEL;
    assert.equal(siteUrl(), undefined);
    assert.equal(absoluteUrl("/calorie-tracker"), `${SITE_ORIGIN}/calorie-tracker`);
  });
});

describe("host redirects", async () => {
  // Next's own matchers, as its router runs them (server/lib/router-utils/resolve-routes.js).
  const require = createRequire(import.meta.url);
  const { buildCustomRoute } = require("next/dist/server/lib/router-utils/filesystem.js");
  const { matchHas, prepareDestination } = require("next/dist/shared/lib/router/utils/prepare-destination.js");
  const config = (await import("../next.config.ts")).default;
  const routes = (await config.redirects!()).map((r: object) => buildCustomRoute("redirect", r, "", false));

  function resolve(host: string, pathname: string, query: Record<string, string> = {}) {
    for (const route of routes) {
      let params = route.match(pathname);
      if (params && route.has) {
        const extra = matchHas({ headers: { host } }, query, route.has, route.missing);
        params = extra ? Object.assign(params, extra) : false;
      }
      if (!params) continue;
      const { parsedDestination: d } = prepareDestination({ appendParamsToQuery: false, destination: route.destination, params, query });
      return { status: route.permanent ? 308 : 307, url: `${d.protocol}//${d.hostname}${d.pathname}`, query: d.query };
    }
    return null;
  }

  it("sends pages on every other host to the same path on the canonical host", () => {
    for (const host of LEGACY_HOSTS) {
      assert.deepEqual(resolve(host, "/"), { status: 308, url: `${SITE_ORIGIN}/`, query: {} });
      assert.equal(resolve(host, "/reports/abc/def")?.url, `${SITE_ORIGIN}/reports/abc/def`);
      assert.equal(resolve(`${host}:443`, "/apiary")?.url, `${SITE_ORIGIN}/apiary`);
    }
    assert.deepEqual(resolve("d-human.vercel.app", "/calorie-tracker", { utm_source: "x" })?.query, { utm_source: "x" });
  });
  it("leaves the API, Next's assets, Vercel's scripts and the canonical host alone", () => {
    for (const p of ["/api", "/api/waitlist/form", "/api/billing/webhook", "/_next/static/chunks/a.js", "/_vercel/insights/script.js"]) {
      assert.equal(resolve("d-human.vercel.app", p), null, p);
    }
    assert.equal(resolve("www.dhuman.fit", "/"), null);
    // The host is a regex: its dots must not match any character.
    assert.equal(resolve("d-humanXvercel.app", "/"), null);
  });
});

describe("robots.txt and the sitemap", async () => {
  const robots = (await import("../app/robots.ts")).default;
  const sitemap = (await import("../app/sitemap.ts")).default;

  it("keeps the app and the API out, and lets crawlers read /signin, pages and assets", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://d-human.vercel.app";
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const disallow = [rule.disallow].flat();
    for (const p of ["/api/", "/home", "/fuel", "/upload", "/reports/", "/stack", "/wraps", "/settings", "/onboarding"]) {
      assert.ok(disallow.includes(p), p);
    }
    for (const p of ["/", "/signin", "/_next/"]) assert.ok(!disallow.some((d) => p.startsWith(d!)), p);
    assert.equal(r.sitemap, `${SITE_ORIGIN}/sitemap.xml`);
  });

  it("lists every public page once, on the canonical host, and nothing robots.txt blocks", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://d-human.vercel.app";
    const urls = sitemap().map((e) => e.url);
    assert.deepEqual(urls, [`${SITE_ORIGIN}/`, ...GUIDES.map((g) => `${SITE_ORIGIN}${g.path}`)]);
    assert.equal(new Set(urls).size, urls.length);
    for (const g of GUIDES) {
      assert.ok(!APP_PATHS.some((p) => g.path.startsWith(p)), `${g.path} would be blocked by robots.txt`);
    }
  });

  it("has a page for every guide, whose canonical path is its own URL", () => {
    for (const g of GUIDES) {
      const file = path.join(root, "app/(guides)", g.path.slice(1), "page.tsx");
      assert.ok(existsSync(file), file);
      const source = readFileSync(file, "utf8");
      assert.match(source, new RegExp(`const PATH = "${g.path}";`));
      assert.match(source, /pageMetadata\(\{ path: PATH/);
      assert.match(source, /guideLd\(\{ path: PATH/);
    }
  });
});

describe("structured data", () => {
  it("describes the site, and the app with the prices the start form shows", () => {
    const graph = JSON.parse(ldJson(homeLd()))["@graph"];
    const types = graph.map((n: { "@type": string }) => n["@type"]);
    assert.deepEqual(types, ["Organization", "WebSite", "WebApplication"]);
    const prices = graph[2].offers.map((o: { price: string; priceCurrency: string }) => `${o.price} ${o.priceCurrency}`);
    assert.deepEqual(prices, ["0 INR", "49 INR"]);
  });
  it("gives each guide breadcrumbs, and FAQ markup only with questions", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://d-human.vercel.app";
    const withFaq = JSON.parse(ldJson(guideLd({ path: "/calorie-tracker", name: "x", description: "y", faqs: [{ q: "Q?", a: "A." }] })));
    assert.equal(withFaq["@graph"][0]["@type"], "FAQPage");
    assert.equal(withFaq["@graph"][0].mainEntity[0].acceptedAnswer.text, "A.");
    const crumbs = withFaq["@graph"][1].itemListElement.map((i: { item: string }) => i.item);
    assert.deepEqual(crumbs, [`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/calorie-tracker`]);
    const plain = JSON.parse(ldJson(guideLd({ path: "/sources-and-safety", name: "x", description: "y" })));
    assert.equal(plain["@graph"][0]["@type"], "WebPage");
    assert.equal(plain["@graph"][0].mainEntity, undefined);
  });
  it("can't be closed early by text inside it", () => {
    assert.ok(!ldJson({ a: "</script><script>alert(1)</script>" }).includes("<"));
  });
});
