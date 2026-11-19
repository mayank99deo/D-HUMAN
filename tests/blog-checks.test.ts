// What /write may save (lib/blog/checks.ts): links are http(s) or our own paths, text
// is capped and cleaned, unknown shapes are refused; and the automatic health checks
// block or warn as the product designer's §4.2 says.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WriteDraft } from "../lib/blog/checks.ts";
import { CHECKLIST_ITEMS, type Block } from "../lib/blog/types.ts";
import { allowAppImports } from "./support/app.ts";

// checks.ts reads the guide list from lib/seo.ts, whose domain imports are extensionless.
allowAppImports();
const { automaticChecks, blockers, cleanSpans, emptyDraft, canSayLooksGood, isPlaceholderSlug, missingTicks, parseDraft, placeholderSlug, readingMinutes, safeHref, slugify } =
  await import("../lib/blog/checks.ts");

const IMG = "3f2b6a1c-1d2e-4f5a-8b9c-0d1e2f3a4b5c";

function goodDraft(): WriteDraft {
  return {
    ...emptyDraft("roti-calories"),
    title: "How many calories are in a roti",
    dek: "A plain answer, with sources.",
    topic: "calories",
    seoDescription: "Calories in a roti by size and flour, worked out from public food tables, and how to log them in your language.",
    sources: [{ id: "s1", name: "ICMR-NIN 2020", url: "https://www.nin.res.in/" }],
    blocks: [
      { id: "b1", type: "paragraph", spans: [{ text: "A medium roti is about " }, { text: "120 kcal", bold: true }, { text: " (Source 1)." }] },
      { id: "b2", type: "heading", level: 2, text: "Why size matters" },
      { id: "b3", type: "keyNumber", value: "120", label: "kcal in a medium roti", sourceId: "s1" },
      { id: "b4", type: "tryIt", destination: "fuel", line: "Log your next meal by photo, voice or text, in your language." },
    ],
  };
}

const withBlock = (b: Block): WriteDraft => ({ ...goodDraft(), blocks: [...goodDraft().blocks, b] });
const codes = (d: WriteDraft, ctx = {}) => automaticChecks(d, ctx).map((c) => `${c.level}:${c.code}`);

describe("links", () => {
  it("allows https, http and our own public paths", () => {
    assert.equal(safeHref("https://www.nin.res.in/x?y=1"), "https://www.nin.res.in/x?y=1");
    assert.equal(safeHref("http://example.org"), "http://example.org");
    assert.equal(safeHref("/calorie-tracker"), "/calorie-tracker");
    assert.equal(safeHref("/blog/roti-calories#why"), "/blog/roti-calories#why");
    assert.equal(safeHref("/signin?next=/fuel"), "/signin?next=/fuel");
  });

  it("refuses scripts, data, protocol-relative, credentials, app screens and climbing paths", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "//evil.example",
      "/\\evil.example",
      "https://user:pass@evil.example",
      "ftp://example.org",
      "mailto:a@b.c",
      "/fuel",
      "/api/write/posts",
      "/blog/../api",
      "/blog/",
      "https://localhost",
      "https://exa mple.org",
    ]) {
      assert.equal(safeHref(bad), null, bad);
    }
  });

  it("drops a bad link when cleaning spans but keeps the words", () => {
    assert.deepEqual(cleanSpans([{ text: "click", href: "javascript:alert(1)" }]), [{ text: "click" }]);
  });
});

