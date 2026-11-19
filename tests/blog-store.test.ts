// /write against a real embedded database: who may write, autosave with version
// conflicts, publishing in one transaction (checks, checklist, the other founder's
// "Looks good", free addresses), drafts never reaching `live`, renames and retired
// addresses, take-down and restore, one featured post, and photos stored and read back.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Author } from "../lib/auth/author.ts";
import type { WriteDraft } from "../lib/blog/checks.ts";
import type { StoredLive } from "../lib/blog/store.ts";
import { CHECKLIST_ITEMS } from "../lib/blog/types.ts";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type G = { __revalidated: string[] };
const g = globalThis as unknown as G;
g.__revalidated = [];

allowAppImports({
  "next/cache": "export const cacheLife = () => {}; export const cacheTag = () => {}; export const revalidateTag = (tag) => { globalThis.__revalidated.push(tag); };",
  "next/headers": "export const cookies = async () => ({ get: () => undefined });",
  "next/server": "export const connection = async () => {}; export const after = (fn) => fn();",
});
const removeDatabase = tempDatabase();
process.env.BLOG_OWNER_EMAILS = "Mayank@D-Human.fit, cofounder@d-human.fit";

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { accessFor, isFresh, ownerEmails } = await import("../lib/auth/author.ts");
const { emptyDraft } = await import("../lib/blog/checks.ts");
const store = await import("../lib/blog/store.ts");
const images = await import("../lib/blog/image-store.ts");
const registry = await import("../lib/blog/registry.ts");

const ticks = () => Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i, new Date().toISOString()]));
const DAY = 24 * 60 * 60 * 1000;

let mayank: Author;
let cofounder: Author;

async function user(email: string, name?: string) {
  const d = await db();
  const id = crypto.randomUUID();
  await d.insert(schema.users).values({ id, email });
  if (name) await d.insert(schema.profiles).values({ userId: id, name });
  return { id, email };
}

async function asAuthor(u: { id: string; email: string }, sessionAge = 0): Promise<Author> {
  const access = await accessFor(u, new Date(Date.now() - sessionAge));
  assert.equal(access.kind, "author");
  return (access as { author: Author }).author;
}

function draft(over: Partial<WriteDraft> = {}): WriteDraft {
  return {
    ...emptyDraft("training-for-a-first-10k"),
    title: "Training for a first 10K",
    dek: "What to eat in the weeks before.",
    topic: "training",
    seoDescription: "What to eat in the weeks before a first 10K race in an Indian city, from the people building D-Human.",
    blocks: [{ id: "b1", type: "paragraph", spans: [{ text: "Start slow and eat real meals." }] }],
    ...over,
  };
}

/** A new post saved with this draft; returns its id and current version. */
async function newPost(me: Author, d: WriteDraft) {
  const created = await store.createPost(me, d);
  assert.ok(created.ok);
  const post = await store.getEditorPost(me, created.id);
  return { id: created.id, version: post!.draftVersion };
}

/** The cofounder's "Looks good" to this version, which every post needs before its words go live. */
async function approved(id: string, version: number) {
  const asked = await store.requestReview(mayank, id, cofounder.id);
  assert.ok(asked.ok);
  assert.ok((await store.decideReview(cofounder, asked.review.id, { status: "looks_good", note: null, draftVersion: version })).ok);
}

const publishInput = (draftVersion: number, over: Partial<Parameters<typeof store.publishPost>[2]> = {}) => ({
  draftVersion,
  checklist: ticks(),
  meaningful: false,
  featured: false,
  shareImageId: null,
  ...over,
});

async function row(id: string) {
  const d = await db();
  const [r] = await d.select().from(schema.blogPosts).where(eq(schema.blogPosts.id, id));
  return r;
}

before(async () => {
  mayank = await asAuthor(await user("mayank@d-human.fit", "Mayank Narayan"));
  cofounder = await asAuthor(await user("cofounder@d-human.fit"));
});
beforeEach(() => {
  g.__revalidated = [];
});
after(removeDatabase);

