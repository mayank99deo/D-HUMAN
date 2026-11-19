// The registry (lib/blog/registry.ts) is the only way pages, the sitemap and the feed see
// posts: only live copies of live posts, never a draft, and a retired address points on to
// the post's current one. The photo route serves upload bytes and nothing else.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";
import { AUTHOR, live } from "./support/blog.ts";

// Next's cache functions only work inside Next; here they're no-ops, and revalidations are recorded.
allowAppImports({
  "next/cache": `
    export const cacheLife = () => {};
    export const cacheTag = () => {};
    export const revalidateTag = (...args) => { (globalThis.__revalidated ??= []).push(args); };
  `,
  // Who's asking for a photo: a reader unless a test signs a writer in.
  "@/lib/auth/author": `export const writerAccess = async () => globalThis.__writer ? { kind: "author", author: globalThis.__writer } : { kind: "signed_out" };`,
});
const gw = globalThis as { __writer?: object | null };
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const registry = await import("../lib/blog/registry.ts");
const { listPosts, readAuthors, readHasLivePosts, readLivePost, readLivePosts, relatedPosts, splitFeatured } = registry;
const revalidated = () => (globalThis as { __revalidated?: unknown[][] }).__revalidated ?? [];
const { GET: imageRoute } = await import("../app/(blog)/blog/img/[id]/[file]/route.ts");

after(removeDatabase);

const at = (day: string) => new Date(`${day}T09:00:00+05:30`);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

before(async () => {
  const d = await db();
  await d.insert(schema.blogAuthors).values([
    {
      id: AUTHOR.id,
      email: "mayank@example.com",
      slug: AUTHOR.slug,
      name: "Mayank Narayan",
      role: "Co-founder and CTO, D-Human",
      bio: "Builds the app.",
      photoImageId: "img-face",
      links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/example" }, { label: "X", url: "javascript:alert(1)" }],
    },
    { id: "author-2", email: "gone@example.com", slug: "former-writer", name: "Former Writer", active: false },
  ]);
  await d.insert(schema.blogImages).values([
    { id: "img-face", width: 800, height: 800, uploadedBy: AUTHOR.id },
    { id: "img-cover", width: 1600, height: 1067, focalX: 0.3, uploadedBy: AUTHOR.id },
    { id: "img-down", width: 960, height: 640, uploadedBy: AUTHOR.id },
    { id: "img-draft", width: 960, height: 640, uploadedBy: AUTHOR.id },
  ]);
  await d.insert(schema.blogImageFiles).values([
    { imageId: "img-face", name: "w480-face01.webp", mime: "image/webp", width: 480, byteSize: WEBP.length, bytes: WEBP },
    { imageId: "img-cover", name: "w960-cover1.webp", mime: "image/webp", width: 960, byteSize: WEBP.length, bytes: WEBP },
    { imageId: "img-down", name: "w960-down01.webp", mime: "image/webp", width: 960, byteSize: WEBP.length, bytes: WEBP },
    { imageId: "img-draft", name: "w960-draft1.webp", mime: "image/webp", width: 960, byteSize: WEBP.length, bytes: WEBP },
    // Never served, whatever got into the table.
    { imageId: "img-cover", name: "w960-evil01.jpg", mime: "text/html", width: 960, byteSize: 5, bytes: Buffer.from("<svg>") },
  ]);

  // The author's name in the copy publish took is out of date: readers see the current one.
  const snapshot = { ...live().author, name: "Old Name" };
  const post = (title: string) => live({ title, author: snapshot });
  await d.insert(schema.blogPosts).values([
    // Live, with an unpublished edit waiting in its draft.
    { id: "p1", slug: "roti-calories", status: "live", topic: "calories", authorId: AUTHOR.id, live: post("Calories in a roti"), draft: { title: "UNPUBLISHED EDIT" }, publishedAt: at("2026-11-10") },
    { id: "p2", slug: "protein-per-katori", status: "live", topic: "protein", authorId: AUTHOR.id, live: post("Protein per katori"), publishedAt: at("2026-11-12"), updatedOn: at("2026-11-14") },
    { id: "p3", slug: "pinned-post", status: "live", topic: "protein", authorId: AUTHOR.id, featured: true, live: post("The pinned post"), publishedAt: at("2026-11-01") },
    { id: "p4", slug: "secret-draft", status: "draft", topic: "calories", authorId: AUTHOR.id, draft: { title: "Never published" } },
    { id: "p5", slug: "taken-down-post", status: "taken_down", topic: "calories", authorId: AUTHOR.id, live: post("Taken down"), publishedAt: at("2026-11-02") },
    // A live copy that fails the schema (an unsafe link) is left out, not rendered.
    {
      id: "p6",
      slug: "bad-post",
      status: "live",
      authorId: AUTHOR.id,
      live: { ...post("Bad"), blocks: [{ id: "x", type: "paragraph", spans: [{ text: "x", href: "javascript:alert(1)" }] }] },
      publishedAt: at("2026-11-13"),
    },
    { id: "p7", slug: "by-former-writer", status: "live", topic: "training", authorId: "author-2", live: post("From before"), publishedAt: at("2026-10-01") },
    // Photos only a taken-down post, or only a draft, uses.
    { id: "p8", slug: "down-with-photo", status: "taken_down", authorId: AUTHOR.id, live: { ...post("Down"), cover: null, images: { "img-down": { ...post("x").images["img-cover"], id: "img-down" } } }, publishedAt: at("2026-11-03") },
    { id: "p9", slug: "draft-with-photo", status: "draft", authorId: AUTHOR.id, draft: { title: "Draft", cover: { imageId: "img-draft", alt: "x" } } },
  ]);
  await d.insert(schema.blogSlugs).values([
    { slug: "roti-calories", postId: "p1" },
    { slug: "old-roti-address", postId: "p1" },
    { slug: "old-taken-down", postId: "p5" },
    { slug: "deleted-post", postId: null },
  ]);
});