describe("parseDraft", () => {
  it("accepts a good draft and normalises it", () => {
    const r = parseDraft(goodDraft());
    assert.ok(r.ok);
    assert.equal(r.draft.blocks.length, 4);
  });

  it("refuses a javascript: link on save instead of hiding it", () => {
    const d = withBlock({ id: "x", type: "paragraph", spans: [{ text: "x", href: "javascript:alert(1)" }] });
    const r = parseDraft(d);
    assert.equal(r.ok, false);
  });

  it("refuses data: and vbscript: source links", () => {
    for (const url of ["data:text/html,hi", "vbscript:x", "/calorie-tracker"]) {
      const r = parseDraft({ ...goodDraft(), sources: [{ id: "s1", name: "x", url }] });
      assert.equal(r.ok, false, url);
    }
  });

  it("refuses unknown block types, unknown fields and HTML fields", () => {
    assert.equal(parseDraft(withBlock({ id: "x", type: "html", html: "<script>alert(1)</script>" } as unknown as Block)).ok, false);
    assert.equal(parseDraft(withBlock({ id: "x", type: "paragraph", spans: [], html: "<b>" } as unknown as Block)).ok, false);
    assert.equal(parseDraft({ ...goodDraft(), html: "<p>" }).ok, false);
    assert.equal(parseDraft(withBlock({ id: "x", type: "paragraph", spans: [{ text: "x", style: "color:red" }] } as unknown as Block)).ok, false);
  });

  it("refuses a nested list (posts have one level)", () => {
    const nested = { id: "x", type: "list", ordered: false, items: [[{ text: "a" }], [[{ text: "b" }]]] };
    assert.equal(parseDraft(withBlock(nested as unknown as Block)).ok, false);
  });

  it("refuses oversize text, too many blocks, and photos that aren't our image ids", () => {
    assert.equal(parseDraft(withBlock({ id: "x", type: "paragraph", spans: [{ text: "a".repeat(5_001) }] })).ok, false);
    assert.equal(parseDraft({ ...goodDraft(), title: "t".repeat(101) }).ok, false);
    const many = Array.from({ length: 301 }, (_, i) => ({ id: `p${i}`, type: "paragraph", spans: [{ text: "x" }] }));
    assert.equal(parseDraft({ ...goodDraft(), blocks: many }).ok, false);
    assert.equal(parseDraft(withBlock({ id: "x", type: "photo", imageId: "https://evil.example/x.png", alt: "x" })).ok, false);
    assert.equal(parseDraft(withBlock({ id: "x", type: "photo", imageId: IMG, alt: "A plate of food" })).ok, true);
  });

  it("refuses two blocks with one id, and an address that isn't lowercase words and hyphens", () => {
    assert.equal(parseDraft({ ...goodDraft(), blocks: [goodDraft().blocks[0], goodDraft().blocks[0]] }).ok, false);
    assert.equal(parseDraft({ ...goodDraft(), slug: "Roti Calories" }).ok, false);
    assert.equal(parseDraft({ ...goodDraft(), slug: "" }).ok, true, "empty while drafting");
  });

  it("strips control and direction-override characters, and merges same-mark spans", () => {
    const sneaky = `pay${String.fromCharCode(0x202e)}gpj.exe${String.fromCharCode(0)}`;
    const r = parseDraft(withBlock({ id: "x", type: "paragraph", spans: [{ text: sneaky }, { text: " more", bold: false } as never] }));
    assert.ok(r.ok);
    const p = r.draft.blocks.at(-1)!;
    assert.equal(p.type, "paragraph");
    assert.deepEqual(p.type === "paragraph" && p.spans, [{ text: "paygpj.exe more" }]);
  });

  it("keeps ZWJ and ZWNJ, which Devanagari needs", () => {
    const hindi = `क्${String.fromCharCode(0x200d)}ष`;
    const r = parseDraft({ ...goodDraft(), title: hindi });
    assert.ok(r.ok);
    assert.equal(r.draft.title, hindi);
  });

  it("pads table rows to the header and drops guide paths off guide destinations", () => {
    const r = parseDraft(
      withBlock({ id: "t", type: "table", caption: "Rotis", header: ["Size", "kcal"], rows: [["Small"], ["Large", "160", "extra"]], sourceId: "s1" } as Block),
    );
    assert.equal(r.ok, false, "a row wider than the table is refused");
    const ok = parseDraft(withBlock({ id: "t", type: "table", caption: "Rotis", header: ["Size", "kcal"], rows: [["Small"]], sourceId: "s1" }));
    assert.ok(ok.ok);
    const t = ok.draft.blocks.at(-1)!;
    assert.deepEqual(t.type === "table" && t.rows, [["Small", ""]]);
    const tryIt = parseDraft(withBlock({ id: "g", type: "tryIt", destination: "fuel", guidePath: "/calorie-tracker", line: "x" }));
    assert.ok(tryIt.ok);
    assert.equal("guidePath" in tryIt.draft.blocks.at(-1)!, false);
  });
});

