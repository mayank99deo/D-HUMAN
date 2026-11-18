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
const { SESSION_COOKIE } = await import("../lib/auth/cookie.ts");
const { APP_FEATURES, APP_PATHS, GUIDES, HOME_DESCRIPTION, appLd, guideLd, homeLd, ldJson, organizationLd, siteMap } = await import("../lib/seo.ts");
const { SPOKEN } = await import("../lib/domain/speech.ts");

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
    assert.equal(SITE_ORIGIN, "https://www.d-human.fit");
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

describe("redirects", async () => {
  // Next's own matchers, as its router runs them (server/lib/router-utils/resolve-routes.js).
  const require = createRequire(import.meta.url);
  const { buildCustomRoute } = require("next/dist/server/lib/router-utils/filesystem.js");
  const { matchHas, prepareDestination } = require("next/dist/shared/lib/router/utils/prepare-destination.js");
  const config = (await import("../next.config.ts")).default;
  const routes = (await config.redirects!()).map((r: object) => buildCustomRoute("redirect", r, "", false));

  function resolve(host: string, pathname: string, query: Record<string, string> = {}, cookie?: string) {
    for (const route of routes) {
      let params = route.match(pathname);
      if (params && route.has) {
        const extra = matchHas({ headers: cookie ? { host, cookie } : { host } }, query, route.has, route.missing);
        params = extra ? Object.assign(params, extra) : false;
      }
      if (!params) continue;
      const { parsedDestination: d } = prepareDestination({ appendParamsToQuery: false, destination: route.destination, params, query });
      const url = d.hostname ? `${d.protocol}//${d.hostname}${d.pathname}` : d.pathname;
      return { status: route.permanent ? 308 : 307, url, query: d.query };
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
    assert.equal(resolve("www.d-human.fit", "/"), null);
    // The host is a regex: its dots must not match any character.
    assert.equal(resolve("d-humanXvercel.app", "/"), null);
  });
  it("sends someone signed in on this browser from the landing page to their home screen", () => {
    const signedIn = `theme=dark; ${SESSION_COOKIE}=abc123`;
    assert.deepEqual(resolve("www.d-human.fit", "/", {}, signedIn), { status: 307, url: "/home", query: {} });
    // Signed out, or only other cookies: the landing page.
    assert.equal(resolve("www.d-human.fit", "/"), null);
    assert.equal(resolve("www.d-human.fit", "/", {}, "theme=dark"), null);
    // Only the landing page: guides, sign-in and app screens stay where they are.
    for (const p of ["/calorie-tracker", "/signin", "/fuel", "/api/profile"]) {
      assert.equal(resolve("www.d-human.fit", p, {}, signedIn), null, p);
    }
    // Other hosts move to the canonical host first; the cookie is per host anyway.
    assert.equal(resolve("dhuman.fit", "/", {}, signedIn)?.url, `${SITE_ORIGIN}/`);
  });
});

