// What /write may save, and what must be true before a post goes live. Pure (zod and
// the shared types only), so the editor runs the same checks in the browser that the
// server runs again on save and on Publish.
//
// - parseDraft: the shape gate. Every link is http(s) or one of our own paths; text is
//   capped and stripped of control and direction-override characters; anything else
//   is refused, so no script, frame or third-party image can reach a post.
// - automaticChecks: the health rules (product designer §4.2) as blockers and warnings.
//   The word lists live here, with tests, so the crew can extend them without
//   touching the editor.
// Design: docs/team/specs/2026-11-18-blog.md §4, architecture §2.3.

import { z } from "zod";
import { GUIDES, type GuidePath } from "../seo.ts";
import { isExternalHref, isPostSlug, isSafeHref, readingMinutes, RESERVED_SLUGS } from "./blocks.ts";
import {
  BLOG_LIMITS,
  BLOG_TOPICS,
  CHECKLIST_ITEMS,
  IMAGE_SOFT_BELOW,
  REVIEWED_TOPICS,
  SLUG_MAX,
  SLUG_PATTERN,
  TRY_IT_DESTINATIONS,
  type Block,
  type BlogTopic,
  type ChecklistItem,
  type CheckResult,
  type Cover,
  type PostDraft,
  type Source,
  type Span,
} from "./types.ts";

/**
 * What the editor keeps in blog_posts.draft: the post (PostDraft, the shared contract)
 * plus its working address and topic. The columns hold what is live; publishing copies
 * these two across, so renaming a live post never moves it before Update.
 */
export type WriteDraft = PostDraft & { slug: string; topic: BlogTopic | null };

export const TOPIC_LABELS: Record<BlogTopic, string> = {
  calories: "Calories and Indian food",
  protein: "Protein",
  "blood-tests": "Blood tests",
  supplements: "Supplements",
  training: "Training and sport",
};

// ── Text ────────────────────────────────────────────────────────────────────

// C0 controls (tabs and newlines become spaces), DEL, C1 controls, and the bidi
// overrides that can make a link's text read differently from where it goes.
// ZWJ and ZWNJ stay: Devanagari needs them.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const HAS_CONTROL = new RegExp(CONTROL.source);

/** One line of text: controls removed, runs of whitespace (including newlines) become one space. */
export function cleanLine(value: string): string {
  return value.replace(CONTROL, "").replace(/[\s\u00a0]+/g, " ");
}

/** A one-line field: cleaned, trimmed, then refused (not cut) when over its limit. */
const line = (max: number) =>
  z
    .string()
    .transform((v) => cleanLine(v).trim())
    .pipe(z.string().max(max));

// ── Links ───────────────────────────────────────────────────────────────────

const LINK_MAX = 2_000;

/**
 * A link a post may carry, trimmed, or null. The reader's rule (isSafeHref in
 * lib/blog/blocks.ts) decides, so nothing saved here can be refused when it goes live:
 * http(s) with a host and no credentials, or a path under INTERNAL_LINK_PREFIXES that
 * the browser reads exactly as written. On top of it: a real domain (a dot in the host).
 */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href || HAS_CONTROL.test(href) || !isSafeHref(href)) return null;
  if (isExternalHref(href) && !new URL(href).hostname.includes(".")) return null;
  return href;
}

/** Sources link out only (http or https), never to our own paths. */
export function safeSourceUrl(raw: string): string | null {
  const href = safeHref(raw);
  return href && isExternalHref(href) ? href : null;
}

// ── Shape ───────────────────────────────────────────────────────────────────

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GUIDE_PATHS = GUIDES.map((g) => g.path) as [GuidePath, ...GuidePath[]];

const spanSchema = z
  .object({
    text: z.string().max(BLOG_LIMITS.blockCharsMax * 2),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    href: z.string().max(LINK_MAX).optional(),
  })
  .strict();
const spansSchema = z.array(spanSchema).max(400);

const id = z.string().regex(ID);
const imageId = z.string().regex(IMAGE_ID);

const blockSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("paragraph"), spans: spansSchema }).strict(),
  z.object({ id, type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text: line(200) }).strict(),
  z.object({ id, type: z.literal("list"), ordered: z.boolean(), items: z.array(spansSchema).min(1).max(50) }).strict(),
  z
    .object({
      id,
      type: z.literal("photo"),
      imageId,
      alt: line(300),
      caption: line(300).optional(),
      credit: line(200).optional(),
      wide: z.boolean().optional(),
    })
    .strict(),
  z.object({ id, type: z.literal("quote"), text: line(500), attribution: line(120).optional() }).strict(),
  z.object({ id, type: z.literal("note"), title: line(100).optional(), spans: spansSchema }).strict(),
  z.object({ id, type: z.literal("doctor"), spans: spansSchema }).strict(),
  z.object({ id, type: z.literal("keyNumber"), value: line(24), label: line(200), sourceId: z.string().regex(/^[A-Za-z0-9_-]{0,64}$/) }).strict(),
  z
    .object({
      id,
      type: z.literal("tryIt"),
      destination: z.enum(TRY_IT_DESTINATIONS),
      guidePath: z.enum(GUIDE_PATHS).optional(),
      line: line(BLOG_LIMITS.tryItLineMax),
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal("table"),
      caption: line(200),
      header: z.array(line(60)).min(1).max(BLOG_LIMITS.tableColsMax),
      rows: z.array(z.array(line(120)).max(BLOG_LIMITS.tableColsMax)).max(BLOG_LIMITS.tableRowsMax),
      sourceId: z.string().regex(/^[A-Za-z0-9_-]{0,64}$/).optional(),
    })
    .strict(),
]);

const coverSchema = z
  .object({ imageId, alt: line(300), caption: line(300).optional(), credit: line(200).optional() })
  .strict()
  .nullable();

const sourceSchema = z.object({ id, name: line(200), url: z.string().max(LINK_MAX).optional() }).strict();

const draftSchema = z
  .object({
    title: line(BLOG_LIMITS.titleMax),
    dek: line(BLOG_LIMITS.dekMax),
    cover: coverSchema,
    blocks: z.array(blockSchema).max(BLOG_LIMITS.blocksMax),
    sources: z.array(sourceSchema).max(BLOG_LIMITS.sourcesMax),
    seoTitle: line(100).optional(),
    seoDescription: line(300),
    slug: z.string().max(SLUG_MAX),
    topic: z.enum(BLOG_TOPICS).nullable(),
  })
  .strict();

/** Spans with only real marks, safe links, adjacent runs of the same marks merged, empties dropped. */
export function cleanSpans(spans: readonly { text: string; bold?: boolean; italic?: boolean; href?: string }[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const text = cleanLine(s.text);
    if (!text) continue;
    const span: Span = { text };
    if (s.bold) span.bold = true;
    if (s.italic) span.italic = true;
    const href = s.href ? safeHref(s.href) : null;
    if (href) span.href = href;
    const last = out[out.length - 1];
    if (last && last.bold === span.bold && last.italic === span.italic && last.href === span.href) last.text += text;
    else out.push(span);
  }
  // Leading and trailing spaces of the whole run go; inner spaces stay.
  if (out.length) {
    out[0].text = out[0].text.trimStart();
    out[out.length - 1].text = out[out.length - 1].text.trimEnd();
  }
  return out.filter((s) => s.text);
}

const spanChars = (spans: readonly Span[]) => spans.reduce((n, s) => n + s.text.length, 0);

type ParsedBlock = z.infer<typeof blockSchema>;