describe("lists", () => {
  it("reads only live posts with a valid live copy, newest first, never the draft", async () => {
    const posts = await readLivePosts(await db());
    assert.deepEqual(
      posts.map((p) => p.slug),
      ["protein-per-katori", "roti-calories", "pinned-post", "by-former-writer"],
    );
    const roti = posts.find((p) => p.slug === "roti-calories")!;
    assert.equal(roti.title, "Calories in a roti");
    assert.equal(roti.topic, "calories", "the column's topic");
    assert.equal(roti.publishedAt, "2026-11-10T03:30:00.000Z");
    assert.equal(posts.find((p) => p.slug === "protein-per-katori")!.updatedOn, "2026-11-14T03:30:00.000Z");
    assert.ok(roti.cover && roti.cover.alt.length > 0);
    assert.equal(JSON.stringify(posts).includes("UNPUBLISHED"), false);
  });
  it("shows each author as they are now, photo and safe links included", async () => {
    const posts = await readLivePosts(await db());
    const author = posts[0].author;
    assert.equal(author.name, "Mayank Narayan");
    assert.equal(author.photo?.files[0].name, "w480-face01.webp");
    assert.deepEqual(
      author.links.map((l) => l.label),
      ["LinkedIn"],
      "the javascript: link is dropped",
    );
    const team = await readAuthors(await db());
    assert.deepEqual(
      team.map((m) => [m.slug, m.active]),
      [
        ["mayank-narayan", true],
        ["former-writer", false],
      ],
    );
  });
  it("filters, features and relates without the database", async () => {
    const posts = await readLivePosts(await db());
    assert.deepEqual(
      listPosts(posts, { topic: "protein" }).map((p) => p.slug),
      ["protein-per-katori", "pinned-post"],
    );
    assert.deepEqual(
      listPosts(posts, { authorId: "author-2" }).map((p) => p.slug),
      ["by-former-writer"],
    );
    assert.deepEqual(
      listPosts(posts, { page: 2, perPage: 3 }).map((p) => p.slug),
      ["by-former-writer"],
    );
    const { featured, rest } = splitFeatured(posts);
    assert.equal(featured?.slug, "pinned-post");
    assert.equal(rest.length, 3);
    assert.equal(splitFeatured([]).featured, null);
    const related = relatedPosts(posts.find((p) => p.slug === "pinned-post")!, posts);
    assert.deepEqual(
      related.map((p) => p.slug),
      ["protein-per-katori", "roti-calories", "by-former-writer"],
      "same topic first",
    );
  });
});