describe("robots.txt and the sitemap", async () => {
  const robots = (await import("../app/robots.ts")).default;

  it("keeps the app and the API out, and lets crawlers read /signin, pages and assets", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://d-human.vercel.app";
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const disallow = [rule.disallow].flat();
    const blocked = (p: string) => disallow.some((d) => p.startsWith(d!));
    for (const p of ["/api/", "/home", "/fuel", "/upload", "/reports", "/stack", "/wraps", "/settings", "/onboarding"]) {
      assert.ok(disallow.includes(p), p);
    }
    // The blog's editor and the pages opened from emails are personal.
    for (const p of ["/write", "/write/abc/preview", "/email/stop", "/feedback"]) assert.ok(blocked(p), p);
    // The blog, its photos, author pages, and the images inside emails stay crawlable.
    for (const p of ["/", "/signin", "/_next/", "/blog", "/blog/img/abc/w960-a1b2c3.webp", "/team/mayank-narayan", "/editorial-policy", "/email/wordmark.png"]) {
      assert.ok(!blocked(p), p);
    }
    assert.equal(r.sitemap, `${SITE_ORIGIN}/sitemap.xml`);
  });

  it("lists every public page once, on the canonical host, and nothing robots.txt blocks", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://d-human.vercel.app";
    // Before the first post: the landing page and the guides only.
    const urls = siteMap({ posts: [], authors: [] }).map((e) => e.url);
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
  it("describes the site, and the app's free start as the start form shows it, without the pass price", () => {
    const graph = JSON.parse(ldJson(homeLd()))["@graph"];
    const types = graph.map((n: { "@type": string }) => n["@type"]);
    assert.deepEqual(types, ["Organization", "WebSite", "WebApplication"]);
    const prices = graph[2].offers.map((o: { price: string; priceCurrency: string }) => `${o.price} ${o.priceCurrency}`);
    assert.deepEqual(prices, ["0 INR"]);
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
  it("lists what the app does, Wraps and Past meals included", () => {
    const app = appLd() as { featureList: string[]; description: string };
    assert.deepEqual(app.featureList, [...APP_FEATURES]);
    const all = app.featureList.join("\n");
    for (const s of SPOKEN) assert.ok(all.includes(s.name), s.name);
    for (const word of ["photo", "voice", "Wraps", "Past meals", "blood report", "supplement", "budget"]) {
      assert.ok(all.includes(word), word);
    }
  });
});

// The words search engines and phones show for the landing page follow the house copy rules.
describe("search copy", async () => {
  const manifest = (await import("../app/manifest.ts")).default;
  const texts = () => [HOME_DESCRIPTION, (appLd() as { description: string }).description, ...APP_FEATURES, manifest().description ?? ""];

  it("says what the app does, in the order phones show it", () => {
    assert.match(HOME_DESCRIPTION, new RegExp(`Hindi and ${SPOKEN.length - 1} more languages`));
    assert.ok(HOME_DESCRIPTION.indexOf("Wraps") < 135, "Wraps should show before a phone cuts the description");
    assert.ok(HOME_DESCRIPTION.includes("blood report"));
  });
  it("never claims a doctor's review, accuracy, a price or a free product", () => {
    for (const text of texts()) {
      assert.doesNotMatch(text, /doctor[- ]review|reviewed by a doctor|medically reviewed/i, text);
      assert.doesNotMatch(text, /accura/i, text);
      assert.doesNotMatch(text, /₹|\bINR\b|rupee/i, text);
      assert.doesNotMatch(text.replace(/Free to start/g, ""), /\bfree\b/i, text);
    }
  });
});

// Google shows one favicon per host (developers.google.com/search/docs/appearance/favicon-in-search):
// square, in a format it lists (not SVG), and ideally larger than 48 x 48 px.
describe("icons", () => {
  const pngSize = (file: string) => {
    const b = readFileSync(file);
    assert.equal(b.subarray(1, 4).toString(), "PNG", file);
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  };

  it("give search engines a square PNG favicon larger than 48 px, in steps of 48", () => {
    const { width, height } = pngSize(path.join(root, "app/icon0.png"));
    assert.equal(width, height);
    assert.ok(width > 48 && width % 48 === 0, `${width} px`);
  });
  it("keep a 48 px image inside favicon.ico", () => {
    const ico = readFileSync(path.join(root, "app/favicon.ico"));
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i] || 256);
    assert.ok(sizes.includes(48), `favicon.ico has ${sizes.join(", ")} px`);
  });
  it("point the Organization logo at a real, square image of at least 112 px", () => {
    const logo = (organizationLd() as { logo: { url: string; width: number; height: number } }).logo;
    const file = path.join(root, "public", new URL(logo.url).pathname);
    const { width, height } = pngSize(file);
    assert.deepEqual([width, height], [logo.width, logo.height]);
    assert.ok(width === height && width >= 112);
  });
});