function normaliseBlock(b: ParsedBlock): Block {
  switch (b.type) {
    case "paragraph":
    case "doctor":
      return { id: b.id, type: b.type, spans: cleanSpans(b.spans) };
    case "note":
      return { id: b.id, type: "note", spans: cleanSpans(b.spans), ...(b.title ? { title: b.title } : {}) };
    case "list":
      return { id: b.id, type: "list", ordered: b.ordered, items: b.items.map(cleanSpans) };
    case "heading":
      return { id: b.id, type: "heading", level: b.level, text: b.text };
    case "photo":
      return {
        id: b.id,
        type: "photo",
        imageId: b.imageId,
        alt: b.alt,
        ...(b.caption ? { caption: b.caption } : {}),
        ...(b.credit ? { credit: b.credit } : {}),
        ...(b.wide ? { wide: true } : {}),
      };
    case "quote":
      return { id: b.id, type: "quote", text: b.text, ...(b.attribution ? { attribution: b.attribution } : {}) };
    case "keyNumber":
      return { id: b.id, type: "keyNumber", value: b.value, label: b.label, sourceId: b.sourceId };
    case "tryIt":
      return {
        id: b.id,
        type: "tryIt",
        destination: b.destination,
        line: b.line,
        ...(b.destination === "guide" && b.guidePath ? { guidePath: b.guidePath } : {}),
      };
    case "table": {
      const cols = b.header.length;
      const rows = b.rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
      return { id: b.id, type: "table", caption: b.caption, header: b.header, rows, ...(b.sourceId ? { sourceId: b.sourceId } : {}) };
    }
  }
}

function blockTooLong(b: Block): boolean {
  const max = BLOG_LIMITS.blockCharsMax;
  if (b.type === "paragraph" || b.type === "doctor" || b.type === "note") return spanChars(b.spans) > max;
  if (b.type === "list") return b.items.reduce((n, item) => n + spanChars(item), 0) > max;
  if (b.type === "table") return [b.caption, ...b.header, ...b.rows.flat()].join("").length > max;
  return false;
}

export type ParseResult = { ok: true; draft: WriteDraft } | { ok: false; issues: string[] };

/** The only way into blog_posts.draft. Unknown fields, block types and link schemes are refused, not dropped. */
export function parseDraft(input: unknown): ParseResult {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "draft"}: ${i.message}`) };
  const d = parsed.data;
  const issues: string[] = [];

  // Links: refused on save, not just hidden when shown.
  const badLink = (href: string | undefined) => href !== undefined && href.trim() !== "" && !safeHref(href);
  d.blocks.forEach((b, i) => {
    const spans = "spans" in b ? b.spans : b.type === "list" ? b.items.flat() : [];
    if (spans.some((s) => badLink(s.href))) issues.push(`blocks.${i}: a link must start with https:// or be a D-Human page`);
  });
  d.sources.forEach((s, i) => {
    if (s.url && s.url.trim() && !safeSourceUrl(s.url)) issues.push(`sources.${i}: a source link must start with https://`);
  });
  const ids = new Set<string>();
  d.blocks.forEach((b, i) => {
    if (ids.has(b.id)) issues.push(`blocks: two blocks share the id ${b.id}`);
    ids.add(b.id);
    if (b.type === "table" && b.rows.some((r) => r.length > b.header.length)) issues.push(`blocks.${i}: a row has more cells than the table has columns`);
  });
  if (d.slug && !SLUG_PATTERN.test(d.slug)) issues.push("slug: lowercase letters, numbers and single hyphens only");

  const blocks = d.blocks.map(normaliseBlock);
  blocks.forEach((b, i) => {
    if (blockTooLong(b)) issues.push(`blocks.${i}: over ${BLOG_LIMITS.blockCharsMax} characters; split it`);
  });
  if (issues.length) return { ok: false, issues };

  const draft: WriteDraft = {
    title: d.title,
    dek: d.dek,
    cover: d.cover ? cleanCover(d.cover) : null,
    blocks,
    sources: d.sources.map((s) => {
      const url = s.url ? safeSourceUrl(s.url) : null;
      return url ? { id: s.id, name: s.name, url } : { id: s.id, name: s.name };
    }),
    seoDescription: d.seoDescription,
    slug: d.slug,
    topic: d.topic,
  };
  if (d.seoTitle) draft.seoTitle = d.seoTitle;
  if (new TextEncoder().encode(JSON.stringify(draft)).length > BLOG_LIMITS.draftBytesMax) {
    return { ok: false, issues: [`draft: over ${Math.round(BLOG_LIMITS.draftBytesMax / 1000)} KB; split it into two posts`] };
  }
  return { ok: true, draft };
}