describe("who may write", () => {
  it("reads the owner list case-blind and ignores junk", () => {
    assert.deepEqual([...ownerEmails(" A@x.in ,, nope ,b@y.in")], ["a@x.in", "b@y.in"]);
    assert.equal(ownerEmails("").size, 0);
  });

  it("refuses the signed out and anyone not on the list; makes an owner's byline on first visit", async () => {
    assert.equal((await accessFor(null, null)).kind, "signed_out");
    const stranger = await user("stranger@example.com", "Stranger");
    assert.equal((await accessFor(stranger, new Date())).kind, "not_author");
    assert.equal(mayank.name, "Mayank Narayan", "from the app profile");
    assert.equal(mayank.slug, "mayank-narayan");
    assert.equal(cofounder.name, "Cofounder", "from the address when there's no profile");
    const again = await asAuthor({ id: "x", email: "MAYANK@d-human.fit" });
    assert.equal(again.id, mayank.id, "one row per address");
  });

  it("shuts out a writer whose row is switched off, and one removed from the list", async () => {
    const d = await db();
    const u = await user("guest@d-human.fit");
    process.env.BLOG_OWNER_EMAILS += ",guest@d-human.fit";
    await asAuthor(u);
    await d.update(schema.blogAuthors).set({ active: false }).where(eq(schema.blogAuthors.email, "guest@d-human.fit"));
    assert.equal((await accessFor(u, new Date())).kind, "not_author");
    process.env.BLOG_OWNER_EMAILS = "mayank@d-human.fit,cofounder@d-human.fit";
    await d.update(schema.blogAuthors).set({ active: true }).where(eq(schema.blogAuthors.email, "guest@d-human.fit"));
    assert.equal((await accessFor(u, new Date())).kind, "not_author");
  });

  it("calls a session fresh for 7 days", () => {
    assert.equal(isFresh(new Date(Date.now() - 6 * DAY)), true);
    assert.equal(isFresh(new Date(Date.now() - 8 * DAY)), false);
    assert.equal(isFresh(null), false);
  });
});

describe("drafts", () => {
  it("saves from the version it loaded, and calls a stale save a conflict naming who saved", async () => {
    const { id, version } = await newPost(mayank, draft());
    const first = await store.saveDraft(mayank, id, version, draft({ title: "Mine" }));
    assert.ok(first.ok);
    const stale = await store.saveDraft(cofounder, id, version, draft({ title: "Theirs" }));
    assert.equal(stale.ok, false);
    assert.deepEqual(stale.ok === false && stale.error === "conflict" && [stale.version, stale.by], [first.version, "Mayank Narayan"]);
    assert.equal(((await row(id)).draft as WriteDraft).title, "Mine");
  });

  it("refuses an unsafe draft instead of storing it", async () => {
    const { id, version } = await newPost(mayank, draft());
    const bad = await store.saveDraft(mayank, id, version, draft({ blocks: [{ id: "x", type: "paragraph", spans: [{ text: "x", href: "javascript:alert(1)" }] }] }));
    assert.equal(bad.ok === false && bad.error, "invalid");
  });

  it("refuses an address another post holds, with a suggestion", async () => {
    await newPost(mayank, draft({ slug: "roti-calories" }));
    const { id, version } = await newPost(mayank, draft({ slug: "something-else" }));
    const taken = await store.saveDraft(mayank, id, version, draft({ slug: "roti-calories" }));
    assert.deepEqual(taken.ok === false && taken.error === "slug_taken" && taken.suggestion, "roti-calories-2");
  });

  it("gives an import whose address is taken a placeholder instead", async () => {
    await newPost(mayank, draft({ slug: "dal-protein" }));
    const { id } = await newPost(mayank, draft({ slug: "dal-protein" }));
    assert.match((await row(id)).slug, /^untitled-/);
  });

  it("shows another writer's open editor as a soft lock", async () => {
    const { id } = await newPost(mayank, draft());
    const seen = await store.getEditorPost(cofounder, id);
    assert.equal(seen?.lock?.name, "Mayank Narayan");
    assert.equal((await store.getEditorPost(mayank, id))?.lock, null, "not a lock for yourself");
  });
});

