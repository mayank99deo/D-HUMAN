// The blog's shared shapes: what the editor (/write) saves, what goes live, and what
// the reader pages, sitemap and RSS read. Types and constants only, so client code and
// tests can import it. The zod schema that checks these shapes is lib/blog/blocks.ts
// (reader lane); the database columns are blog_* in lib/db/schema.ts.
// Design: docs/team/specs/2026-11-18-blog-and-email-architecture.md §2.

import type { ReactNode } from "react";
import type { GuidePath } from "../seo.ts";

// ── Posts ───────────────────────────────────────────────────────────────────

export const POST_STATUSES = ["draft", "live", "taken_down"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Topic hubs, from the SEO lead's plan (§4.3). Labels, intros and pillar guides live with the reader pages. */
export const BLOG_TOPICS = ["calories", "protein", "blood-tests", "supplements", "training"] as const;
export type BlogTopic = (typeof BLOG_TOPICS)[number];

/** English only at launch (Mayank, 2026-11-18). The column is text, so adding a language needs no migration. */
export const BLOG_LANGUAGES = ["en"] as const;
export type BlogLanguage = (typeof BLOG_LANGUAGES)[number];

/** Lowercase English words and hyphens; 3–6 words is the SEO lead's aim. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;

/** Checked on save (blocking unless marked warn). */
export const BLOG_LIMITS = {
  titleMax: 100,
  titleWarnFrom: 70,
  dekMax: 200,
  seoTitleWarnFrom: 60,
  seoDescriptionWarnFrom: 155,
  blocksMax: 300,
  blockCharsMax: 5_000,
  sourcesMax: 30,
  draftBytesMax: 200_000,
  tryItLineMax: 90,
  tableColsMax: 4,
  tableRowsMax: 12,
  bioMax: 200,
  authorLinksMax: 2,
} as const;

// ── Body ────────────────────────────────────────────────────────────────────
// Structured blocks, never HTML. Links are https/http URLs or a path in
// INTERNAL_LINK_PREFIXES; anything else is refused on save.

export const INTERNAL_LINK_PREFIXES = ["/blog/", "/team/", "/calorie-tracker", "/protein-tracker", "/blood-report-analysis", "/supplements-from-blood-test", "/sources-and-safety", "/signin"] as const;

export type Span = { text: string; bold?: true; italic?: true; href?: string };

export type Source = { id: string; name: string; url?: string };

/** Try it: a destination from this list, never a URL. App screens go through /signin?next=… */
export const TRY_IT_DESTINATIONS = ["fuel", "upload", "stack", "wraps", "start", "guide"] as const;
export type TryItDestination = (typeof TRY_IT_DESTINATIONS)[number];

type BlockBase = { id: string }; // stable, for anchors and editor moves

export type Block = BlockBase &
  (
    | { type: "paragraph"; spans: Span[] }
    | { type: "heading"; level: 2 | 3; text: string }
    | { type: "list"; ordered: boolean; items: Span[][] }
    | { type: "photo"; imageId: string; alt: string; caption?: string; credit?: string; wide?: boolean }
    | { type: "quote"; text: string; attribution?: string }
    | { type: "note"; title?: string; spans: Span[] }
    /** Fixed title "Worth showing a doctor"; says when, never what the reader has. */
    | { type: "doctor"; spans: Span[] }
    | { type: "keyNumber"; value: string; label: string; sourceId: string }
    | { type: "tryIt"; destination: TryItDestination; guidePath?: GuidePath; line: string }
    | { type: "table"; caption: string; header: string[]; rows: string[][]; sourceId?: string }
  );
export type BlockType = Block["type"];

export type Cover = { imageId: string; alt: string; caption?: string; credit?: string };

/** What /write saves in blog_posts.draft. */
export type PostDraft = {
  title: string;
  dek: string;
  cover: Cover | null; // null: the drawn contour cover
  blocks: Block[];
  sources: Source[];
  seoTitle?: string; // defaults to the title
  seoDescription: string;
};

// ── Photos ──────────────────────────────────────────────────────────────────

/** Widths the author's browser makes. Crops (focal point) and black and white are CSS. */
export const IMAGE_WIDTHS = [480, 960, 1600] as const;
export const IMAGE_MIMES = ["image/webp", "image/jpeg"] as const;
export const IMAGE_FILE_MAX_BYTES = 1_500_000;
/** Below this width the editor warns the photo may look soft on laptops. */
export const IMAGE_SOFT_BELOW = 1200;

/** A file name carries a content hash ("w960-3fa9c1.webp"), so its URL can be cached for a year. */
export type ImageFile = { name: string; width: number; mime: (typeof IMAGE_MIMES)[number] };

export type LiveImage = {
  id: string;
  width: number;
  height: number;
  focalX: number; // 0–1
  focalY: number;
  keepColour: boolean;
  files: ImageFile[];
};

export const imagePath = (imageId: string, fileName: string) => `/blog/img/${imageId}/${fileName}`;

/**
 * Share images: drawn by the author's browser at Publish (next/og garbles Devanagari) and
 * uploaded as one blog image whose files are JPEGs at these sizes, e.g. "og-3fa9c1.jpg".
 * "og" is the link preview; the other three feed Article markup, which wants 16:9, 4:3 and 1:1.
 */
export const SHARE_IMAGE_SIZES = {
  og: { width: 1200, height: 630 },
  "16x9": { width: 1200, height: 675 },
  "4x3": { width: 1200, height: 900 },
  "1x1": { width: 1200, height: 1200 },
} as const;
export type ShareImageKind = keyof typeof SHARE_IMAGE_SIZES;
export type ShareImages = { imageId: string; files: { og: string } & Partial<Record<Exclude<ShareImageKind, "og">, string>> };

// ── What readers see ────────────────────────────────────────────────────────

export type AuthorLink = { label: "LinkedIn" | "X" | "GitHub" | "Website"; url: string };

export type PublicAuthor = {
  id: string;
  slug: string; // /team/<slug>
  name: string;
  role: string;
  bio: string;
  photo: LiveImage | null; // null: monogram
  links: AuthorLink[];
};

/** What publishing writes to blog_posts.live: the draft plus everything a page needs, so it renders from one read. */
export type PostLive = PostDraft & {
  topic: BlogTopic | null;
  language: BlogLanguage;
  readingMinutes: number;
  author: PublicAuthor;
  images: Record<string, LiveImage>; // every imageId used by the cover and blocks
  share?: ShareImages | null; // missing: pages fall back to the site's share image
};

/** One row in a list (index, topic hub, author page, related posts, sitemap, RSS). */
export type PostSummary = {
  id: string;
  slug: string;
  title: string;
  dek: string;
  seoDescription: string;
  topic: BlogTopic | null;
  language: BlogLanguage;
  cover: (LiveImage & { alt: string }) | null;
  author: PublicAuthor;
  publishedAt: string; // ISO
  updatedOn: string | null; // the last meaningful update, ISO
  readingMinutes: number;
  featured: boolean;
  share: ShareImages | null;
};

export type LivePost = PostSummary & PostLive;

export type PostLookup = { kind: "live"; post: LivePost } | { kind: "moved"; slug: string } | { kind: "missing" };

/** lib/blog/registry.ts (reader lane). Every list on the site reads through this, so nothing drifts. */
export interface BlogRegistry {
  livePosts(options?: { topic?: BlogTopic; authorId?: string; page?: number; perPage?: number }): Promise<PostSummary[]>;
  livePost(slug: string): Promise<PostLookup>;
  authors(): Promise<PublicAuthor[]>;
}

/** Renders validated blocks with our own components (reader lane); /write's preview uses the same function. */
export type RenderBlocks = (blocks: readonly Block[], images: Readonly<Record<string, LiveImage>>, sources: readonly Source[]) => ReactNode;

/** Cache tags: readers tag with these; publish, update and take-down revalidate them with { expire: 0 }. */
export const BLOG_TAGS = {
  list: "blog",
  authors: "blog:authors",
  post: (postId: string) => `blog:post:${postId}`,
} as const;

// ── Publishing ──────────────────────────────────────────────────────────────

export const PUBLISH_ACTIONS = ["publish", "update", "take_down", "restore"] as const;
export type PublishAction = (typeof PUBLISH_ACTIONS)[number];

/** The 8 boxes on "Before this goes live" (product designer §4.1). */
export const CHECKLIST_ITEMS = [
  "no_diagnosis",
  "numbers_sourced",
  "no_doctor_reviewed",
  "no_brands",
  "see_a_doctor",
  "app_facts_current",
  "people_and_data",
  "fixed_line",
] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];
/** When each box was ticked (ISO), stored in blog_publishes.checklist. */
export type ChecklistTicks = Record<ChecklistItem, string>;

/** One automatic check's finding (product designer §4.2), stored in blog_publishes.checks. */
export type CheckResult = { code: string; level: "block" | "warn"; message: string; blockId?: string };

export const REVIEW_STATUSES = ["requested", "looks_good", "needs_changes"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Topics whose posts need the other founder's "Looks good" (product designer decision 3, if Mayank keeps it on). */
export const REVIEWED_TOPICS: readonly BlogTopic[] = ["calories", "protein", "blood-tests", "supplements"];

/** Publish, take-down and author changes need a sign-in this recent (a stolen old cookie can't deface the site). */
export const FRESH_SESSION_DAYS = 7;
/** "{Name} is editing this post" while their heartbeat is this recent. */
export const SOFT_LOCK_MINUTES = 3;
