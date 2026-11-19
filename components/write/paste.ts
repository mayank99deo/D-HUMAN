// Pasted text into blocks, in the author's browser (the server never parses HTML).
// Google Docs, Notes and WhatsApp put rich text on the clipboard as HTML; this keeps
// headings, bold, italic, links and lists, and drops everything else: fonts, colours,
// sizes, images, tables' layout, scripts and frames. The result still goes through
// parseDraft on save, so this is about keeping the author's formatting, not safety.
//
// It walks a minimal node interface rather than the DOM types, so tests can feed it
// hand-built trees: the browser passes `new DOMParser().parseFromString(html,
// "text/html").body`, an inert document where nothing loads or runs.

import { cleanSpans, safeHref } from "../../lib/blog/checks.ts";
import { BLOG_LIMITS, type Block, type Span } from "../../lib/blog/types.ts";

export type PasteNode = {
  nodeType: number; // 1 element, 3 text
  nodeName: string;
  childNodes: ArrayLike<PasteNode>;
  textContent: string | null;
  getAttribute?: (name: string) => string | null;
};

export type PasteResult = {
  title: string | null;
  blocks: Block[];
  /** What didn't come across, so the screen can say so. */
  dropped: { images: number; links: number; tables: number; cut: number };
};

type Marks = { bold: boolean; italic: boolean; href?: string };

const SKIP = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "MATH",
  "HEAD",
  "META",
  "LINK",
  "TITLE",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "PICTURE",
  "IMG",
  "HR",
  "COLGROUP",
]);
const BLOCKS = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "FIGURE", "FIGCAPTION", "ADDRESS", "PRE", "DL", "DT", "DD", "CENTER"]);
const HEADINGS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

const style = (n: PasteNode) => (n.getAttribute?.("style") ?? "").toLowerCase();

/** Bold from the tag or the inline style; Google Docs wraps everything in <b style="font-weight:normal">. */
function boldOf(n: PasteNode, inherited: boolean): boolean {
  const weight = style(n).match(/font-weight\s*:\s*([a-z0-9]+)/)?.[1];
  if (weight) return weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  if (n.nodeName === "B" || n.nodeName === "STRONG") return true;
  return inherited;
}

function italicOf(n: PasteNode, inherited: boolean): boolean {
  const s = style(n).match(/font-style\s*:\s*([a-z]+)/)?.[1];
  if (s) return s === "italic" || s === "oblique";
  if (n.nodeName === "I" || n.nodeName === "EM") return true;
  return inherited;
}

/** Google Docs' exported links go through google.com/url?q=…; keep the real address. */
export function unwrapLink(raw: string): string {
  try {
    const url = new URL(raw);
    if (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname === "/url") return url.searchParams.get("q") ?? raw;
  } catch {
    /* not absolute: keep as is */
  }
  return raw;
}

/** Points of type size on the first span, for spotting a Title-styled first line. */
const pointSize = (n: PasteNode) => Number(style(n).match(/font-size\s*:\s*([\d.]+)pt/)?.[1] ?? 0);

class Builder {
  blocks: Block[] = [];
  title: string | null = null;
  dropped = { images: 0, links: 0, tables: 0, cut: 0 };
  private spans: Span[] = [];
  private biggestPt = 0;
  private list: { ordered: boolean; items: Span[][] } | null = null;
  private item: Span[] | null = null;
  private newId: () => string;

  constructor(newId: () => string) {
    this.newId = newId;
  }

  text(value: string, marks: Marks, pt: number) {
    const target = this.item ?? this.spans;
    target.push({ text: value, ...(marks.bold ? { bold: true } : {}), ...(marks.italic ? { italic: true } : {}), ...(marks.href ? { href: marks.href } : {}) });
    if (value.trim()) this.biggestPt = Math.max(this.biggestPt, pt);
  }

  /** Ends the paragraph being collected. The first big line, before anything else, is the title. */
  paragraph() {
    const spans = cleanSpans(this.spans);
    const pt = this.biggestPt;
    this.spans = [];
    this.biggestPt = 0;
    if (!spans.length) return;
    if (this.title === null && !this.blocks.length && pt >= 20) {
      this.title = spans.map((s) => s.text).join("");
      return;
    }
    this.push({ id: this.newId(), type: "paragraph", spans });
  }