describe("one post", () => {
  it("returns a live post with its body", async () => {
    const found = await readLivePost(await db(), "roti-calories");
    assert.equal(found.kind, "live");
    if (found.kind !== "live") return;
    assert.equal(found.post.title, "Calories in a roti");
    assert.ok(found.post.blocks.length > 5);
    assert.equal(found.post.author.name, "Mayank Narayan");
    assert.equal(found.post.cover?.alt, live().cover?.alt);
    assert.equal(found.post.cover?.id, "img-cover");
  });
  it("sends a retired address on to the post's current one", async () => {
    assert.deepEqual(await readLivePost(await db(), "old-roti-address"), { kind: "moved", slug: "roti-calories" });
  });
  it("answers missing for drafts, taken-down and deleted posts, bad copies and odd addresses", async () => {
    for (const slug of ["secret-draft", "taken-down-post", "old-taken-down", "deleted-post", "bad-post", "nothing-here", "Roti-Calories", "page", "../api", ""]) {
      assert.deepEqual(await readLivePost(await db(), slug), { kind: "missing" }, slug);
    }
  });
  it("knows whether anything is live, for the footer's Blog link", async () => {
    const d = await db();
    assert.equal(await readHasLivePosts(d), true);
    await d.update(schema.blogPosts).set({ status: "taken_down" }).where(eq(schema.blogPosts.status, "live"));
    assert.equal(await readHasLivePosts(d), false);
    assert.deepEqual(await readLivePosts(d), []);
    await d.update(schema.blogPosts).set({ status: "live" }).where(eq(schema.blogPosts.status, "taken_down"));
    await d.update(schema.blogPosts).set({ status: "taken_down" }).where(eq(schema.blogPosts.id, "p5"));
  });
});

describe("the cached readers and revalidation", () => {
  it("serve pages the same posts the plain readers return", async () => {
    const posts = await registry.livePosts();
    assert.deepEqual(posts, await readLivePosts(await db()));
    assert.deepEqual(
      (await registry.livePosts({ topic: "protein" })).map((p) => p.slug),
      ["protein-per-katori", "pinned-post"],
    );
    assert.equal((await registry.livePost("old-roti-address")).kind, "moved");
    assert.equal(await registry.hasLivePosts(), true);
  });
  it("lists authors who have a page: active ones, and anyone with a live post", async () => {
    assert.deepEqual(
      (await registry.authors()).map((a) => a.slug),
      ["mayank-narayan", "former-writer"],
    );
    const d = await db();
    await d.update(schema.blogPosts).set({ status: "taken_down" }).where(eq(schema.blogPosts.id, "p7"));
    assert.deepEqual(
      (await registry.authors()).map((a) => a.slug),
      ["mayank-narayan"],
    );
    await d.update(schema.blogPosts).set({ status: "live" }).where(eq(schema.blogPosts.id, "p7"));
  });
  it("expires every blog page at once when /write publishes, and the post's own tag", () => {
    registry.revalidateBlog("p1");
    registry.revalidateBlogAuthors();
    assert.deepEqual(revalidated(), [
      ["blog", { expire: 0 }],
      ["blog:post:p1", { expire: 0 }],
      ["blog:authors", { expire: 0 }],
    ]);
  });
});

describe("the photo route", () => {
  const get = (id: string, file: string) => imageRoute(new Request(`http://localhost/blog/img/${id}/${file}`), { params: Promise.resolve({ id, file }) });

  it("serves a live post's photo, cached a day by the CDN and an hour by browsers", async () => {
    const res = await get("img-cover", "w960-cover1.webp");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/webp");
    assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
    assert.equal(res.headers.get("cdn-cache-control"), "public, max-age=86400");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), WEBP);
    assert.equal((await get("img-face", "w480-face01.webp")).status, 200, "a writer's byline photo");
  });

  it("keeps a taken-down post's photos and drafts' photos from readers; writers see them, privately", async () => {
    // An earlier test brings every taken-down post back for a moment; this one is down.
    await (await db()).update(schema.blogPosts).set({ status: "taken_down" }).where(eq(schema.blogPosts.id, "p8"));
    for (const [id, file] of [
      ["img-down", "w960-down01.webp"],
      ["img-draft", "w960-draft1.webp"],
    ]) {
      const res = await get(id, file);
      assert.equal(res.status, 404, id);
      assert.equal(res.headers.get("cache-control"), "no-store");
      gw.__writer = { id: AUTHOR.id };
      try {
        const own = await get(id, file);
        assert.equal(own.status, 200, `${id} for a writer`);
        assert.equal(own.headers.get("cache-control"), "private, max-age=3600");
        assert.equal(own.headers.get("cdn-cache-control"), null);
      } finally {
        gw.__writer = null;
      }
    }
  });
  it("answers 404, uncached, for anything else", async () => {
    for (const [id, file] of [
      ["img-cover", "w480-nope00.webp"],
      ["nope", "w960-cover1.webp"],
      ["img-cover", "w960-evil01.jpg"],
      ["img-cover", "../../api/profile"],
      ["img-cover", "w960-cover1.svg"],
      ["img cover", "w960-cover1.webp"],
    ]) {
      const res = await get(id, file);
      assert.equal(res.status, 404, `${id}/${file}`);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
  });
});