// The blog in search (SEO plan §4): every list, the sitemap, the feed and the markup take the
// registry's posts as arguments, so these tests pass their own.
describe("the blog in search", async () => {
  const seo = await import("../lib/seo.ts");
  const { TRY_IT_COPY } = await import("../lib/blog/blocks.ts");
  const { BLOG_TOPICS } = await import("../lib/blog/types.ts");
  const { AUTHOR, image, live, summary } = await import("./support/blog.ts");
  type LivePost = import("../lib/blog/types.ts").LivePost;

  const share = { imageId: "share-1", files: { og: "og-a1b2c3.jpg", "16x9": "16x9-a1b2c3.jpg", "4x3": "4x3-a1b2c3.jpg", "1x1": "1x1-a1b2c3.jpg" } };
  const livePost = (over: Partial<LivePost> = {}): LivePost => {
    const l = live();
    const s = summary({
      slug: "protein-per-katori",
      title: l.title,
      dek: l.dek,
      seoDescription: l.seoDescription,
      topic: "protein",
      publishedAt: "2026-11-12T03:30:00.000Z",
      updatedOn: "2026-11-14T03:30:00.000Z",
      share,
    });
    return { ...l, ...s, cover: { ...l.images["img-cover"], ...l.cover! }, ...over };
  };
  const other = { ...AUTHOR, id: "author-2", slug: "no-posts-yet", name: "No Posts" };

  it("keeps every blog address clear of what robots.txt blocks", () => {
    const paths = [
      seo.BLOG_PATH,
      seo.blogPagePath(2),
      seo.BLOG_FEED_PATH,
      seo.postPath("roti-calories"),
      seo.teamPath("mayank-narayan"),
      seo.EDITORIAL_PATH,
      ...BLOG_TOPICS.map(seo.topicPath),
    ];
    for (const p of paths) assert.ok(!APP_PATHS.some((a) => p.startsWith(a)), p);
    assert.equal(seo.blogPagePath(1), "/blog");
  });

  it("puts the blog in the sitemap only once a post is live, with dates and images that match the posts", () => {
    const posts = [
      summary({ slug: "roti-calories", updatedOn: "2026-11-14T03:30:00.000Z", share }),
      summary({ slug: "dal-calories", cover: { ...image("img-dal"), alt: "Dal" } }),
      summary({ slug: "thali-calories" }),
      summary({ slug: "protein-per-katori", topic: "protein" }),
    ];
    const entries = siteMap({ posts, authors: [AUTHOR, other] });
    const urls = entries.map((e) => e.url);
    assert.equal(new Set(urls).size, urls.length);
    for (const u of urls) assert.ok(u.startsWith(`${SITE_ORIGIN}/`) && !APP_PATHS.some((a) => u.startsWith(`${SITE_ORIGIN}${a}`)), u);
    const blogUrls = urls.slice(1 + GUIDES.length);
    assert.deepEqual(blogUrls, [
      `${SITE_ORIGIN}/blog`,
      ...posts.map((p) => `${SITE_ORIGIN}/blog/${p.slug}`),
      `${SITE_ORIGIN}/blog/topics/calories`, // 3 posts; protein has 1, so it stays out
      `${SITE_ORIGIN}/team/mayank-narayan`, // no page for an author without posts
      `${SITE_ORIGIN}/editorial-policy`,
    ]);
    const byUrl = new Map(entries.map((e) => [e.url, e]));
    assert.equal(byUrl.get(`${SITE_ORIGIN}/blog/roti-calories`)?.lastModified, "2026-11-14T09:00:00+05:30");
    assert.equal(byUrl.get(`${SITE_ORIGIN}/blog/thali-calories`)?.lastModified, "2026-11-10T09:00:00+05:30");
    assert.deepEqual(byUrl.get(`${SITE_ORIGIN}/blog/roti-calories`)?.images, [`${SITE_ORIGIN}/blog/img/share-1/16x9-a1b2c3.jpg`]);
    assert.deepEqual(byUrl.get(`${SITE_ORIGIN}/blog/dal-calories`)?.images, [`${SITE_ORIGIN}/blog/img/img-dal/w1600-a7b8c9.webp`]);
    assert.equal(byUrl.get(`${SITE_ORIGIN}/blog/thali-calories`)?.images, undefined, "a drawn cover isn't an image file");
  });

  it("marks up a post as a BlogPosting with its author, dates in India's time zone, and no review it didn't have", () => {
    const post = livePost();
    const text = ldJson(seo.postLd(post));
    assert.doesNotMatch(text, /reviewedBy|lastReviewed|MedicalWebPage|FAQPage/);
    const graph = JSON.parse(text)["@graph"];
    assert.deepEqual(
      graph.map((n: { "@type": string }) => n["@type"]),
      ["WebPage", "ImageObject", "BlogPosting", "BreadcrumbList"],
    );
    const posting = graph[2];
    assert.equal(posting.datePublished, "2026-11-12T09:00:00+05:30");
    assert.equal(posting.dateModified, "2026-11-14T09:00:00+05:30");
    assert.equal(posting.headline, post.title);
    assert.equal(posting.image.length, 3);
    assert.equal(posting.articleSection, "Protein");
    const person = JSON.parse(ldJson(seo.profileLd(AUTHOR)))["@graph"].find((n: { "@type": string }) => n["@type"] === "Person");
    assert.equal(posting.author[0]["@id"], person["@id"]);
    assert.deepEqual(person.sameAs, ["https://www.linkedin.com/in/example"]);
    const blog = JSON.parse(ldJson(seo.blogIndexLd([post])))["@graph"][0];
    assert.equal(blog["@type"], "Blog");
    assert.equal(posting.isPartOf["@id"], blog["@id"]);
    const crumbs = graph[3].itemListElement.map((i: { name: string }) => i.name);
    assert.deepEqual(crumbs, ["D-Human", "Blog", "Protein", post.title]);
  });

  it("can't be closed early by a post's own words", () => {
    const text = ldJson(seo.postLd(livePost({ title: "</script><script>alert(1)</script>" })));
    assert.ok(!text.includes("<"));
  });

  it("gives a post article share tags with its own image, and falls back to the site's", () => {
    const meta = seo.postMetadata(livePost());
    assert.equal(meta.alternates?.canonical, "/blog/protein-per-katori");
    assert.match(String((meta.title as { absolute: string }).absolute), / \| D-Human$/);
    const og = meta.openGraph as { type: string; images: { url: string }[]; publishedTime: string };
    assert.equal(og.type, "article");
    assert.equal(og.publishedTime, "2026-11-12T03:30:00.000Z");
    assert.equal(og.images[0].url, "/blog/img/share-1/og-a1b2c3.jpg");
    assert.deepEqual(meta.robots, { index: true, follow: true, "max-image-preview": "large" });
    const plain = seo.postMetadata(livePost({ share: null })).openGraph as { images: { url: string }[] };
    assert.equal(plain.images[0].url, "/opengraph-image.png");
    assert.deepEqual(seo.blogPageMetadata({ path: "/blog", title: "t", description: "d", index: false }).robots, { index: false, follow: true });
  });

  it("writes an RSS 2.0 feed of the latest 20 posts, escaped", () => {
    const amp = summary({ title: `Dal & rice <compared>${String.fromCharCode(1)}`, slug: "dal-and-rice" });
    const posts = [amp, ...Array.from({ length: 24 }, () => summary())];
    const xml = seo.blogRss(posts);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"'));
    assert.equal(xml.match(/<item>/g)?.length, 20);
    assert.match(xml, /<title>Dal &amp; rice &lt;compared&gt;<\/title>/);
    assert.match(xml, new RegExp(`<link>${SITE_ORIGIN}/blog/dal-and-rice</link>`));
    assert.match(xml, new RegExp(`<atom:link href="${SITE_ORIGIN}/blog/rss.xml" rel="self"`));
    assert.match(xml, /<pubDate>Tue, 10 Nov 2026 03:30:00 GMT<\/pubDate>/);
    assert.match(xml, /<dc:creator>Mayank Narayan<\/dc:creator>/);
    assert.ok(!/[\x00-\x08]/.test(xml));
    const empty = seo.blogRss([]);
    assert.doesNotMatch(empty, /<item>|lastBuildDate/);
  });

  it("follows the house copy rules in the blog's own words", () => {
    const texts = [
      seo.BLOG_DESCRIPTION,
      ...Object.values(seo.BLOG_TOPIC_INFO).flatMap((t) => [t.label, t.intro]),
      ...Object.values(TRY_IT_COPY).map((c) => c.line),
    ];
    for (const text of texts) {
      assert.doesNotMatch(text, /doctor[- ]review|reviewed by a doctor|medically reviewed/i, text);
      assert.doesNotMatch(text, /accura|cure|guarantee/i, text);
      assert.doesNotMatch(text, /₹|\bINR\b|rupee/i, text);
      assert.doesNotMatch(text.replace(/Free to start/g, ""), /\bfree\b/i, text);
    }
  });
});