describe("publishing", () => {
  it("needs a recent sign-in", async () => {
    const stale = await asAuthor({ id: "m", email: "mayank@d-human.fit" }, 8 * DAY);
    const { id, version } = await newPost(stale, draft({ slug: "stale-session" }));
    assert.deepEqual(await store.publishPost(stale, id, publishInput(version)), { ok: false, error: "sign_in_again" });
  });

  it("blocks on automatic checks and on missing ticks, and publishes nothing", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "checks-first", dek: "Medically reviewed advice." }));
    const r = await store.publishPost(mayank, id, publishInput(version));
    assert.ok(r.ok === false && r.error === "checks" && r.checks.some((c) => c.code === "doctor_reviewed"));
    const clean = await newPost(mayank, draft({ slug: "ticks-first" }));
    const noTicks = await store.publishPost(mayank, clean.id, publishInput(clean.version, { checklist: {} }));
    assert.equal(noTicks.ok === false && noTicks.error, "checklist");
    assert.equal((await row(clean.id)).live, null);
    assert.equal((await row(clean.id)).status, "draft");
  });

  it("refuses a stale version", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "stale-version" }));
    await store.saveDraft(mayank, id, version, draft({ slug: "stale-version", title: "Changed" }));
    assert.equal((await store.publishPost(mayank, id, publishInput(version))).ok === false, true);
  });

  it("copies draft to live with what the page needs, keeps the address, and expires the pages", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "first-10k" }));
    await approved(id, version);
    const r = await store.publishPost(mayank, id, publishInput(version));
    assert.deepEqual(r.ok && [r.action, r.slug], ["publish", "first-10k"]);
    const saved = await row(id);
    const live = saved.live as StoredLive;
    assert.equal(saved.status, "live");
    assert.equal(saved.liveVersion, version);
    assert.ok(saved.publishedAt);
    assert.equal(live.title, "Training for a first 10K");
    assert.equal(live.author.name, "Mayank Narayan");
    assert.equal(live.readingMinutes, 1);
    assert.equal(live.topic, "training");
    assert.equal("slug" in live, false, "the working address isn't part of the live copy");
    const d = await db();
    const slugs = await d.select().from(schema.blogSlugs).where(eq(schema.blogSlugs.postId, id));
    assert.deepEqual(slugs.map((s) => s.slug), ["first-10k"]);
    assert.deepEqual(g.__revalidated.sort(), ["blog", `blog:post:${id}`]);
    const [record] = await d.select().from(schema.blogPublishes).where(eq(schema.blogPublishes.postId, id));
    assert.equal(record.action, "publish");
    const seen = await registry.readLivePost(d, "first-10k");
    assert.equal(seen.kind === "live" && seen.post.title, "Training for a first 10K", "the reader's schema accepts what publish wrote");
    assert.ok(record.checklist && Object.keys(record.checklist as object).length === CHECKLIST_ITEMS.length);
  });

  it("never lets a draft edit reach live until Update, and asks for ticks only when the body changed", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "edits-wait" }));
    await approved(id, version);
    assert.ok((await store.publishPost(mayank, id, publishInput(version))).ok);
    const saved = await store.saveDraft(mayank, id, version, draft({ slug: "edits-wait", title: "A new title" }));
    assert.ok(saved.ok);
    assert.equal(((await row(id)).live as StoredLive).title, "Training for a first 10K");
    const list = await store.listPosts();
    assert.equal(list.find((p) => p.id === id)?.changesNotLive, true);

    const noTicks = await store.publishPost(mayank, id, publishInput(saved.version, { checklist: {} }));
    assert.equal(noTicks.ok === false && noTicks.error, "checklist", "the body changed");
    assert.equal((await store.publishPost(mayank, id, publishInput(saved.version))).ok === false, true, "new words need a new read");
    await approved(id, saved.version);
    const updated = await store.publishPost(mayank, id, publishInput(saved.version, { meaningful: true }));
    assert.equal(updated.ok && updated.action, "update");
    const after = await row(id);
    assert.equal((after.live as StoredLive).title, "A new title");
    assert.ok(after.updatedOn, "a meaningful update shows its date");

    const featureOnly = await store.publishPost(mayank, id, publishInput(after.draftVersion, { checklist: {}, featured: true }));
    assert.ok(featureOnly.ok, "same body: no ticks needed");
  });

  it("renames a live post only at Update, and keeps the old address for a redirect", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "old-address" }));
    await approved(id, version);
    assert.ok((await store.publishPost(mayank, id, publishInput(version))).ok);
    const saved = await store.saveDraft(mayank, id, version, draft({ slug: "new-address" }));
    assert.ok(saved.ok);
    assert.equal((await row(id)).slug, "old-address", "still live at the old address");
    assert.ok((await store.publishPost(mayank, id, publishInput(saved.version, { checklist: {} }))).ok, "a new address alone needs no read");
    assert.equal((await row(id)).slug, "new-address");
    const d = await db();
    const slugs = await d.select().from(schema.blogSlugs).where(eq(schema.blogSlugs.postId, id));
    assert.deepEqual(slugs.map((s) => s.slug).sort(), ["new-address", "old-address"]);
    const other = await newPost(cofounder, draft({ slug: "another" }));
    const grab = await store.saveDraft(cofounder, other.id, other.version, draft({ slug: "old-address" }));
    assert.equal(grab.ok === false && grab.error, "slug_taken", "a redirecting address isn't free");
  });

  it("keeps one featured post", async () => {
    const a = await newPost(mayank, draft({ slug: "featured-a" }));
    const b = await newPost(mayank, draft({ slug: "featured-b" }));
    await approved(a.id, a.version);
    await approved(b.id, b.version);
    await store.publishPost(mayank, a.id, publishInput(a.version, { featured: true }));
    await store.publishPost(mayank, b.id, publishInput(b.version, { featured: true }));
    assert.equal((await row(a.id)).featured, false);
    assert.equal((await row(b.id)).featured, true);
  });
});