describe("automatic checks", () => {
  it("a good draft has no blockers", () => {
    assert.deepEqual(blockers(automaticChecks(goodDraft())), []);
  });

  it("blocks missing pieces", () => {
    const empty = emptyDraft(placeholderSlug("abc123"));
    const found = codes(empty);
    for (const code of ["missing_title", "missing_topic", "missing_description", "missing_slug", "empty_body"]) assert.ok(found.includes(`block:${code}`), code);
  });

  it("blocks addresses the blog itself uses", () => {
    for (const slug of ["page", "topics", "img", "rss", "feed"]) assert.ok(codes({ ...goodDraft(), slug }).includes("block:reserved_slug"), slug);
    assert.equal(codes(goodDraft()).includes("block:reserved_slug"), false);
  });

  it("only saves links the reader will also accept", async () => {
    const { isSafeHref } = await import("../lib/blog/blocks.ts");
    for (const href of ["https://www.nin.res.in/x", "/calorie-tracker", "/blog/a-post", "/blog/%2e%2e/api", "/blog/./x", `https://exa${String.fromCharCode(0xa0)}mple.org`, "javascript:alert(1)"]) {
      const ours = safeHref(href);
      if (ours) assert.ok(isSafeHref(ours), `${href} saves, so the reader must accept it`);
    }
    assert.equal(safeHref("/blog/%2e%2e/api"), null);
  });

  it("blocks 'doctor-reviewed' claims and brand names, wherever they appear", () => {
    assert.ok(codes({ ...goodDraft(), dek: "Medically reviewed advice" }).includes("block:doctor_reviewed"));
    assert.ok(codes(withBlock({ id: "q", type: "quote", text: "Clinically proven to work" })).includes("block:doctor_reviewed"));
    const brand = automaticChecks(withBlock({ id: "b", type: "paragraph", spans: [{ text: "I take MuscleBlaze whey." }] }));
    assert.ok(brand.some((c) => c.code === "brand" && c.message.includes("MuscleBlaze") && c.blockId === "b"));
    assert.ok(codes({ ...goodDraft(), sources: [{ id: "s1", name: "Thyrocare data, 2023" }] }).includes("block:brand"));
  });

  it("doesn't call everyday words brands", () => {
    const d = withBlock({ id: "b", type: "paragraph", spans: [{ text: "We trekked in the Himalayas and read Patanjali's sutras in a busy metropolis." }] });
    assert.equal(codes(d).includes("block:brand"), false);
  });

  it("blocks photos without alt text, numbers without a source, and shop links", () => {
    assert.ok(codes(withBlock({ id: "p", type: "photo", imageId: IMG, alt: "" })).includes("block:missing_alt"));
    assert.ok(codes(withBlock({ id: "k", type: "keyNumber", value: "76%", label: "low in vitamin D", sourceId: "nope" })).includes("block:number_source"));
    assert.ok(codes(withBlock({ id: "t", type: "table", caption: "x", header: ["Food", "g"], rows: [["Dal", "9"]] })).includes("block:number_source"));
    assert.ok(codes(withBlock({ id: "l", type: "paragraph", spans: [{ text: "buy", href: "https://www.amazon.in/dp/x?tag=abc-21" }] })).includes("block:shop_link"));
  });

  it("needs a credit on a photo the author doesn't own", () => {
    const d = withBlock({ id: "p", type: "photo", imageId: IMG, alt: "Dal" });
    assert.ok(codes(d, { ownRights: { [IMG]: false } }).includes("block:missing_credit"));
    assert.equal(codes(d, { ownRights: { [IMG]: true } }).includes("block:missing_credit"), false);
    const credited = withBlock({ id: "p", type: "photo", imageId: IMG, alt: "Dal", credit: "Photo: A. Rao, CC BY 4.0, Wikimedia" });
    assert.equal(codes(credited, { ownRights: { [IMG]: false } }).includes("block:missing_credit"), false);
  });

  it("blocks a photo that isn't in the database and warns on a small one", () => {
    const d = withBlock({ id: "p", type: "photo", imageId: IMG, alt: "Dal" });
    assert.ok(codes(d, { imageWidths: {} }).includes("block:missing_photo"));
    assert.ok(codes(d, { imageWidths: { [IMG]: 960 } }).includes("warn:small_photo"));
    assert.equal(codes(d, { imageWidths: { [IMG]: 1600 } }).some((c) => c.includes("photo")), false);
  });

  it("warns on promises, diagnoses, 'accurate', bare 'free' and prices", () => {
    const say = (text: string) => codes(withBlock({ id: "w", type: "paragraph", spans: [{ text }] }));
    assert.ok(say("This diet cures fatigue.").includes("warn:promise"));
    assert.ok(say("Ye khana ilaaj hai.").includes("warn:promise"));
    assert.ok(say("100% results.").includes("warn:promise"));
    assert.ok(say("If you feel tired, you have anaemia.").includes("warn:diagnosis"));
    assert.ok(say("You may have a vitamin D deficiency.").includes("warn:diagnosis"));
    assert.ok(say("The most accurate tracker.").includes("warn:accurate"));
    assert.ok(say("It's free.").includes("warn:free"));
    assert.ok(say("It costs ₹49.").includes("warn:price"));
    assert.equal(say("It's free to start, and sugar-free sweets are fine.").includes("warn:free"), false);
    assert.equal(say("A low ferritin result can mean your iron stores are low.").includes("warn:diagnosis"), false);
  });

  it("warns on a health number when the post has no sources", () => {
    const d = { ...goodDraft(), sources: [], blocks: [{ id: "n", type: "paragraph", spans: [{ text: "Aim for 1.6 g per kg." }] } as Block] };
    assert.ok(codes(d).includes("warn:unsourced_number"));
  });

  it("lists blockers before warnings, once per block", () => {
    const d = withBlock({ id: "x", type: "paragraph", spans: [{ text: "It's free and accurate. GNC and GNC again." }] });
    const all = automaticChecks(d);
    const firstWarn = all.findIndex((c) => c.level === "warn");
    assert.ok(all.slice(firstWarn).every((c) => c.level === "warn"));
    assert.equal(all.filter((c) => c.code === "brand").length, 1);
  });
});

