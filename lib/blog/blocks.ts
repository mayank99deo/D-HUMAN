// The blog's content rules, in one zod schema: /write checks drafts with it on save, publish
// checks the live copy with it, and the reader parses every live post through it before
// rendering. Posts are structured blocks, never HTML, so the only way a link or an image gets
// onto a page is through the checks below. Pure (zod only), so the editor in the browser, the
// API and tests share it. Shapes: lib/blog/types.ts.

import { z } from "zod";
import { GUIDES, type GuidePath } from "../seo.ts";
import {
  BLOG_LANGUAGES,
  BLOG_LIMITS,
  BLOG_TOPICS,
  IMAGE_MIMES,
  INTERNAL_LINK_PREFIXES,
  SLUG_MAX,
  SLUG_PATTERN,
  TRY_IT_DESTINATIONS,
  type Block,
  type LiveImage,
  type PostDraft,
  type PostLive,
  type Source,
  type TryItDestination,
} from "./types.ts";

// ── Links ───────────────────────────────────────────────────────────────────

const LINK_MAX = 2_000;
// Spaces, control characters and line separators never belong in a link we write ourselves,
// and browsers quietly drop some of them (which is how "java\tscript:" slips past naive checks).
const UNSAFE_IN_LINK = /[\x00-\x20\x7f-\xa0\\\u2028\u2029]/;
const INTERNAL_BASE = "https://internal.invalid";