describe("a second writer's read", () => {
  const health = (slug: string) => draft({ slug, topic: "calories", title: "Calories in a roti" });

  it("holds a health post until a different writer says Looks good to this version", async () => {
    const { id, version } = await newPost(mayank, health("roti-health"));
    assert.equal((await store.publishPost(mayank, id, publishInput(version))).ok === false, true);

    assert.equal((await store.requestReview(mayank, id, mayank.id)).ok, false, "not yourself");
    const asked = await store.requestReview(mayank, id, cofounder.id);
    assert.ok(asked.ok);
    assert.equal(asked.reviewerEmail, "cofounder@d-human.fit");
    assert.equal((await store.decideReview(mayank, asked.review.id, { status: "looks_good", note: null, draftVersion: version })).ok, false, "only the reviewer");
    assert.deepEqual(await store.decideReview(cofounder, asked.review.id, { status: "looks_good", note: null, draftVersion: version - 1 }), { ok: false, error: "changed" });
    const ok = await store.decideReview(cofounder, asked.review.id, { status: "looks_good", note: null, draftVersion: version });
    assert.ok(ok.ok);
    const published = await store.publishPost(mayank, id, publishInput(version));
    assert.ok(published.ok);
  });

  it("needs a new read when the body changes after it", async () => {
    const { id, version } = await newPost(mayank, health("roti-health-2"));
    const asked = await store.requestReview(mayank, id, cofounder.id);
    assert.ok(asked.ok);
    await store.decideReview(cofounder, asked.review.id, { status: "looks_good", note: null, draftVersion: version });
    const edited = await store.saveDraft(mayank, id, version, { ...health("roti-health-2"), dek: "Changed after the read." });
    assert.ok(edited.ok);
    assert.deepEqual(await store.publishPost(mayank, id, publishInput(edited.version)), { ok: false, error: "review_needed" });
  });

  it("asks for a read on every post, training too (Mayank's default)", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "training-solo" }));
    assert.deepEqual(await store.publishPost(mayank, id, publishInput(version)), { ok: false, error: "review_needed" });
    await approved(id, version);
    assert.ok((await store.publishPost(mayank, id, publishInput(version))).ok);
  });

  it("takes answers only to pending requests, for the version asked about, from a second reader", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "answers-once" }));
    const asked = await store.requestReview(mayank, id, cofounder.id);
    assert.ok(asked.ok);
    assert.ok((await store.decideReview(cofounder, asked.review.id, { status: "needs_changes", note: "Add a source.", draftVersion: version })).ok);
    assert.deepEqual(await store.decideReview(cofounder, asked.review.id, { status: "looks_good", note: null, draftVersion: version }), { ok: false, error: "answered" });
    assert.deepEqual(await store.publishPost(mayank, id, publishInput(version)), { ok: false, error: "review_needed" });

    // A reader who saved the version asked about can't answer for it.
    const again = await store.requestReview(mayank, id, cofounder.id);
    assert.ok(again.ok);
    const theirs = await store.saveDraft(cofounder, id, version, draft({ slug: "answers-once", dek: "With a source now." }));
    assert.ok(theirs.ok);
    const later = await store.requestReview(mayank, id, cofounder.id);
    assert.ok(later.ok);
    assert.deepEqual(await store.decideReview(cofounder, later.review.id, { status: "looks_good", note: null, draftVersion: theirs.version }), { ok: false, error: "own_words" });
    assert.deepEqual(await store.decideReview(cofounder, again.review.id, { status: "looks_good", note: null, draftVersion: theirs.version }), { ok: false, error: "changed" });
    assert.deepEqual(await store.publishPost(mayank, id, publishInput(theirs.version)), { ok: false, error: "review_needed" });

    // Once the writer's save is the last one, the cofounder's read counts.
    const mine = await store.saveDraft(mayank, id, theirs.version, draft({ slug: "answers-once", dek: "With a source now, checked." }));
    assert.ok(mine.ok);
    await approved(id, mine.version);
    assert.ok((await store.publishPost(mayank, id, publishInput(mine.version))).ok);
  });
});