function cleanCover(c: Cover): Cover {
  return { imageId: c.imageId, alt: c.alt, ...(c.caption ? { caption: c.caption } : {}), ...(c.credit ? { credit: c.credit } : {}) };
}

export const emptyDraft = (slug: string): WriteDraft => ({
  title: "",
  dek: "",
  cover: null,
  blocks: [],
  sources: [],
  seoDescription: "",
  slug,
  topic: null,
});

/** The post itself, without the working address and topic: what goes live, and what "the body changed" compares. */
export function postPart(d: WriteDraft): PostDraft {
  const { slug: _slug, topic: _topic, ...post } = d;
  void _slug;
  void _topic;
  return post;
}

// ── Addresses ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "your", "you", "is", "are", "at", "by", "from", "its", "it"]);

/** A suggested address from a Latin-letter title; "" when the title has none (a Hindi title). */
export function slugify(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 8);
  let slug = "";
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > SLUG_MAX) break;
    slug = next;
  }
  return slug;
}

/** New posts get a placeholder address until the author writes one; it can't go live. */
export const placeholderSlug = (random: string) => `untitled-${random.replace(/[^a-z0-9]/g, "").slice(0, 6).padEnd(6, "0")}`;
export const isPlaceholderSlug = (slug: string) => /^untitled-[a-z0-9]{6}$/.test(slug);

// ── Reading ─────────────────────────────────────────────────────────────────

const spanText = (spans: readonly Span[]) => spans.map((s) => s.text).join("");

/** Every piece of text a block shows, for word counts and the checks. */
export function blockTexts(b: Block): string[] {
  switch (b.type) {
    case "paragraph":
    case "doctor":
      return [spanText(b.spans)];
    case "note":
      return [b.title ?? "", spanText(b.spans)];
    case "list":
      return b.items.map(spanText);
    case "heading":
      return [b.text];
    case "photo":
      return [b.alt, b.caption ?? "", b.credit ?? ""];
    case "quote":
      return [b.text, b.attribution ?? ""];
    case "keyNumber":
      return [b.value, b.label];
    case "tryIt":
      return [b.line];
    case "table":
      return [b.caption, ...b.header, ...b.rows.flat()];
  }
}

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function wordCount(d: PostDraft): number {
  return d.blocks.filter((b) => b.type !== "photo" && b.type !== "tryIt").reduce((n, b) => n + countWords(blockTexts(b).join(" ")), 0);
}

/** Reading time is the reader lane's, so the editor shows what the post page will. */
export { readingMinutes };

// ── Automatic checks (designer §4.2) ────────────────────────────────────────

/** Never on a post: D-Human's content isn't doctor-reviewed. */
const REVIEW_CLAIMS = /doctor[- ]?reviewed|medically[- ]reviewed|reviewed by (?:a |our |qualified )?doctors?|clinically[- ]proven|doctor[- ]approved|doctor[- ]verified/i;

/**
 * Supplement, nutrition and lab brands sold in India. Brands appear only in a person's
 * stack. Names that are also everyday words (Himalaya, Patanjali, Metropolis, Max)
 * are listed only in their brand form, so a trek or a yoga text isn't refused.
 */
