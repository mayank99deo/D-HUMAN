// The blog's content schema (lib/blog/blocks.ts): what a post may contain, checked on save
// and again before a live post renders. Links, block types and sizes are the attack surface.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";
import type { PostDraft } from "../lib/blog/types.ts";
import { AUTHOR, draft, image, live } from "./support/blog.ts";

allowAppImports();
const {
  PostDraftSchema,
  PostLiveSchema,
  closingLines,
  headings,
  isExternalHref,
  isInternalHref,
  isPostSlug,
  isSafeHref,
  mentionsReportReads,
  missingImageIds,
  readingMinutes,
  usedImageIds,
} = await import("../lib/blog/blocks.ts");
const { BLOG_LIMITS } = await import("../lib/blog/types.ts");

const ch = (code: number) => String.fromCharCode(code);
/** A draft with these blocks, valid or not: the schema is what decides. */
const withBlocks = (blocks: unknown[]) => ({ ...draft(), blocks }) as unknown as PostDraft;
const paragraph = (spans: unknown[]) => ({ id: "p1", type: "paragraph", spans });

describe("links", () => {
  const refused = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    `java${ch(9)}script:alert(1)`,
    `${ch(1)}javascript:alert(1)`,
    " https://example.com",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "mailto:someone@example.com",
    "ftp://example.com/file",
    "https:example.com",
    "https://user:pass@example.com",
    "//evil.example/x",
    `/${ch(92)}evil.example`,
    "/api/account/delete",
    "/fuel",
    "/blog/../api/profile",
    "/blog/%2e%2e/api/profile",
    "/calorie-trackerx",
    "/blog/",
    `https://example.com/a${ch(0x2028)}b`,
  ];
  const allowed = [
    "https://www.nin.res.in/rdabook/brief_note.pdf",
    "http://example.com/page?a=1#b",
    "/blog/roti-calories",
    "/blog/roti-calories#start",
    "/calorie-tracker",
    "/calorie-tracker#faq",
    "/team/mayank-narayan",
    "/signin?next=%2Ffuel",
  ];

  it("refuses scripts, other schemes, credentials and paths out of the blog", () => {
    for (const href of refused) {
      assert.equal(isSafeHref(href), false, JSON.stringify(href));
      assert.equal(PostDraftSchema.safeParse(withBlocks([paragraph([{ text: "x", href }])])).success, false, JSON.stringify(href));
    }
  });
  it("allows full http(s) addresses and our guide, blog, team and sign-in paths", () => {
    for (const href of allowed) {
      assert.ok(isSafeHref(href), href);
      assert.ok(PostDraftSchema.safeParse(withBlocks([paragraph([{ text: "x", href }])])).success, href);
    }
    assert.ok(isExternalHref("https://example.com") && !isInternalHref("https://example.com"));
    assert.ok(isInternalHref("/blog/x") && !isExternalHref("/blog/x"));
  });
  it("lets source links be web addresses only", () => {
    const bad = { ...draft(), sources: [{ id: "s1", name: "x", url: "/blog/x" }] };
    assert.equal(PostDraftSchema.safeParse(bad).success, false);
  });
});

describe("blocks", () => {
  it("accepts a post with one of every block", () => {
    const result = PostDraftSchema.safeParse(draft());
    assert.ok(result.success, JSON.stringify(result.error?.issues));
  });
  it("refuses block types it doesn't know, and HTML smuggled in as a field", () => {
    assert.equal(PostDraftSchema.safeParse(withBlocks([{ id: "h", type: "html", html: "<script>alert(1)</script>" }])).success, false);
    assert.equal(PostDraftSchema.safeParse(withBlocks([{ ...paragraph([]), html: "<b>x</b>" }])).success, false);
    assert.equal(PostDraftSchema.safeParse(withBlocks([paragraph([{ text: "x", style: "color:red" }])])).success, false);
    assert.equal(PostDraftSchema.safeParse({ ...draft(), html: "<p>x</p>" }).success, false);
  });
  it("keeps lists one level deep", () => {
    const nested = { id: "l", type: "list", ordered: false, items: [[{ id: "l2", type: "list", ordered: false, items: [[{ text: "x" }]] }]] };
    assert.equal(PostDraftSchema.safeParse(withBlocks([nested])).success, false);
  });
  it("refuses oversize text, too many blocks and a post over the size limit", () => {
    const long = "a".repeat(BLOG_LIMITS.blockCharsMax + 1);
    assert.equal(PostDraftSchema.safeParse(withBlocks([paragraph([{ text: long }])])).success, false);
    const half = "a".repeat(BLOG_LIMITS.blockCharsMax / 2 + 1);
    assert.equal(PostDraftSchema.safeParse(withBlocks([paragraph([{ text: half }, { text: half }])])).success, false, "the block's total counts");
    const many = Array.from({ length: BLOG_LIMITS.blocksMax + 1 }, (_, i) => ({ ...paragraph([{ text: "x" }]), id: `p${i}` }));
    assert.equal(PostDraftSchema.safeParse(withBlocks(many)).success, false);
    const big = Array.from({ length: 60 }, (_, i) => ({ ...paragraph([{ text: "a".repeat(4_000) }]), id: `p${i}` }));
    assert.equal(PostDraftSchema.safeParse(withBlocks(big)).success, false, "over 200 KB");
    assert.equal(PostDraftSchema.safeParse({ ...draft(), title: "a".repeat(BLOG_LIMITS.titleMax + 1) }).success, false);
  });
  it("checks the rules between blocks: ids, sources, table shape, guide links, NUL", () => {
    const d = draft();
    assert.equal(PostDraftSchema.safeParse(withBlocks([paragraph([]), paragraph([])])).success, false, "duplicate ids");
    assert.equal(PostDraftSchema.safeParse(withBlocks([{ id: "k", type: "keyNumber", value: "1", label: "x", sourceId: "nope" }])).success, false);
    assert.equal(PostDraftSchema.safeParse(withBlocks([{ id: "t", type: "table", caption: "c", header: ["a", "b"], rows: [["1"]] }])).success, false);
    assert.equal(PostDraftSchema.safeParse(withBlocks([{ id: "t", type: "table", caption: "c", header: ["a", "b", "c", "d", "e"], rows: [] }])).success, false);
    assert.equal(PostDraftSchema.safeParse(withBlocks([{ id: "g", type: "tryIt", destination: "guide", line: "" }])).success, false);
    assert.equal(PostDraftSchema.safeParse(withBlocks([{ id: "g", type: "tryIt", destination: "fuel", guidePath: "/protein-tracker", line: "" }])).success, false);
    assert.equal(PostDraftSchema.safeParse(withBlocks([{ id: "h", type: "heading", level: 4, text: "x" }])).success, false);
    assert.equal(PostDraftSchema.safeParse({ ...d, title: `a${ch(0)}b` }).success, false);
    assert.equal(PostDraftSchema.safeParse(withBlocks([{ ...paragraph([]), id: "bad id!" }])).success, false);
  });
});