  heading(level: number, text: string) {
    this.paragraph();
    this.endList();
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (level === 1 && this.title === null && !this.blocks.length) {
      this.title = clean;
      return;
    }
    this.push({ id: this.newId(), type: "heading", level: level <= 2 ? 2 : 3, text: clean.slice(0, 200) });
  }

  startList(ordered: boolean) {
    this.paragraph();
    // Nested lists join their parent: posts have one level.
    if (!this.list) this.list = { ordered, items: [] };
  }

  startItem() {
    this.endItem();
    this.item = [];
  }

  endItem() {
    if (!this.item || !this.list) return;
    const spans = cleanSpans(this.item);
    if (spans.length) this.list.items.push(spans);
    this.item = null;
  }

  endList() {
    this.endItem();
    const list = this.list;
    this.list = null;
    if (list?.items.length) {
      for (let i = 0; i < list.items.length; i += 50) this.push({ id: this.newId(), type: "list", ordered: list.ordered, items: list.items.slice(i, i + 50) });
    }
  }

  quote(text: string) {
    this.paragraph();
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean) this.push({ id: this.newId(), type: "quote", text: clean.slice(0, 600) });
  }

  inList = () => this.list !== null;
  inItem = () => this.item !== null;

  private push(b: Block) {
    if (this.blocks.length >= BLOG_LIMITS.blocksMax) {
      this.dropped.cut++;
      return;
    }
    if (b.type === "paragraph") {
      // Very long paragraphs are cut at the block limit; the screen says so.
      let n = 0;
      const kept: Span[] = [];
      for (const s of b.spans) {
        if (n + s.text.length > BLOG_LIMITS.blockCharsMax) {
          kept.push({ ...s, text: s.text.slice(0, BLOG_LIMITS.blockCharsMax - n) });
          this.dropped.cut++;
          break;
        }
        kept.push(s);
        n += s.text.length;
      }
      b = { ...b, spans: kept };
    }
    this.blocks.push(b);
  }
}

function plainText(n: PasteNode): string {
  if (n.nodeType === 3) return n.textContent ?? "";
  if (n.nodeType !== 1 || SKIP.has(n.nodeName)) return "";
  if (n.nodeName === "BR") return " ";
  return Array.from(n.childNodes, plainText).join("");
}

