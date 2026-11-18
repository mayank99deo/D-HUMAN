// The post renderer (components/blog/Blocks.tsx) turns blocks into markup with React only:
// text stays text, unsafe links never become links even if one got past the schema, and the
// drawn cover is the same for the same post every time.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { allowAppImports } from "./support/app.ts";
import { BLOCKS, draft, image } from "./support/blog.ts";
import { allowTsx } from "./support/tsx.ts";

allowAppImports();
allowTsx();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { PostBody, renderBlocks, tryItTarget } = await import("../components/blog/Blocks.tsx");
const { ContourCover, contourPaths } = await import("../components/blog/ContourCover.tsx");
const { BlogImage } = await import("../components/blog/BlogImage.tsx");

const images = { "img-cover": image("img-cover"), "img-thali": image("img-thali", { keepColour: true }) };
const sources = draft().sources;
const render = (blocks: unknown[]) => renderToStaticMarkup(createElement(PostBody, { blocks: blocks as never, images, sources }));

describe("rendering a post", () => {
  const html = render(BLOCKS);

  it("renders every block with our own markup", () => {
    assert.match(html, /<h2 id="start-from-your-weight"[^>]*>Start from your weight<\/h2>/);
    assert.match(html, /<aside role="note" aria-label="Worth showing a doctor"/);
    assert.match(html, />Worth showing a doctor</);
    assert.match(html, /<a href="#source-1"[^>]*>Source 1<\/a>/);
    assert.match(html, /<caption[^>]*>Protein a day<\/caption>/);
    assert.match(html, /<blockquote>/);
    assert.match(html, /<img [^>]*alt="A steel thali with rice, rotis and dal"/);
    assert.match(html, /srcSet="\/blog\/img\/img-thali\/w480-a1b2c3\.webp 480w, /i);
  });
  it("sends Try it to sign-in with the screen to return to, and guide links to the guide", () => {
    assert.match(html, /href="\/signin\?next=%2Ffuel"[^>]*>Try it in Fuel</);
    assert.match(html, /href="\/protein-tracker"[^>]*>Read the guide</);
    const fuel = tryItTarget({ id: "t", type: "tryIt", destination: "fuel", line: "" });
    assert.equal(fuel.line, "Log your next meal by photo, voice or text, in your language.");
    assert.equal(tryItTarget({ id: "t", type: "tryIt", destination: "start", line: "Own words." }).href, "/signin");
  });
  it("marks links to other sites noopener and leaves ours plain", () => {
    assert.match(html, /<a href="https:\/\/www\.nin\.res\.in\/rdabook\/brief_note\.pdf" rel="noopener noreferrer"/);
    assert.match(html, /<a href="\/protein-tracker" class=/);
  });
  it("keeps photos black and white unless they're a screenshot or chart", () => {
    assert.match(renderToStaticMarkup(createElement(BlogImage, { image: image("x"), alt: "", sizes: "100vw" })), /filter:grayscale\(1\)/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(BlogImage, { image: image("x", { keepColour: true }), alt: "", sizes: "100vw" })), /grayscale/);
  });
  it("escapes text: markup in a post shows as characters", () => {
    const out = render([
      { id: "p", type: "paragraph", spans: [{ text: '<img src=x onerror="alert(1)"><script>alert(2)</script>' }] },
      { id: "h", type: "heading", level: 2, text: "</h2><script>alert(3)</script>" },
      { id: "q", type: "quote", text: "<iframe src=//evil>" },
    ]);
    assert.doesNotMatch(out, /<script|<img src=x|<iframe/);
    assert.match(out, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  });
  it("never links an unsafe address, even one that skipped the schema", () => {
    const out = render([
      {
        id: "p",
        type: "paragraph",
        spans: [
          { text: "one", href: "javascript:alert(1)" },
          { text: "two", href: "data:text/html,<script>alert(1)</script>" },
          { text: "three", href: "//evil.example" },
        ],
      },
    ]);
    assert.doesNotMatch(out, /href=/);
    assert.match(out, /onetwothree/);
  });
  it("skips a block type it doesn't know and a photo it doesn't have", () => {
    const out = render([
      { id: "x", type: "html", html: "<script>alert(1)</script>" },
      { id: "y", type: "photo", imageId: "not-uploaded", alt: "x" },
    ]);
    assert.equal(out, "");
  });
  it("matches the RenderBlocks contract /write's preview uses", () => {
    const out = renderToStaticMarkup(createElement("div", null, renderBlocks(BLOCKS, images, sources)));
    assert.equal(out, `<div>${html}</div>`);
  });
  it("has no raw-HTML escape hatch anywhere in the blog's components", () => {
    const dir = path.join(root, "components/blog");
    for (const file of readdirSync(dir)) {
      assert.doesNotMatch(readFileSync(path.join(dir, file), "utf8"), /dangerouslySetInnerHTML/, file);
    }
  });
});

describe("the drawn cover", () => {
  it("draws the same contour for the same post, and a different one for another", () => {
    assert.deepEqual(contourPaths("roti-calories"), contourPaths("roti-calories"));
    assert.notDeepEqual(contourPaths("roti-calories"), contourPaths("ferritin-for-runners"));
  });
  it("rounds coordinates, so server and browser markup always agree", () => {
    for (const d of contourPaths("roti-calories")) assert.doesNotMatch(d, /\d\.\d{2}/);
  });
  it("is decorative and carries the topic only when asked", () => {
    const out = renderToStaticMarkup(createElement(ContourCover, { slug: "x", label: "Protein" }));
    assert.match(out, /^<div aria-hidden="true"/);
    assert.match(out, />Protein<\/span>/);
  });
});
