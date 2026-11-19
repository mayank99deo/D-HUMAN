// Pasting into /write (components/write/paste.ts): Google Docs' clipboard HTML keeps its
// headings, bold, italic, links and lists and loses everything else; plain text from
// Notes or WhatsApp becomes paragraphs and lists. Trees are built by hand in the shape
// Google Docs puts on the clipboard, because Node has no DOMParser.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PasteNode } from "../components/write/paste.ts";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { blocksFromHtml, blocksFromText, unwrapLink } = await import("../components/write/paste.ts");
const { parseDraft, emptyDraft } = await import("../lib/blog/checks.ts");

const t = (text: string): PasteNode => ({ nodeType: 3, nodeName: "#text", childNodes: [], textContent: text });
const h = (name: string, attrs: Record<string, string> = {}, ...children: (PasteNode | string)[]): PasteNode => {
  const kids = children.map((c) => (typeof c === "string" ? t(c) : c));
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    childNodes: kids,
    textContent: kids.map((k) => k.textContent ?? "").join(""),
    getAttribute: (n) => attrs[n] ?? null,
  };
};
const span = (text: string, style = "font-size:11pt;font-weight:400;font-style:normal") => h("span", { style }, text);
const ids = () => {
  let n = 0;
  return () => `b${++n}`;
};

// What Google Docs puts on the clipboard: everything inside <b style="font-weight:normal" id="docs-internal-guid-…">.
function docsClipboard(...children: PasteNode[]) {
  return h("body", {}, h("meta", { charset: "utf-8" }), h("b", { style: "font-weight:normal;", id: "docs-internal-guid-1234" }, ...children));
}