/** An http(s) address on another site, written out in full ("https://…"). */
export function isExternalHref(href: string): boolean {
  if (!href || href.length > LINK_MAX || UNSAFE_IN_LINK.test(href) || !/^https?:\/\//i.test(href)) return false;
  try {
    const url = new URL(href);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * A path on our own site from INTERNAL_LINK_PREFIXES. The browser must read it exactly as
 * written: anything it would normalise ("..", "%2e", "//host") is refused, so a link can't
 * climb out of /blog/ into the app or the API.
 */
export function isInternalHref(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//") || href.length > LINK_MAX || UNSAFE_IN_LINK.test(href)) return false;
  const path = href.split(/[?#]/, 1)[0];
  let url: URL;
  try {
    url = new URL(href, INTERNAL_BASE);
  } catch {
    return false;
  }
  if (url.origin !== INTERNAL_BASE || url.pathname !== path) return false;
  return INTERNAL_LINK_PREFIXES.some((prefix) => (prefix.endsWith("/") ? path.startsWith(prefix) && path.length > prefix.length : path === prefix));
}

/** The only links a post may carry. Checked on save, and again when rendering. */
export const isSafeHref = (href: string) => isExternalHref(href) || isInternalHref(href);

// ── Slugs ───────────────────────────────────────────────────────────────────

/** Words a post's address can't use: /blog/page/2, /blog/topics/…, /blog/img/… and the feed live there. */
export const RESERVED_SLUGS = ["page", "topics", "img", "rss", "feed"] as const;

export function isPostSlug(slug: string): boolean {
  return slug.length <= SLUG_MAX && SLUG_PATTERN.test(slug) && !(RESERVED_SLUGS as readonly string[]).includes(slug);
}

// ── Schema ──────────────────────────────────────────────────────────────────

/** Text of a given length. NUL is refused: Postgres can't store it in jsonb. */
const text = (max: number) => z.string().max(max).refine((s) => !s.includes("\u0000"), "Remove the hidden NUL character.");
const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Use letters, numbers, hyphens or underscores.");
/** "w960-3fa9c1.webp", "og-3fa9c1.jpg": a word, a dot, an image type. */
export const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(webp|jpg|jpeg)$/;
const FileName = z.string().regex(FILE_NAME_PATTERN);

const Href = z.string().refine(isSafeHref, "Links must start with https:// or be a D-Human guide or blog address.");
const ExternalHref = z.string().refine(isExternalHref, "Source links must start with https://.");

const SpanSchema = z.strictObject({
  text: text(BLOG_LIMITS.blockCharsMax),
  bold: z.literal(true).optional(),
  italic: z.literal(true).optional(),
  href: Href.optional(),
});
const Spans = z.array(SpanSchema).max(400);

const GUIDE_PATHS = GUIDES.map((g) => g.path) as [GuidePath, ...GuidePath[]];

export const BlockSchema = z.discriminatedUnion("type", [
  z.strictObject({ id: IdSchema, type: z.literal("paragraph"), spans: Spans }),
  z.strictObject({ id: IdSchema, type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text: text(200) }),
  // One level only: an item is a run of text, never another list.
  z.strictObject({ id: IdSchema, type: z.literal("list"), ordered: z.boolean(), items: z.array(Spans).min(1).max(50) }),
  z.strictObject({
    id: IdSchema,
    type: z.literal("photo"),
    imageId: IdSchema,
    alt: text(300),
    caption: text(300).optional(),
    credit: text(200).optional(),
    wide: z.boolean().optional(),
  }),
  z.strictObject({ id: IdSchema, type: z.literal("quote"), text: text(500), attribution: text(120).optional() }),
  z.strictObject({ id: IdSchema, type: z.literal("note"), title: text(100).optional(), spans: Spans }),
  z.strictObject({ id: IdSchema, type: z.literal("doctor"), spans: Spans }),
  z.strictObject({ id: IdSchema, type: z.literal("keyNumber"), value: text(24), label: text(200), sourceId: IdSchema }),
  z.strictObject({
    id: IdSchema,
    type: z.literal("tryIt"),
    destination: z.enum(TRY_IT_DESTINATIONS),
    guidePath: z.enum(GUIDE_PATHS).optional(),
    line: text(BLOG_LIMITS.tryItLineMax),
  }),
  z.strictObject({
    id: IdSchema,
    type: z.literal("table"),
    caption: text(200),
    header: z.array(text(60)).min(1).max(BLOG_LIMITS.tableColsMax),
    rows: z.array(z.array(text(120))).max(BLOG_LIMITS.tableRowsMax),
    sourceId: IdSchema.optional(),
  }),
]) satisfies z.ZodType<Block>;

const SourceSchema = z.strictObject({ id: IdSchema, name: text(500), url: ExternalHref.optional() }) satisfies z.ZodType<Source>;
const CoverSchema = z.strictObject({ imageId: IdSchema, alt: text(300), caption: text(300).optional(), credit: text(200).optional() });

const draftShape = {
  title: text(BLOG_LIMITS.titleMax),
  dek: text(BLOG_LIMITS.dekMax),
  cover: CoverSchema.nullable(),
  blocks: z.array(BlockSchema).max(BLOG_LIMITS.blocksMax),
  sources: z.array(SourceSchema).max(BLOG_LIMITS.sourcesMax),
  seoTitle: text(100).optional(),
  seoDescription: text(300),
};

type Issue = { message: string; path: (string | number)[] };

/** Rules across blocks: unique ids, sources that exist, block length, total size. */
function draftIssues(draft: PostDraft): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  draft.blocks.forEach((block, i) => {
    if (seen.has(block.id)) issues.push({ message: "Two blocks share an id.", path: ["blocks", i, "id"] });
    seen.add(block.id);
    if (blockText(block).length > BLOG_LIMITS.blockCharsMax) {
      issues.push({ message: `Keep a block under ${BLOG_LIMITS.blockCharsMax.toLocaleString("en-IN")} characters.`, path: ["blocks", i] });
    }
    if (block.type === "table" && block.rows.some((row) => row.length !== block.header.length)) {
      issues.push({ message: "Every row needs one cell per column.", path: ["blocks", i, "rows"] });
    }
    if (block.type === "tryIt" && (block.destination === "guide") !== Boolean(block.guidePath)) {
      issues.push({ message: "Pick a guide for a guide link, and only then.", path: ["blocks", i, "guidePath"] });
    }
  });
  const sourceIds = new Set<string>();
  draft.sources.forEach((source, i) => {
    if (sourceIds.has(source.id)) issues.push({ message: "Two sources share an id.", path: ["sources", i, "id"] });
    sourceIds.add(source.id);
  });
  draft.blocks.forEach((block, i) => {
    const sourceId = block.type === "keyNumber" || block.type === "table" ? block.sourceId : undefined;
    if (sourceId && !sourceIds.has(sourceId)) issues.push({ message: "Pick a source from this post's Sources.", path: ["blocks", i, "sourceId"] });
  });
  if (new TextEncoder().encode(JSON.stringify(draft)).length > BLOG_LIMITS.draftBytesMax) {
    issues.push({ message: "This post is too long to save. Split it into two.", path: [] });
  }
  return issues;
}

function addIssues(issues: Issue[], ctx: z.RefinementCtx) {
  for (const issue of issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
}

/** What /write saves. Blank titles and alt text are allowed while drafting; publish asks for them. */
export const PostDraftSchema = z.strictObject(draftShape).superRefine((draft, ctx) => addIssues(draftIssues(draft), ctx));

const LiveImageSchema = z.object({
  id: IdSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  focalX: z.number().min(0).max(1),
  focalY: z.number().min(0).max(1),
  keepColour: z.boolean(),
  files: z.array(z.object({ name: FileName, width: z.number().int().positive(), mime: z.enum(IMAGE_MIMES) })).min(1),
}) satisfies z.ZodType<LiveImage>;

export const AuthorLinkSchema = z.object({ label: z.enum(["LinkedIn", "X", "GitHub", "Website"]), url: ExternalHref });

/** The author as publish copied them; the reader shows the current author row, this is the fallback. */
const AuthorSnapshotSchema = z.object({
  id: IdSchema,
  slug: z.string().regex(SLUG_PATTERN),
  name: z.string().min(1).max(200),
  role: z.string().max(200),
  bio: z.string().max(2_000),
  photo: LiveImageSchema.nullable(),
  links: z.array(AuthorLinkSchema).max(5),
});

const ShareImagesSchema = z.object({
  imageId: IdSchema,
  files: z.object({ og: FileName, "16x9": FileName.optional(), "4x3": FileName.optional(), "1x1": FileName.optional() }),
});

const liveShape = {
  ...draftShape,
  topic: z.enum(BLOG_TOPICS).nullable(),
  language: z.enum(BLOG_LANGUAGES),
  readingMinutes: z.number().int().min(1).max(600),
  author: AuthorSnapshotSchema,
  images: z.record(z.string(), LiveImageSchema),
  share: ShareImagesSchema.nullable().optional(),
};

/** Rules that hold for every live post on top of the draft's: a title, alt text, and every photo on hand. */
function liveIssues(post: PostLive): Issue[] {
  const issues: Issue[] = [];
  if (!post.title.trim()) issues.push({ message: "A live post needs a title.", path: ["title"] });
  if (post.cover && !post.cover.alt.trim()) issues.push({ message: "Describe the cover photo.", path: ["cover", "alt"] });
  post.blocks.forEach((block, i) => {
    if (block.type === "photo" && !block.alt.trim()) issues.push({ message: "Describe this photo.", path: ["blocks", i, "alt"] });
  });
  for (const id of usedImageIds(post)) {
    if (!post.images[id]) issues.push({ message: `Photo ${id} is missing.`, path: ["images", id] });
  }
  return issues;
}

/**
 * What blog_posts.live holds. Extra top-level keys are dropped rather than refused, so a field
 * publish adds later can't take a post off the site; blocks and spans stay strict.
 */
export const PostLiveSchema = z.object(liveShape).superRefine((post, ctx) => {
  addIssues(draftIssues(post), ctx);
  addIssues(liveIssues(post), ctx);
}) satisfies z.ZodType<PostLive>;

// ── Reading helpers ─────────────────────────────────────────────────────────

const spansText = (spans: readonly { text: string }[]) => spans.map((s) => s.text).join("");

/** A block's visible words, for reading time, checks and search. */
export function blockText(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "doctor":
      return spansText(block.spans);
    case "note":
      return [block.title ?? "", spansText(block.spans)].join(" ");
    case "heading":
      return block.text;
    case "list":
      return block.items.map(spansText).join(" ");
    case "photo":
      return [block.caption ?? "", block.credit ?? ""].join(" ");
    case "quote":
      return [block.text, block.attribution ?? ""].join(" ");
    case "keyNumber":
      return `${block.value} ${block.label}`;
    case "tryIt":
      return block.line;
    case "table":
      return [block.caption, ...block.header, ...block.rows.flat()].join(" ");
  }
}

const WORDS_PER_MINUTE = 200;

/** Minutes to read, rounded, at least 1. Publish stores it; lists show it. */
export function readingMinutes(post: Pick<PostDraft, "title" | "dek" | "blocks">): number {
  const words = [post.title, post.dek, ...post.blocks.map(blockText)].join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Every photo a post shows: the cover, then the body's, in order, each once. */
export function usedImageIds(post: Pick<PostDraft, "cover" | "blocks">): string[] {
  const ids = [post.cover?.imageId, ...post.blocks.map((b) => (b.type === "photo" ? b.imageId : undefined))];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** Photos a draft uses that aren't in `known` (the uploaded ones). Publish refuses those. */
export const missingImageIds = (post: Pick<PostDraft, "cover" | "blocks">, known: ReadonlySet<string>) =>
  usedImageIds(post).filter((id) => !known.has(id));

export type Heading = { blockId: string; text: string; anchor: string };

const anchorWords = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");

/**
 * The post's H2s, each with an anchor readers can link to ("#start-from-your-weight").
 * Headings with no Latin letters (Hindi) fall back to the block's id. Anchors never repeat.
 */
export function headings(blocks: readonly Block[]): Heading[] {
  const used = new Set<string>();
  const out: Heading[] = [];
  for (const block of blocks) {
    if (block.type !== "heading" || block.level !== 2) continue;
    const base = anchorWords(block.text) || `section-${block.id.toLowerCase()}`;
    let anchor = base;
    for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`;
    used.add(anchor);
    out.push({ blockId: block.id, text: block.text, anchor });
  }
  return out;
}

const READS_WORDS = /\b(report reads?|reads? (your|my|a|the) (blood )?reports?|AI[- ]analys|blood report read)/i;

/** Posts that talk about D-Human's report reads carry the fixed "AI-analysed" line. */
export function mentionsReportReads(post: Pick<PostDraft, "title" | "dek" | "blocks">): boolean {
  if (post.blocks.some((b) => b.type === "tryIt" && b.destination === "upload")) return true;
  return READS_WORDS.test([post.title, post.dek, ...post.blocks.map(blockText)].join(" "));
}

/**
 * The lines every post ends with. Authors can't edit or remove them (product designer §4.3):
 * who wrote it, that it's general information and not medical advice, and, when the post
 * talks about report reads, that those are AI-analysed and no doctor reviews them.
 */
export function closingLines(post: Pick<PostDraft, "title" | "dek" | "blocks" | "sources"> & { author: { name: string } }): string[] {
  const from = post.sources.length ? " from the sources above" : "";
  const lines = [`Written by ${post.author.name}${from}. General information, not medical advice. If something here applies to you, it's worth asking a doctor.`];
  if (mentionsReportReads(post)) lines.push("D-Human's report reads are AI-analysed. No doctor reviews them.");
  return lines;
}

/** Try it: the default line the editor offers, the button, and the app screen behind sign-in. */
export const TRY_IT_COPY: Record<TryItDestination, { line: string; button: string; next: string | null }> = {
  fuel: { line: "Log your next meal by photo, voice or text, in your language.", button: "Try it in Fuel", next: "/fuel" },
  upload: { line: "Upload a blood report you already have. AI reads it for how you train.", button: "Read my report", next: "/upload" },
  stack: { line: "See what your markers and meals point to, food first.", button: "See my stack", next: "/stack" },
  wraps: { line: "Your week of meals, played back as a story.", button: "See my wrap", next: "/wraps" },
  start: { line: "AI reads your blood report and counts the calories and protein in your meals.", button: "Start free", next: null },
  guide: { line: "", button: "Read the guide", next: null },
};