describe("drafts and live posts", () => {
  it("lets a draft be unfinished, but not a live post", () => {
    const unfinished = { ...draft(), title: "", cover: { imageId: "img-cover", alt: "" } };
    assert.ok(PostDraftSchema.safeParse(unfinished).success);
    assert.equal(PostLiveSchema.safeParse({ ...live(), title: " " }).success, false);
    assert.equal(PostLiveSchema.safeParse({ ...live(), cover: { imageId: "img-cover", alt: "" } }).success, false);
  });
  it("needs every photo a live post shows", () => {
    assert.ok(PostLiveSchema.safeParse(live()).success);
    assert.equal(PostLiveSchema.safeParse(live({ images: { "img-cover": image("img-cover") } })).success, false);
  });
  it("drops unknown top-level keys from a live post instead of taking it off the site", () => {
    const parsed = PostLiveSchema.parse({ ...live(), addedLater: { x: 1 } });
    assert.equal("addedLater" in parsed, false);
  });
  it("only serves image files of the two upload types", () => {
    const svg = image("img-cover", { files: [{ name: "w960-abc.svg", width: 960, mime: "image/webp" }] });
    assert.equal(PostLiveSchema.safeParse(live({ images: { "img-cover": svg, "img-thali": image("img-thali") } })).success, false);
  });
});

describe("addresses", () => {
  it("keeps post addresses away from the blog's own pages", () => {
    for (const ok of ["roti-calories", "b12-on-a-vegetarian-diet"]) assert.ok(isPostSlug(ok), ok);
    for (const bad of ["page", "topics", "img", "rss", "Roti", "roti_calories", "__none__", "a".repeat(81)]) assert.equal(isPostSlug(bad), false, bad);
  });
});

describe("reading helpers", () => {
  it("works out reading time from the words, at least a minute", () => {
    assert.equal(readingMinutes({ title: "x", dek: "", blocks: [] }), 1);
    const words = Array.from({ length: 1_000 }, () => "word").join(" ");
    assert.equal(readingMinutes({ title: "", dek: "", blocks: [{ id: "p", type: "paragraph", spans: [{ text: words }] }] }), 5);
  });
  it("gives each H2 a readable anchor that never repeats, Hindi ones too", () => {
    const h = headings([
      { id: "a", type: "heading", level: 2, text: "Start from your weight" },
      { id: "b", type: "heading", level: 3, text: "Not in contents" },
      { id: "c", type: "heading", level: 2, text: "Start from your weight!" },
      { id: "D9", type: "heading", level: 2, text: "रोज़ कितना प्रोटीन" },
    ]);
    assert.deepEqual(
      h.map((x) => x.anchor),
      ["start-from-your-weight", "start-from-your-weight-2", "section-d9"],
    );
  });
  it("lists the photos a post uses, and the ones not uploaded", () => {
    assert.deepEqual(usedImageIds(draft()), ["img-cover", "img-thali"]);
    assert.deepEqual(missingImageIds(draft(), new Set(["img-cover"])), ["img-thali"]);
  });
  it("adds the AI line only to posts that talk about report reads", () => {
    assert.equal(mentionsReportReads(draft()), false);
    assert.ok(mentionsReportReads({ ...draft(), dek: "How D-Human's report reads work." }));
    assert.ok(mentionsReportReads(withBlocks([{ id: "t", type: "tryIt", destination: "upload", line: "" }])));
    const lines = closingLines({ ...draft(), dek: "AI reads your blood report.", author: AUTHOR });
    assert.match(lines[0], /^Written by Mayank Narayan from the sources above\. General information, not medical advice\./);
    assert.equal(lines[1], "D-Human's report reads are AI-analysed. No doctor reviews them.");
    assert.doesNotMatch(closingLines({ ...draft(), sources: [], author: AUTHOR })[0], /sources above/);
  });
});