describe("take down, restore, discard, delete", () => {
  it("takes a post down and back, unfeaturing it", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "down-and-up" }));
    await approved(id, version);
    await store.publishPost(mayank, id, publishInput(version, { featured: true }));
    assert.ok((await store.changeStatus(mayank, id, "take_down")).ok);
    assert.deepEqual([(await row(id)).status, (await row(id)).featured], ["taken_down", false]);
    assert.equal((await store.publishPost(mayank, id, publishInput(version))).ok, false, "restore first");
    assert.ok((await store.changeStatus(mayank, id, "restore")).ok);
    assert.equal((await row(id)).status, "live");
  });

  it("discards draft changes back to the live copy", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "discard-me" }));
    await approved(id, version);
    await store.publishPost(mayank, id, publishInput(version));
    await store.saveDraft(mayank, id, version, draft({ slug: "discard-me", title: "Half-written change" }));
    const r = await store.changeStatus(mayank, id, "discard");
    assert.ok(r.ok);
    const post = await store.getEditorPost(mayank, id);
    assert.equal(post?.draft.title, "Training for a first 10K");
    assert.equal(post?.draft.slug, "discard-me");
    assert.equal(post?.draft.blocks.length, 1);
  });

  it("deletes drafts and taken-down posts only, and retires a published address for good", async () => {
    const { id, version } = await newPost(mayank, draft({ slug: "gone-for-good" }));
    await approved(id, version);
    await store.publishPost(mayank, id, publishInput(version));
    assert.deepEqual(await store.deletePost(mayank, id), { ok: false, error: "wrong_state" });
    await store.changeStatus(mayank, id, "take_down");
    assert.ok((await store.deletePost(mayank, id)).ok);
    const d = await db();
    const [kept] = await d.select().from(schema.blogSlugs).where(eq(schema.blogSlugs.slug, "gone-for-good"));
    assert.equal(kept.postId, null, "the address stays, pointing nowhere");
    const reuse = await newPost(cofounder, draft({ slug: "gone-for-good" }));
    assert.match((await row(reuse.id)).slug, /^untitled-/, "never reused");

    const scratch = await newPost(mayank, draft({ slug: "scratch" }));
    assert.ok((await store.deletePost(mayank, scratch.id)).ok);
    const [none] = await d.select().from(schema.blogSlugs).where(eq(schema.blogSlugs.slug, "scratch"));
    assert.equal(none, undefined, "a draft's address was never public, so it's free again");
  });
});