describe("addresses, reading time, checklist, review", () => {
  it("suggests an address from a Latin title, and none from a Hindi one", () => {
    assert.equal(slugify("How to count calories in Indian food: roti, dal & rice"), "how-count-calories-indian-food-roti-dal-rice");
    assert.equal(slugify("Café au lait"), "cafe-au-lait");
    assert.equal(slugify("खाने की कैलोरी"), "");
    assert.ok(slugify("x ".repeat(200)).length <= 80);
  });

  it("knows a placeholder address", () => {
    const p = placeholderSlug("4f9a2c7b1e");
    assert.ok(isPlaceholderSlug(p));
    assert.equal(isPlaceholderSlug("roti-calories"), false);
  });

  it("counts reading time at about 200 words a minute, at least 1", () => {
    assert.equal(readingMinutes(goodDraft()), 1);
    const long = { ...goodDraft(), blocks: [{ id: "l", type: "paragraph", spans: [{ text: "word ".repeat(1_000) }] } as Block] };
    assert.equal(readingMinutes(long), 5);
  });

  it("needs every checklist box ticked with a time", () => {
    assert.deepEqual(missingTicks(null), [...CHECKLIST_ITEMS]);
    const all = Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i, new Date().toISOString()]));
    assert.deepEqual(missingTicks(all), []);
    assert.deepEqual(missingTicks({ ...all, fixed_line: "yes" }), ["fixed_line"]);
  });

  it("takes a Looks good only as a second read: not from the post's writer or whoever saved the version", () => {
    assert.equal(canSayLooksGood("b", { authorId: "a", savedById: "a" }), true);
    assert.equal(canSayLooksGood("a", { authorId: "a", savedById: "b" }), false, "the writer");
    assert.equal(canSayLooksGood("b", { authorId: "a", savedById: "b" }), false, "the last to save");
    assert.equal(canSayLooksGood("c", { authorId: "a", savedById: "b" }), true);
    assert.equal(canSayLooksGood("b", { authorId: "a", savedById: null }), true);
  });
});
