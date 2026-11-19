// /sitemap.xml reads at request time (app/sitemap.ts). Next hands a prerendered /sitemap.xml
// to the host as a plain static file, with no function and no cache tags, so on Vercel the
// first live post never reached it (2026-11-19), while the feed, which reads the same posts
// but isn't a sitemap path, updated. Two things keep it fresh, and these tests pin both:
// - it waits on connection() before it reads, so a build can't prerender it;
// - it reads the database itself, not the 'use cache' readers, so it needs no revalidation.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { AUTHOR, live } from "./support/blog.ts";

const g = globalThis as { __calls?: string[]; __connect?: Promise<void> };
allowAppImports({
  // connection() resolves unless a test holds it; during a build it never resolves.
  "next/server": `export const connection = () => { (globalThis.__calls ??= []).push("connection"); return globalThis.__connect ?? Promise.resolve(); };`,
  // The 'use cache' readers call cacheTag, so a call here means the sitemap went through them.
  "next/cache": `
    export const cacheLife = () => {};
    export const cacheTag = () => { (globalThis.__calls ??= []).push("cacheTag"); };
    export const revalidateTag = () => {};
  `,
});
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { SITE_ORIGIN } = await import("../lib/site-url.ts");
const registry = await import("../lib/blog/registry.ts");
const { default: sitemap } = await import("../app/sitemap.ts");

after(removeDatabase);
beforeEach(() => {
  g.__calls = [];
  g.__connect = undefined;
});

const urls = async () => (await sitemap()).map((e) => e.url);
const url = (path: string) => `${SITE_ORIGIN}${path}`;
const setPost = async (values: Partial<typeof schema.blogPosts.$inferInsert>) => {
  await (await db()).update(schema.blogPosts).set(values).where(eq(schema.blogPosts.id, "p1"));
};

before(async () => {
  const d = await db();
  await d.insert(schema.blogAuthors).values([
    { id: AUTHOR.id, email: "mayank@example.com", slug: AUTHOR.slug, name: AUTHOR.name },
    { id: "author-2", email: "gone@example.com", slug: "former-writer", name: "Former Writer", active: false },
  ]);
  // Not live yet: the sitemap's state before the first publish.
  await d.insert(schema.blogPosts).values({
    id: "p1",
    slug: "preventive-health-checkup-india",
    status: "taken_down",
    topic: "blood-tests",
    authorId: AUTHOR.id,
    live: live({ title: "Preventive health checkup in India" }),
    publishedAt: new Date("2026-11-19T17:30:00Z"),
  });
});

describe("/sitemap.xml", () => {
  it("waits for a request before it reads anything, so a build can't bake it into a static file", async () => {
    g.__connect = new Promise(() => {}); // what a build's prerender gets
    const settled = await Promise.race([sitemap().then(() => "settled"), new Promise((r) => setTimeout(() => r("waiting"), 50))]);
    assert.equal(settled, "waiting");
    assert.deepEqual(g.__calls, ["connection"]);
  });

  it("lists a post on the next fetch after it goes live, moves or comes down, with no revalidation", async () => {
    const blog = (list: string[]) => list.filter((u) => u.startsWith(url("/blog")) || u.startsWith(url("/team")));
    assert.deepEqual(blog(await urls()), [], "nothing live: no blog entries");

    await setPost({ status: "live" });
    assert.deepEqual(blog(await urls()), [url("/blog"), url("/blog/preventive-health-checkup-india"), url(`/team/${AUTHOR.slug}`)]);

    await setPost({ slug: "health-checkup-india" });
    const moved = await urls();
    assert.ok(moved.includes(url("/blog/health-checkup-india")));
    assert.ok(!moved.includes(url("/blog/preventive-health-checkup-india")), "the old address is gone");

    await setPost({ status: "taken_down" });
    assert.deepEqual(blog(await urls()), [], "taken down: no blog entries");

    assert.ok(!g.__calls?.includes("cacheTag"), "read straight from the database, not through 'use cache'");
  });

  it("lists exactly what the cached readers would", async () => {
    await setPost({ status: "live", authorId: "author-2" }); // a former writer keeps a page while a post of theirs is live
    const now = await registry.blogListingNow();
    assert.deepEqual(now, { posts: await registry.livePosts(), authors: await registry.authors() });
    assert.deepEqual(
      now.authors.map((a) => a.slug),
      [AUTHOR.slug, "former-writer"],
    );
    await setPost({ status: "taken_down", authorId: AUTHOR.id });
    assert.deepEqual(
      (await registry.blogListingNow()).authors.map((a) => a.slug),
      [AUTHOR.slug],
      "an inactive writer with nothing live has no page",
    );
  });
});