export const BRAND_NAMES = [
  // Supplements and sports nutrition
  "HealthKart",
  "MuscleBlaze",
  "Optimum Nutrition",
  "MyProtein",
  "Myprotein",
  "Dymatize",
  "Isopure",
  "Ultimate Nutrition",
  "GNC",
  "Herbalife",
  "Amway",
  "Nutrilite",
  "OZiva",
  "Wellbeing Nutrition",
  "Fast&Up",
  "Fast & Up",
  "Kapiva",
  "TrueBasics",
  "Neuherbs",
  "Nutrabay",
  "Carbamide Forte",
  "Centrum",
  "Revital",
  "Supradyn",
  "Zincovit",
  "Becosules",
  "Neurobion",
  "Shelcal",
  "Calcirol",
  "Uprise-D3",
  "Uprise D3",
  "Limcee",
  "Swisse",
  "Solgar",
  "NOW Foods",
  "Himalaya Wellness",
  "Patanjali Ayurved",
  "Dabur",
  "Baidyanath",
  "Zandu",
  "Abbott",
  "Ensure",
  "Protinex",
  "Horlicks",
  "Bournvita",
  // Labs and pharmacies
  "Lal PathLabs",
  "Lal Path Labs",
  "Thyrocare",
  "Metropolis Healthcare",
  "Metropolis Labs",
  "Agilus",
  "SRL Diagnostics",
  "Redcliffe",
  "Healthians",
  "Tata 1mg",
  "1mg",
  "PharmEasy",
  "Orange Health",
  "Apollo Diagnostics",
  "Apollo 24|7",
  "Apollo Pharmacy",
  "Neuberg",
  "Vijaya Diagnostic",
  "Max Lab",
  "Pathkind",
  "Krsnaa",
  "Netmeds",
] as const;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BRAND_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${BRAND_NAMES.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** Shops and affiliate links: no affiliate links on posts. */
const SHOP_LINK = /(?:^|\.)(?:amazon\.|amzn\.to|flipkart\.com|fkrt\.it|1mg\.com|pharmeasy\.in|netmeds\.com|healthkart\.com|nutrabay\.com)|[?&](?:tag|affid|affiliate|ref)=/i;

const PROMISES = /(?<![\p{L}\p{N}])(?:cures?|cured|treats?|treated|reverses?|reversed|heals?|healed|guarantee[sd]?|ilaaj|theek ho jayega)(?![\p{L}\p{N}])|100\s?%|इलाज|ठीक हो जाएगा/iu;

const CONDITIONS =
  "diabetes|prediabetes|anaemia|anemia|deficien\\w*|thyroid|hypothyroid\\w*|hyperthyroid\\w*|pcos|pcod|fatty liver|high cholesterol|hypertension|high blood pressure|disease|cancer|infection|insulin resistance|osteoporosis";
const DIAGNOSIS = new RegExp(`\\byou(?:'ve| have| may have| might have| probably have| likely have| definitely have)\\s+(?:an?\\s+|got\\s+)?(?:\\w+\\s+){0,2}?(?:${CONDITIONS})\\b`, "i");

/** A health number: g, mg, µg, kcal, %, ng/mL, IU, lakh. */
const HEALTH_NUMBER = /\d[\d,.]*\s?(?:g|gm|grams?|mg|µg|mcg|kcal|cal|calories|%|ng\/ml|nmol\/l|pg\/ml|iu|lakh|crore)(?![\p{L}])/iu;

const ACCURATE = /\baccura(?:te|tely|cy)\b/i;
const FREE_ALONE = /(?<![\p{L}\p{N}-])free(?![\p{L}\p{N}-])(?!\s+to\s+start)/iu;
const PRICE_OR_PLAN = /₹|\brs\.?\s?\d|\binr\s?\d|\bfree reads?\b|\b30[- ]day pass\b|\bthe pass\b|\bpaywall\b/i;

/** What the checks need beyond the draft, from blog_images: each photo's width, and whether the author owns it. */
export type CheckContext = { imageWidths?: Readonly<Record<string, number>>; ownRights?: Readonly<Record<string, boolean>> };

function textsOf(d: WriteDraft): { text: string; blockId?: string }[] {
  const out: { text: string; blockId?: string }[] = [
    { text: d.title },
    { text: d.dek },
    { text: d.seoTitle ?? "" },
    { text: d.seoDescription },
  ];
  if (d.cover) out.push({ text: [d.cover.alt, d.cover.caption ?? "", d.cover.credit ?? ""].join(" ") });
  for (const b of d.blocks) out.push({ text: blockTexts(b).join("\n"), blockId: b.id });
  for (const s of d.sources) out.push({ text: s.name });
  return out.filter((t) => t.text.trim());
}

const linksOf = (b: Block): string[] => {
  const spans = "spans" in b ? b.spans : b.type === "list" ? b.items.flat() : [];
  return spans.flatMap((s) => (s.href ? [s.href] : []));
};

const block = (code: string, message: string, blockId?: string): CheckResult => ({ code, level: "block", message, ...(blockId ? { blockId } : {}) });
const warn = (code: string, message: string, blockId?: string): CheckResult => ({ code, level: "warn", message, ...(blockId ? { blockId } : {}) });

/** Blockers first, then warnings, each at most once per block. */
export function automaticChecks(d: WriteDraft, ctx: CheckContext = {}): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (r: CheckResult) => {
    if (!out.some((o) => o.code === r.code && o.blockId === r.blockId)) out.push(r);
  };

  // Missing pieces.
  if (!d.title.trim()) add(block("missing_title", "Add a title."));
  if (!d.topic) add(block("missing_topic", "Add a topic."));
  if (!d.seoDescription.trim()) add(block("missing_description", "Add a search description."));
  if (!d.slug || isPlaceholderSlug(d.slug) || !SLUG_PATTERN.test(d.slug)) add(block("missing_slug", "Add a web address."));
  else if (!isPostSlug(d.slug)) add(block("reserved_slug", `The blog itself uses that address (${RESERVED_SLUGS.join(", ")}). Pick another.`));
  if (!d.blocks.some((b) => blockTexts(b).some((t) => t.trim()) && b.type !== "photo")) add(block("empty_body", "Write the post before publishing it."));

  // Photos.
  if (d.cover && !d.cover.alt.trim()) add(block("missing_alt", "Describe this photo for someone who can't see it.", "cover"));
  for (const b of d.blocks) if (b.type === "photo" && !b.alt.trim()) add(block("missing_alt", "Describe this photo for someone who can't see it.", b.id));
  const photos: { imageId: string; blockId: string; credit?: string }[] = [
    ...(d.cover ? [{ imageId: d.cover.imageId, blockId: "cover", credit: d.cover.credit }] : []),
    ...d.blocks.flatMap((b) => (b.type === "photo" ? [{ imageId: b.imageId, blockId: b.id, credit: b.credit }] : [])),
  ];
  for (const p of photos) {
    if (ctx.ownRights?.[p.imageId] === false && !p.credit?.trim()) add(block("missing_credit", "Credit the photo's owner: name, licence and source.", p.blockId));
  }
  const widths = ctx.imageWidths;
  if (widths) {
    for (const p of photos) {
      const w = widths[p.imageId];
      if (w === undefined) add(block("missing_photo", "This photo didn't upload. Add it again.", p.blockId));
      else if (w < IMAGE_SOFT_BELOW) add(warn("small_photo", "This photo is small and may look soft on laptops.", p.blockId));
    }
  }

  // Numbers need sources.
  const sourceIds = new Set(d.sources.map((s) => s.id));
  for (const b of d.blocks) {
    if (b.type === "keyNumber" && !sourceIds.has(b.sourceId)) add(block("number_source", "Pick a source for this number.", b.id));
    if (b.type === "table" && /\d/.test([...b.header, ...b.rows.flat()].join(" ")) && !(b.sourceId && sourceIds.has(b.sourceId))) {
      add(block("number_source", "Pick a source for this number.", b.id));
    }
    if (b.type === "tryIt" && b.destination === "guide" && !b.guidePath) add(block("try_it_guide", "Pick the guide this links to.", b.id));
  }

  // Words.
  for (const { text, blockId } of textsOf(d)) {
    if (REVIEW_CLAIMS.test(text)) add(block("doctor_reviewed", "D-Human's content isn't doctor-reviewed. Remove this.", blockId));
    const brand = text.match(BRAND_PATTERN);
    if (brand) add(block("brand", `Brand names only appear in a person's stack. Remove '${brand[0]}'.`, blockId));
  }
  for (const b of d.blocks) {
    if (linksOf(b).some((href) => SHOP_LINK.test(href))) add(block("shop_link", "No shop or affiliate links. Link to a source or a D-Human page instead.", b.id));
  }
  for (const { text, blockId } of textsOf(d)) {
    if (PROMISES.test(text)) add(warn("promise", "Health posts can't promise results. Reword, or tick that it's a quote you're questioning.", blockId));
    if (DIAGNOSIS.test(text)) add(warn("diagnosis", "This reads like a diagnosis. Try 'a low ferritin result can mean…'.", blockId));
    if (ACCURATE.test(text)) add(warn("accurate", "We say 'estimate', not 'accurate'.", blockId));
    if (FREE_ALONE.test(text)) add(warn("free", "We say 'Free to start'; the free start has limits.", blockId));
    if (PRICE_OR_PLAN.test(text)) add(warn("price", "Prices and limits change. Link to the app instead.", blockId));
  }
  if (!d.sources.length) {
    for (const b of d.blocks) {
      if ((b.type === "paragraph" || b.type === "list" || b.type === "note") && HEALTH_NUMBER.test(blockTexts(b).join(" "))) {
        add(warn("unsourced_number", "This number needs a source in Sources.", b.id));
      }
    }
  }

  // Lengths (the title's hard stop is in the schema).
  const searchTitle = d.seoTitle || d.title;
  if (searchTitle.length > BLOG_LIMITS.seoTitleWarnFrom) add(warn("search_title_long", "Search engines will cut this. Write a shorter search title."));
  if (d.seoDescription.length > BLOG_LIMITS.seoDescriptionWarnFrom) add(warn("description_long", "Search engines show about 155 characters. Shorten the description."));
  if (d.title.length > BLOG_LIMITS.titleWarnFrom) add(warn("title_long", "Shorter titles read better on phones and in search."));

  return [...out.filter((r) => r.level === "block"), ...out.filter((r) => r.level === "warn")];
}