// ── Photos ──────────────────────────────────────────────────────────────────

/** A JPEG header with a frame of this size (enough for the checks; nobody decodes it). */
function jpeg(width: number, height: number, { exif = false, pad = 0 } = {}) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const app1 = exif ? [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00] : [];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  // A scan header, then its compressed data (zeros here), then the end of the image.
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  return Buffer.from([0xff, 0xd8, ...app0, ...app1, ...sof, ...sos, ...new Array(pad + 16).fill(0), 0xff, 0xd9]);
}
/** A lossy WebP header of this size. */
function webp(width: number, height: number, seed = 0) {
  const b = Buffer.alloc(64);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(56, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8 ", 12, "ascii");
  b.writeUInt32LE(36, 16);
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(width, 26);
  b.writeUInt16LE(height, 28);
  b[40] = seed;
  return b;
}

describe("photos", () => {
  it("knows WebP and JPEG by their bytes and reads their size", () => {
    assert.equal(images.sniffImage(webp(960, 640)), "image/webp");
    assert.equal(images.sniffImage(jpeg(960, 640)), "image/jpeg");
    assert.equal(images.sniffImage(Buffer.from("\x89PNG\r\n\x1a\n0000000000")), null);
    assert.equal(images.sniffImage(Buffer.from("<svg onload=alert(1)>")), null);
    assert.deepEqual(images.imageFacts(webp(960, 640), "image/webp"), { width: 960, height: 640, metadata: false });
    assert.deepEqual(images.imageFacts(jpeg(1600, 1067), "image/jpeg"), { width: 1600, height: 1067, metadata: false });
  });

  it("accepts the editor's widths, and refuses anything else", () => {
    const ok = images.checkPhotoFiles([webp(1600, 1067), webp(480, 320), webp(960, 640)]);
    assert.ok(ok.ok);
    assert.deepEqual(ok.files.map((f) => f.width), [480, 960, 1600]);
    assert.match(ok.files[0].name, /^w480-[0-9a-f]{6}\.webp$/);
    assert.ok(images.checkPhotoFiles([webp(1200, 800), webp(480, 320), webp(960, 640)]).ok, "a smaller original is the top width");

    const err = (parts: Buffer[]) => {
      const r = images.checkPhotoFiles(parts);
      return r.ok ? "ok" : r.error;
    };
    assert.equal(err([]), "no_file");
    assert.equal(err([webp(480, 320), webp(960, 640), webp(1600, 1067), webp(1600, 1067, 1)]), "too_many_files");
    assert.equal(err([Buffer.from("GIF89a0000000000000")]), "unsupported_type");
    assert.equal(err([jpeg(960, 640, { exif: true })]), "metadata");
    assert.equal(err([webp(480, 320), jpeg(960, 640)]), "mixed_types");
    assert.equal(err([webp(2400, 1600)]), "bad_widths");
    assert.equal(err([webp(500, 333), webp(960, 640)]), "bad_widths");
    assert.equal(err([webp(480, 320), webp(960, 900)]), "bad_shape");
    assert.equal(err([webp(400, 3000)]), "bad_shape");
    assert.equal(err([jpeg(960, 640, { pad: 1_500_001 })]), "too_large");
  });

  it("refuses camera and location details anywhere in a file, and files that don't read cleanly", () => {
    const seg = (marker: number, data: number[]) => [0xff, marker, ((data.length + 2) >> 8) & 0xff, (data.length + 2) & 0xff, ...data];
    const sof = seg(0xc0, [8, 640 >> 8, 640 & 0xff, 960 >> 8, 960 & 0xff, 1, 1, 0x11, 0]);
    const sos = seg(0xda, [1, 1, 0, 0, 0x3f, 0]);
    const text = (t: string) => [...Buffer.from(t)];
    const file = (...parts: number[][]) => Buffer.from([0xff, 0xd8, ...parts.flat(), 0xff, 0xd9]);
    const err = (b: Buffer) => {
      const r = images.checkPhotoFiles([b]);
      return r.ok ? "ok" : r.error;
    };
    assert.equal(err(file(sof, sos, [0x12, 0xff, 0x00, 0x34])), "ok", "an escaped 0xFF in the image data is fine");
    assert.equal(err(file(sof, seg(0xfe, text("taken at 28.61N 77.20E")), sos, [0x12])), "metadata", "a comment");
    assert.equal(err(file(sof, seg(0xed, text("Photoshop 3.0 IPTC")), sos, [0x12])), "metadata", "IPTC");
    assert.equal(err(file(sof, seg(0xe1, text("http://ns.adobe.com/xap/1.0/")), sos, [0x12])), "metadata", "XMP");
    assert.equal(err(file(sof, sos, [0x12], seg(0xe1, text("Exif")), sos, [0x34])), "metadata", "between scans");
    assert.equal(err(Buffer.concat([file(sof, sos, [0x12]), Buffer.from("GPS 28.61N")])), "unreadable", "bytes after the end");
    assert.equal(err(Buffer.from([0xff, 0xd8, ...sof, ...sos, 0x12])), "unreadable", "no end");

    const riff = (...chunks: [string, Buffer][]) => {
      const body = Buffer.concat([Buffer.from("WEBP"), ...chunks.map(([name, data]) => Buffer.concat([Buffer.from(name), Buffer.from(Uint32Array.of(data.length).buffer), data, Buffer.alloc(data.length % 2)]))]);
      return Buffer.concat([Buffer.from("RIFF"), Buffer.from(Uint32Array.of(body.length).buffer), body]);
    };
    const frame = Buffer.alloc(30);
    frame.set([0x9d, 0x01, 0x2a], 3);
    frame.writeUInt16LE(960, 6);
    frame.writeUInt16LE(640, 8);
    assert.equal(err(riff(["VP8 ", frame])), "ok");
    assert.equal(err(riff(["VP8 ", frame], ["XMP ", Buffer.from("<x:xmpmeta/>")])), "metadata");
    const cut = riff(["VP8 ", frame]);
    cut.writeUInt32LE(cut.length, 4);
    assert.equal(err(cut), "unreadable", "a RIFF size longer than the file");
    const short = riff(["VP8 ", frame], ["XMP ", Buffer.from("<x:xmpmeta/>")]);
    short.writeUInt32LE(4 + 8 + frame.length, 4);
    assert.equal(err(short), "unreadable", "a RIFF size that stops before an XMP chunk");
    assert.equal(err(Buffer.concat([riff(["VP8 ", frame]), Buffer.from("GPS 28.61N")])), "unreadable", "bytes after the RIFF end");
  });

  it("takes share images only as JPEGs at the share sizes, the link preview required", () => {
    const all = images.checkShareFiles([jpeg(1200, 630), jpeg(1200, 675), jpeg(1200, 900), jpeg(1200, 1200)]);
    assert.ok(all.ok);
    assert.deepEqual(all.files.map((f) => f.name.split("-")[0]), ["og", "16x9", "4x3", "1x1"]);
    assert.ok(images.checkShareFiles([jpeg(1200, 630)]).ok);
    assert.equal(images.checkShareFiles([jpeg(1200, 675)]).ok, false, "no link preview");
    assert.equal(images.checkShareFiles([webp(1200, 630)]).ok, false);
    assert.equal(images.checkShareFiles([jpeg(1200, 630), jpeg(1200, 630)]).ok, false, "each size once");
    assert.equal(images.checkShareFiles([jpeg(1200, 631)]).ok, false);
  });

  it("stores a photo, reads its files back, and puts it in the live copy", async () => {
    const checked = images.checkPhotoFiles([webp(480, 320), webp(960, 640), webp(1600, 1067)]);
    assert.ok(checked.ok);
    const img = await images.saveImage(mayank.id, checked);
    const file = img.files[1];
    const back = await images.readImageFile(img.id, file.name);
    assert.equal(back?.mime, "image/webp");
    assert.equal(back?.bytes.length, 64);
    assert.equal(await images.readImageFile(img.id, "w960-000000.webp"), null);
    assert.equal(await images.readImageFile("../etc", file.name), null);
    assert.ok(await images.updateImage(img.id, { focalX: 2, focalY: 0.25, keepColour: true }));
    const shown = (await images.editorImages([img.id]))[img.id];
    assert.deepEqual([shown.focalX, shown.focalY, shown.keepColour], [1, 0.25, true]);

    const { id, version } = await newPost(
      mayank,
      draft({ slug: "with-a-photo", cover: { imageId: img.id, alt: "A runner at dawn" }, blocks: [...draft().blocks, { id: "p", type: "photo", imageId: img.id, alt: "Dal" }] }),
    );
    const share = images.checkShareFiles([jpeg(1200, 630), jpeg(1200, 1200)]);
    assert.ok(share.ok);
    const shareImg = await images.saveImage(mayank.id, share, { keepColour: true });
    await approved(id, version);
    const r = await store.publishPost(mayank, id, publishInput(version, { shareImageId: shareImg.id }));
    assert.ok(r.ok);
    assert.ok(r.checks.some((c) => c.code === "small_photo") === false, "1600 px is big enough");
    const live = (await row(id)).live as StoredLive;
    assert.deepEqual(Object.keys(live.images), [img.id], "photos only; the share image has its own field");
    assert.equal(live.images[img.id].focalY, 0.25);
    assert.equal(live.share?.imageId, shareImg.id);
    assert.match(live.share?.files.og ?? "", /^og-[0-9a-f]{6}\.jpg$/);
    assert.match(live.share?.files["1x1"] ?? "", /^1x1-/);
    assert.equal(live.share?.files["16x9"], undefined);

    // The reader lane sees it: the post page's lookup, and the image route's read function.
    const d = await db();
    const found = await registry.readLivePost(d, "with-a-photo");
    assert.equal(found.kind, "live");
    assert.equal(found.kind === "live" && found.post.cover?.alt, "A runner at dawn");
    assert.equal(found.kind === "live" && found.post.share?.imageId, shareImg.id);
    const og = await images.readImageFile(shareImg.id, live.share!.files.og);
    assert.equal(og?.mime, "image/jpeg");
  });

  it("won't publish a post whose photo isn't stored", async () => {
    const ghost = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
    const { id, version } = await newPost(mayank, draft({ slug: "ghost-photo", blocks: [...draft().blocks, { id: "p", type: "photo", imageId: ghost, alt: "x" }] }));
    const r = await store.publishPost(mayank, id, publishInput(version));
    assert.ok(r.ok === false && r.error === "checks" && r.checks.some((c) => c.code === "missing_photo"));
  });
});

describe("profiles", () => {
  it("saves a byline with https links only", async () => {
    assert.ok((await store.updateAuthorProfile(mayank, { name: "Mayank Narayan", role: "Co-founder, D-Human", bio: "Builds D-Human.", links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/x" }], photoImageId: null })).ok);
    const bad = await store.updateAuthorProfile(mayank, { name: "M", role: "", bio: "", links: [{ label: "X", url: "javascript:alert(1)" }], photoImageId: null });
    assert.equal(bad.ok, false);
    assert.equal((await store.updateAuthorProfile(mayank, { name: "", role: "", bio: "", links: [], photoImageId: null })).ok, false);
    const p = await store.getAuthorProfile(mayank);
    assert.equal(p.role, "Co-founder, D-Human");
    assert.deepEqual(g.__revalidated.sort(), ["blog", "blog:authors"]);
  });
});