function walk(n: PasteNode, b: Builder, marks: Marks, pt: number) {
  if (n.nodeType === 3) {
    const value = (n.textContent ?? "").replace(/\s+/g, " ");
    if (value) b.text(value, marks, pt);
    return;
  }
  if (n.nodeType !== 1) return;
  const name = n.nodeName.toUpperCase();
  if (name === "IMG" || name === "PICTURE") b.dropped.images++;
  if (SKIP.has(name)) return;

  if (name in HEADINGS) return b.heading(HEADINGS[name], plainText(n));
  if (name === "BLOCKQUOTE") return b.quote(plainText(n));
  if (name === "BR") {
    // A line break inside a list item is a space; elsewhere it starts a new paragraph.
    if (b.inItem()) b.text(" ", marks, pt);
    else b.paragraph();
    return;
  }
  if (name === "TABLE") {
    // A table's text comes across one row per paragraph; the author rebuilds it as a Table block.
    b.dropped.tables++;
    b.paragraph();
    const rows: PasteNode[] = [];
    const collect = (x: PasteNode) => {
      if (x.nodeType !== 1) return;
      if (x.nodeName.toUpperCase() === "TR") rows.push(x);
      else Array.from(x.childNodes).forEach(collect);
    };
    collect(n);
    for (const row of rows) {
      const cells = Array.from(row.childNodes)
        .filter((c) => c.nodeType === 1)
        .map((c) => plainText(c).replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (cells.length) {
        b.text(cells.join(" · "), { bold: false, italic: false }, 0);
        b.paragraph();
      }
    }
    return;
  }
  if (name === "UL" || name === "OL") {
    const outer = !b.inList();
    b.startList(name === "OL");
    for (const c of Array.from(n.childNodes)) walk(c, b, marks, pt);
    if (outer) b.endList();
    return;
  }
  if (name === "LI") {
    if (!b.inList()) b.startList(false);
    b.startItem();
    for (const c of Array.from(n.childNodes)) {
      const cn = c.nodeName.toUpperCase();
      // A nested list ends this item; its items follow as the parent's.
      if (cn === "UL" || cn === "OL") {
        b.endItem();
        walk(c, b, marks, pt);
      } else walk(c, b, marks, pt);
    }
    b.endItem();
    return;
  }

  const next: Marks = { bold: boldOf(n, marks.bold), italic: italicOf(n, marks.italic), href: marks.href };
  if (name === "A") {
    const raw = n.getAttribute?.("href");
    if (raw) {
      const href = safeHref(unwrapLink(raw));
      if (href) next.href = href;
      else if (!raw.startsWith("#")) b.dropped.links++;
    }
  }
  const size = pointSize(n) || pt;
  const isBlock = BLOCKS.has(name);
  // Inside a list item a <p> is just the item's text.
  if (isBlock && !b.inItem()) {
    b.paragraph();
    if (b.inList()) b.endList();
  }
  for (const c of Array.from(n.childNodes)) walk(c, b, next, size);
  if (isBlock && !b.inItem()) b.paragraph();
}

/** Blocks from a clipboard's HTML (already parsed into an inert document). */
export function blocksFromHtml(root: PasteNode, newId: () => string): PasteResult {
  const b = new Builder(newId);
  walk(root, b, { bold: false, italic: false }, 0);
  b.paragraph();
  b.endList();
  return { title: b.title, blocks: b.blocks, dropped: b.dropped };
}

const BULLET = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+/;

/** Blocks from plain text (Notes, WhatsApp): a line is a paragraph; "- " and "1. " lines are lists; "# " a heading. */
export function blocksFromText(text: string, newId: () => string): PasteResult {
  const b = new Builder(newId);
  const plain = { bold: false, italic: false };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const lineText = raw.trim();
    if (!lineText) {
      b.endList();
      continue;
    }
    const heading = lineText.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      b.heading(heading[1].length === 1 ? 2 : 3, heading[2]);
      continue;
    }
    if (BULLET.test(lineText)) {
      b.startList(/^\s*\d/.test(lineText));
      b.startItem();
      b.text(lineText.replace(BULLET, ""), plain, 0);
      b.endItem();
      continue;
    }
    b.endList();
    b.text(lineText, plain, 0);
    b.paragraph();
  }
  b.endList();
  return { title: null, blocks: b.blocks, dropped: b.dropped };
}

/**
 * The words of one editor field (a paragraph, a list item): bold, italic and links
 * kept, line breaks and inner blocks read as spaces. No title or block logic.
 */
export function inlineSpans(root: PasteNode): Span[] {
  const out: Span[] = [];
  const visit = (n: PasteNode, marks: Marks) => {
    if (n.nodeType === 3) {
      const text = n.textContent ?? "";
      if (text) out.push({ text, ...(marks.bold ? { bold: true } : {}), ...(marks.italic ? { italic: true } : {}), ...(marks.href ? { href: marks.href } : {}) });
      return;
    }
    if (n.nodeType !== 1) return;
    const name = n.nodeName.toUpperCase();
    if (SKIP.has(name)) return;
    if (name === "BR") {
      out.push({ text: " " });
      return;
    }
    const next: Marks = { bold: boldOf(n, marks.bold), italic: italicOf(n, marks.italic), href: marks.href };
    if (name === "A") {
      const raw = n.getAttribute?.("href");
      next.href = (raw && safeHref(unwrapLink(raw))) || undefined;
    }
    if ((BLOCKS.has(name) || name === "LI") && out.length) out.push({ text: " " });
    for (const c of Array.from(n.childNodes)) visit(c, next);
  };
  for (const c of Array.from(root.childNodes)) visit(c, { bold: false, italic: false });
  return cleanSpans(out);
}

/** A short random id for a new block. */
export const newBlockId = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");

/** In the browser: the clipboard's HTML through DOMParser, or its plain text. */
export function blocksFromClipboard(data: DataTransfer, newId: () => string = newBlockId): PasteResult | null {
  const html = data.getData("text/html");
  if (html && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return blocksFromHtml(doc.body as unknown as PasteNode, newId);
  }
  const text = data.getData("text/plain");
  return text.trim() ? blocksFromText(text, newId) : null;
}