export const blockers = (results: readonly CheckResult[]) => results.filter((r) => r.level === "block");

// ── The checklist (designer §4.1) ───────────────────────────────────────────

export const CHECKLIST_COPY: Record<ChecklistItem, { title: string; body: string }> = {
  no_diagnosis: {
    title: "No diagnosis, no cures.",
    body: "The post talks about markers, ranges and risk. It never tells a reader they have a condition, and never says food or a supplement cures, treats, reverses or prevents a disease.",
  },
  numbers_sourced: {
    title: "Every number has a source.",
    body: "Each health number names its source in Sources: ICMR-NIN, a peer-reviewed paper, or a public dataset. Examples are labelled 'illustrative'.",
  },
  no_doctor_reviewed: {
    title: "No 'doctor-reviewed'.",
    body: "Nothing says this post or D-Human's reads are reviewed by a doctor. Reads are called AI.",
  },
  no_brands: { title: "No brand names.", body: "No supplement or lab brands, and no affiliate links." },
  see_a_doctor: {
    title: "When to see a doctor.",
    body: "Anything about symptoms, medicines, pregnancy, kidneys or children points the reader to a doctor. No doses for medicines.",
  },
  app_facts_current: {
    title: "App facts are current.",
    body: "Features match the app today. No prices or plan limits: they change. Link to the app instead.",
  },
  people_and_data: {
    title: "People and data.",
    body: "No real person's report, name or health details, unless it's your own and you're happy to share it. Anyone recognisable in a photo agreed to be in it. AI-made images say so in the caption.",
  },
  fixed_line: {
    title: "The fixed line.",
    body: "I've read the line every post ends with: 'General information, not medical advice.'",
  },
};

/** The boxes not ticked yet; ticks are ISO times. */
export function missingTicks(ticks: Partial<Record<ChecklistItem, string>> | null | undefined): ChecklistItem[] {
  return CHECKLIST_ITEMS.filter((item) => {
    const at = ticks?.[item];
    return !(typeof at === "string" && !Number.isNaN(Date.parse(at)));
  });
}

/** Posts on food, blood tests and supplements need the other founder's "Looks good" (Mayank, 2026-11-18). */
export const needsReview = (topic: BlogTopic | null) => topic !== null && REVIEWED_TOPICS.includes(topic);

/** The source a key number or table cites, numbered as readers see it. */
export const sourceLabel = (sources: readonly Source[], id: string | undefined) => {
  const i = sources.findIndex((s) => s.id === id);
  return i < 0 ? null : `Source ${i + 1}`;
};
