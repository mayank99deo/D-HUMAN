// QA security review of the blog editor (2026-11-19). Each test describes a rule the
// architecture spec sets and the code doesn't keep yet, so each fails until its bug is
// fixed. Exploits and fixes are in the QA report; the rules are in
// docs/team/specs/2026-11-18-blog-and-email-architecture.md §2.4–§2.6.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Author } from "../lib/auth/author.ts";
import type { WriteDraft } from "../lib/blog/checks.ts";
import { CHECKLIST_ITEMS } from "../lib/blog/types.ts";
import { allowAppImports, tempDatabase } from "./support/app.ts";

allowAppImports({
  "next/cache": "export const cacheLife = () => {}; export const cacheTag = () => {}; export const revalidateTag = () => {};",
  "next/headers": "export const cookies = async () => ({ get: () => undefined });",
  "next/server": "export const connection = async () => {}; export const after = (fn) => fn();",
});
const removeDatabase = tempDatabase();
process.env.BLOG_OWNER_EMAILS = "writer-a@test.local, writer-b@test.local";

const { db, schema } = await import("../lib/db/index.ts");
const { accessFor } = await import("../lib/auth/author.ts");
const { emptyDraft } = await import("../lib/blog/checks.ts");
const store = await import("../lib/blog/store.ts");
const images = await import("../lib/blog/image-store.ts");

const DAY = 24 * 60 * 60 * 1000;
const ticks = () => Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i, new Date().toISOString()]));
const publishInput = (draftVersion: number) => ({ draftVersion, checklist: ticks(), meaningful: false, featured: false, shareImageId: null });

let userA: { id: string; email: string };
let a: Author;
let b: Author;

async function user(email: string, name: string) {
  const d = await db();
  const id = crypto.randomUUID();
  await d.insert(schema.users).values({ id, email });
  await d.insert(schema.profiles).values({ userId: id, name });
  return { id, email };
}

async function asAuthor(u: { id: string; email: string }, sessionAge = 0): Promise<Author> {
  const access = await accessFor(u, new Date(Date.now() - sessionAge));
  assert.equal(access.kind, "author");
  return (access as { author: Author }).author;
}

/** A post on a reviewed (health) topic that passes every automatic check. */
function healthDraft(slug: string, text = "Start slow and eat real meals."): WriteDraft {
  return {
    ...emptyDraft(slug),
    title: "Protein for a first 10K",
    dek: "What to eat in the weeks before.",
    topic: "protein",
    seoDescription: "What to eat in the weeks before a first 10K race in an Indian city, from the people building D-Human.",
    blocks: [{ id: "b1", type: "paragraph", spans: [{ text }] }],
  };
}

async function newPost(me: Author, d: WriteDraft) {
  const created = await store.createPost(me, d);
  assert.ok(created.ok);
  const post = await store.getEditorPost(me, created.id);
  return { id: created.id, version: post!.draftVersion };
}

before(async () => {
  userA = await user("writer-a@test.local", "Writer A");
  a = await asAuthor(userA);
  b = await asAuthor(await user("writer-b@test.local", "Writer B"));
});

after(removeDatabase);

describe("the other founder's 'Looks good' (health topics)", () => {
  // Exploit: A asks B for a read. B rewrites the post in the editor (B can edit any post),
  // then answers A's old request with "Looks good" for the new version, and publishes.
  // decideReview accepts any later version, and hasLooksGood only compares the reviewer with
  // whoever asked, never with who wrote the words. Nobody else read them.
  it("a reviewer who rewrote the post can't approve their own words", async () => {
    const { id, version } = await newPost(a, healthDraft("reviewer-rewrites"));
    const asked = await store.requestReview(a, id, b.id);
    assert.ok(asked.ok);
    const edited = await store.saveDraft(b, id, version, healthDraft("reviewer-rewrites", "Three grams of protein per kilo suits everyone; no need to ask a doctor."));
    assert.ok(edited.ok);
    // Refusing this decision is one fix; publish below must ask for a read either way.
    await store.decideReview(b, asked.review.id, { status: "looks_good", note: null, draftVersion: edited.version });
    assert.deepEqual(await store.publishPost(b, id, publishInput(edited.version)), { ok: false, error: "review_needed" });
  });

  // Exploit: B presses "Ask A for a read" on A's own post; A answers "Looks good" and
  // publishes. The writer approved their own post.
  it("the person who wrote the post can't be the one who says it looks good", async () => {
    const { id, version } = await newPost(a, healthDraft("own-writer-reviews"));
    const asked = await store.requestReview(b, id, a.id);
    assert.ok(asked.ok);
    await store.decideReview(a, asked.review.id, { status: "looks_good", note: null, draftVersion: version });
    assert.deepEqual(await store.publishPost(a, id, publishInput(version)), { ok: false, error: "review_needed" });
  });
});