describe("Google Docs HTML", () => {
  it("keeps headings, bold, italic, links and lists, and takes the first H1 as the title", () => {
    const root = docsClipboard(
      h("h1", { dir: "ltr" }, span("How to count calories in Indian food", "font-size:20pt")),
      h("p", { dir: "ltr" }, span("A roti is about "), span("120 kcal", "font-size:11pt;font-weight:700"), span(", and "), span("dal", "font-style:italic"), span(" varies.")),
      h("h2", { dir: "ltr" }, span("Portions")),
      h(
        "p",
        { dir: "ltr" },
        span("See "),
        h("a", { href: "https://www.google.com/url?q=https://www.nin.res.in/&sa=D&ust=1" }, span("ICMR-NIN", "text-decoration:underline")),
        span("."),
      ),
      h("ul", {}, h("li", { style: "list-style-type:disc" }, h("p", {}, span("Roti"))), h("li", {}, h("p", {}, span("Rice", "font-weight:700")))),
      h("h3", {}, span("Notes")),
      h("ol", {}, h("li", {}, h("p", {}, span("Weigh once")))),
    );
    const r = blocksFromHtml(root, ids());
    assert.equal(r.title, "How to count calories in Indian food");
    assert.deepEqual(r.blocks, [
      { id: "b1", type: "paragraph", spans: [{ text: "A roti is about " }, { text: "120 kcal", bold: true }, { text: ", and " }, { text: "dal", italic: true }, { text: " varies." }] },
      { id: "b2", type: "heading", level: 2, text: "Portions" },
      { id: "b3", type: "paragraph", spans: [{ text: "See " }, { text: "ICMR-NIN", href: "https://www.nin.res.in/" }, { text: "." }] },
      { id: "b4", type: "list", ordered: false, items: [[{ text: "Roti" }], [{ text: "Rice", bold: true }]] },
      { id: "b5", type: "heading", level: 3, text: "Notes" },
      { id: "b6", type: "list", ordered: true, items: [[{ text: "Weigh once" }]] },
    ]);
    assert.ok(parseDraft({ ...emptyDraft(""), title: r.title, blocks: r.blocks }).ok, "the result saves");
  });

  it("takes a big first line as the title (Docs' Title style is a 26 pt paragraph)", () => {
    const r = blocksFromHtml(docsClipboard(h("p", {}, span("Protein per rupee", "font-size:26pt")), h("p", {}, span("Body"))), ids());
    assert.equal(r.title, "Protein per rupee");
    assert.equal(r.blocks.length, 1);
  });

  it("drops scripts, styles, frames, images and unsafe links, and counts what it dropped", () => {
    const root = h(
      "body",
      {},
      h("script", {}, "alert(1)"),
      h("style", {}, "p{color:red}"),
      h("iframe", { src: "https://evil.example" }),
      h("p", {}, "Before ", h("img", { src: "https://lh3.googleusercontent.com/x", alt: "x" }), "after"),
      h("p", {}, h("a", { href: "javascript:alert(1)" }, "bad"), " ", h("a", { href: "data:text/html,x" }, "worse"), " ", h("a", { href: "#heading" }, "anchor")),
      h("svg", {}, h("script", {}, "alert(2)")),
    );
    const r = blocksFromHtml(root, ids());
    assert.deepEqual(r.blocks, [
      { id: "b1", type: "paragraph", spans: [{ text: "Before after" }] },
      { id: "b2", type: "paragraph", spans: [{ text: "bad worse anchor" }] },
    ]);
    assert.equal(r.dropped.images, 1);
    assert.equal(r.dropped.links, 2);
    assert.ok(!JSON.stringify(r).includes("alert"));
  });

  it("flattens nested lists to one level and splits paragraphs at line breaks", () => {
    const root = h(
      "body",
      {},
      h("ul", {}, h("li", {}, "One", h("ul", {}, h("li", {}, "One-a"))), h("li", {}, "Two")),
      h("p", {}, "Line one", h("br"), "Line two"),
    );
    const r = blocksFromHtml(root, ids());
    assert.deepEqual(r.blocks, [
      { id: "b1", type: "list", ordered: false, items: [[{ text: "One" }], [{ text: "One-a" }], [{ text: "Two" }]] },
      { id: "b2", type: "paragraph", spans: [{ text: "Line one" }] },
      { id: "b3", type: "paragraph", spans: [{ text: "Line two" }] },
    ]);
  });

  it("brings a table's text across one row per paragraph, and says so", () => {
    const root = h("body", {}, h("table", {}, h("tbody", {}, h("tr", {}, h("td", {}, "Roti"), h("td", {}, "120")), h("tr", {}, h("td", {}, "Rice"), h("td", {}, "200")))));
    const r = blocksFromHtml(root, ids());
    assert.deepEqual(
      r.blocks.map((b) => b.type === "paragraph" && b.spans[0].text),
      ["Roti · 120", "Rice · 200"],
    );
    assert.equal(r.dropped.tables, 1);
  });

  it("turns blockquotes into quotes and later H1s into H2s", () => {
    const r = blocksFromHtml(h("body", {}, h("p", {}, "Intro"), h("h1", {}, "Section"), h("blockquote", {}, h("p", {}, "Eat the rainbow."))), ids());
    assert.deepEqual(r.blocks.slice(1), [
      { id: "b2", type: "heading", level: 2, text: "Section" },
      { id: "b3", type: "quote", text: "Eat the rainbow." },
    ]);
    assert.equal(r.title, null);
  });

  it("cuts a paragraph longer than a block allows, and counts it", () => {
    const r = blocksFromHtml(h("body", {}, h("p", {}, "a".repeat(6_000))), ids());
    const p = r.blocks[0];
    assert.equal(p.type === "paragraph" && p.spans[0].text.length, 5_000);
    assert.equal(r.dropped.cut, 1);
  });

  it("unwraps Google's redirect links and leaves others alone", () => {
    assert.equal(unwrapLink("https://www.google.com/url?q=https://example.org/a&sa=D"), "https://example.org/a");
    assert.equal(unwrapLink("https://example.org/url?q=x"), "https://example.org/url?q=x");
    assert.equal(unwrapLink("/calorie-tracker"), "/calorie-tracker");
  });
});

describe("plain text", () => {
  it("makes paragraphs, lists and headings from lines", () => {
    const r = blocksFromText("# Why\nFirst line\nSecond line\n\n- roti\n- dal\n1. weigh\n\n## Notes\nDone", ids());
    assert.deepEqual(r.blocks, [
      { id: "b1", type: "heading", level: 2, text: "Why" },
      { id: "b2", type: "paragraph", spans: [{ text: "First line" }] },
      { id: "b3", type: "paragraph", spans: [{ text: "Second line" }] },
      { id: "b4", type: "list", ordered: false, items: [[{ text: "roti" }], [{ text: "dal" }], [{ text: "weigh" }]] },
      { id: "b5", type: "heading", level: 3, text: "Notes" },
      { id: "b6", type: "paragraph", spans: [{ text: "Done" }] },
    ]);
  });
});