describe("the 7-day rule for changes to the public site", () => {
  // Spec §2.5: publish, take-down and author changes need a sign-in from the last 7 days.
  // The byline (name, role, bio, links, photo) shows on every post and /team page at once,
  // because readers render the author row as it is now. A cookie older than 7 days could
  // rename the writer and add a link to any site; checked live on a production build.
  it("an old session can't change a writer's public byline", async () => {
    const stale = await asAuthor(userA, 8 * DAY);
    const result = await store.updateAuthorProfile(stale, {
      name: "Someone Else",
      role: "Not a founder",
      bio: "Buy my course.",
      links: [{ label: "Website", url: "https://example.com/phish" }],
      photoImageId: null,
    });
    assert.deepEqual(result, { ok: false, error: "sign_in_again" });
  });
});

describe("photo uploads carry no location data (§2.4)", () => {
  const segment = (marker: number, data: number[]) => [0xff, marker, ((data.length + 2) >> 8) & 0xff, (data.length + 2) & 0xff, ...data];
  const exif = [...Buffer.from("Exif\0\0GPSLatitude=28.6139N GPSLongitude=77.2090E")];

  function jpeg(width: number, height: number, exifAfterFrame: boolean): Buffer {
    return Buffer.from([
      0xff, 0xd8,
      ...segment(0xe0, [...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
      ...segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
      ...(exifAfterFrame ? segment(0xe1, exif) : []),
      ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
      0x12, 0x34, 0xff, 0xd9,
    ]);
  }

  function webpWithExif(width: number, height: number): Buffer {
    const frame = Buffer.alloc(30);
    frame.set([0x9d, 0x01, 0x2a], 3);
    frame.writeUInt16LE(width, 6);
    frame.writeUInt16LE(height, 8);
    const chunk = (name: string, data: Buffer) => {
      const size = Buffer.alloc(4);
      size.writeUInt32LE(data.length);
      return Buffer.concat([Buffer.from(name), size, data, Buffer.alloc(data.length % 2)]);
    };
    const body = Buffer.concat([Buffer.from("WEBP"), chunk("VP8 ", frame), chunk("EXIF", Buffer.from("MM\0*GPSLatitude=28.6139N"))]);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(body.length);
    return Buffer.concat([Buffer.from("RIFF"), size, body]);
  }

  it("a plain JPEG of the right size is accepted (control)", () => {
    assert.equal(images.checkPhotoFiles([jpeg(960, 640, false)]).ok, true);
  });

  // jpegFacts stops reading at the frame header, so an EXIF block placed after it is
  // never seen. Uploaded through the API (not the editor's re-encode), the GPS text was
  // stored and then served from /blog/img/… with a one-year public cache.
  it("refuses a JPEG whose EXIF block comes after the frame header", () => {
    assert.deepEqual(images.checkPhotoFiles([jpeg(960, 640, true)]), { ok: false, error: "metadata" });
  });

  // webpFacts only reads VP8X's flags; a simple "VP8 " file with an EXIF chunk passes.
  it("refuses a WebP that carries an EXIF chunk", () => {
    assert.deepEqual(images.checkPhotoFiles([webpWithExif(960, 640)]), { ok: false, error: "metadata" });
  });
});
