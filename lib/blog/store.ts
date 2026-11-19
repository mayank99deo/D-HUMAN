import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Resend } from "resend";
import { z } from "zod";
import type { Author } from "@/lib/auth/author";
import { isOwnerEmail } from "@/lib/auth/author";
import { newId } from "@/lib/auth/crypto";
import { db, schema, type Db } from "@/lib/db";
import { absoluteUrl } from "@/lib/site-url";
import {
  automaticChecks,
  blockers,
  emptyDraft,
  missingTicks,
  needsReview,
  parseDraft,
  placeholderSlug,
  postPart,
  readingMinutes,
  safeHref,
  type WriteDraft,
} from "./checks";
import { PostLiveSchema } from "./blocks";
import { editorImages, shareImagesOf, toLiveImage, type EditorImage } from "./image-store";
import { revalidateBlog, revalidateBlogAuthors } from "./registry";
import {
  BLOG_LIMITS,
  BLOG_TOPICS,
  SLUG_PATTERN,
  SOFT_LOCK_MINUTES,
  type AuthorLink,
  type BlogTopic,
  type ChecklistItem,
  type CheckResult,
  type LiveImage,
  type LivePost,
  type PostDraft,
  type PostLive,
  type PostStatus,
  type PublicAuthor,
  type ReviewStatus,
} from "./types";

// Posts as /write sees them: drafts, versions, publishing and review. Readers never
// come through here; they read `live` through lib/blog/registry.ts (reader lane).
//
// The rules this file keeps (architecture §2.6):
// - A save names the version it started from; if someone saved in between, it's a
//   conflict (409), never a silent overwrite.
// - Publishing runs in one transaction: re-check the draft, the automatic checks, the
//   checklist, the other founder's "Looks good" for health topics, a free address;
//   then copy draft → live with everything the page needs. Nothing half-publishes.
// - A published address is kept forever in blog_slugs: renaming redirects, deleting
//   retires it, and it is never reused.

/** What publishing writes to `live`: the shared PostLive, its `share` image drawn in the browser at Publish. */
export type StoredLive = PostLive;

export type ReviewView = {
  id: string;
  status: ReviewStatus;
  draftVersion: number;
  requestedBy: { id: string; name: string };
  reviewer: { id: string; name: string };
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type PostListRow = {
  id: string;
  title: string;
  status: PostStatus;
  topic: BlogTopic | null;
  slug: string;
  featured: boolean;
  editedAt: string;
  editedBy: string | null;
  changesNotLive: boolean;
  review: ReviewStatus | null;
};

export type EditorPost = {
  id: string;
  status: PostStatus;
  draft: WriteDraft;
  draftVersion: number;
  liveVersion: number | null;
  liveSlug: string;
  featured: boolean;
  publishedAt: string | null;
  updatedOn: string | null;
  editedAt: string;
  editedBy: string | null;
  /** Whose byline the post carries. */
  author: { id: string; name: string };
  /** Someone else's editor is open on this post. */
  lock: { name: string; at: string } | null;
  review: ReviewView | null;
  images: Record<string, EditorImage>;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Expire the pages that show this post and every list (the reader lane's helper), so the change is live on the next visit. */
const revalidatePost = (postId: string) => revalidateBlog(postId);

/** A stored draft, read back through the same gate as a save. Older or partial shapes fill in from the columns. */
function parseStored(row: { draft: unknown; slug: string; topic: string | null }) {
  const topic = (BLOG_TOPICS as readonly string[]).includes(row.topic ?? "") ? (row.topic as BlogTopic) : null;
  const base = { ...emptyDraft(row.slug), topic };
  const stored = row.draft && typeof row.draft === "object" ? (row.draft as Record<string, unknown>) : {};
  return { base, parsed: parseDraft({ ...base, ...stored }) };
}

function readDraft(row: { draft: unknown; slug: string; topic: string | null }): WriteDraft {
  const { base, parsed } = parseStored(row);
  if (parsed.ok) return parsed.draft;
  console.error("[blog] stored draft didn't parse", parsed.issues.slice(0, 3));
  return base;
}

/** The draft a live copy was made from: its post fields, with the live address and topic. */
function draftFromLive(live: StoredLive, slug: string, topic: string | null): WriteDraft {
  const { title, dek, cover, blocks, sources, seoTitle, seoDescription } = live;
  return readDraft({ draft: { title, dek, cover, blocks, sources, seoDescription, ...(seoTitle ? { seoTitle } : {}) }, slug, topic });
}

/** Image ids a draft uses: cover and photo blocks. */
export function imageIdsOf(d: PostDraft): string[] {
  return [...(d.cover ? [d.cover.imageId] : []), ...d.blocks.flatMap((b) => (b.type === "photo" ? [b.imageId] : []))];
}

/** The post's own fields in a fixed key order, so "did the body change" compares like with like. */
function canonicalPost(d: PostDraft): string {
  return JSON.stringify({
    title: d.title,
    dek: d.dek,
    cover: d.cover,
    blocks: d.blocks,
    sources: d.sources,
    seoTitle: d.seoTitle ?? null,
    seoDescription: d.seoDescription,
  });
}

/** Is this address free for this post? Taken by another post, or retired, means no. */
async function slugFree(tx: Db, slug: string, postId: string): Promise<boolean> {
  const [post] = await tx
    .select({ id: schema.blogPosts.id })
    .from(schema.blogPosts)
    .where(and(eq(schema.blogPosts.slug, slug), ne(schema.blogPosts.id, postId)))
    .limit(1);
  if (post) return false;
  const [kept] = await tx.select({ postId: schema.blogSlugs.postId }).from(schema.blogSlugs).where(eq(schema.blogSlugs.slug, slug)).limit(1);
  return !kept || kept.postId === postId;
}

/** "roti-calories-2", or the next number that's free. */
async function suggestSlug(tx: Db, slug: string, postId: string): Promise<string | null> {
  const stem = slug.replace(/-\d+$/, "");
  for (let n = 2; n <= 20; n++) {
    const candidate = `${stem}-${n}`.slice(0, 80);
    if (SLUG_PATTERN.test(candidate) && (await slugFree(tx, candidate, postId))) return candidate;
  }
  return null;
}

async function authorNames(tx: Db, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return new Map();
  const rows = await tx.select({ id: schema.blogAuthors.id, name: schema.blogAuthors.name }).from(schema.blogAuthors).where(inArray(schema.blogAuthors.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── Reading, for the editor ─────────────────────────────────────────────────

export async function listPosts(): Promise<PostListRow[]> {
  const d = await db();
  const posts = await d
    .select({
      id: schema.blogPosts.id,
      title: sql<string | null>`${schema.blogPosts.draft}->>'title'`,
      status: schema.blogPosts.status,
      topic: schema.blogPosts.topic,
      slug: schema.blogPosts.slug,
      featured: schema.blogPosts.featured,
      editedAt: schema.blogPosts.draftUpdatedAt,
      editedBy: schema.blogPosts.draftUpdatedBy,
      draftVersion: schema.blogPosts.draftVersion,
      liveVersion: schema.blogPosts.liveVersion,
    })
    .from(schema.blogPosts)
    .orderBy(desc(schema.blogPosts.draftUpdatedAt));
  if (!posts.length) return [];
  const [names, reviews] = await Promise.all([
    authorNames(d, posts.map((p) => p.editedBy)),
    d
      .select({ postId: schema.blogReviews.postId, status: schema.blogReviews.status, draftVersion: schema.blogReviews.draftVersion })
      .from(schema.blogReviews)
      .where(inArray(schema.blogReviews.postId, posts.map((p) => p.id)))
      .orderBy(desc(schema.blogReviews.createdAt)),
  ]);
  return posts.map((p) => {
    const review = reviews.find((r) => r.postId === p.id && r.draftVersion === p.draftVersion);
    return {
      id: p.id,
      title: p.title?.trim() || "Untitled",
      status: p.status as PostStatus,
      topic: (p.topic as BlogTopic | null) ?? null,
      slug: p.slug,
      featured: p.featured,
      editedAt: p.editedAt.toISOString(),
      editedBy: p.editedBy ? (names.get(p.editedBy) ?? null) : null,
      changesNotLive: p.status !== "draft" && p.liveVersion !== p.draftVersion,
      review: (review?.status as ReviewStatus | undefined) ?? null,
    };
  });
}

async function latestReview(tx: Db, postId: string): Promise<ReviewView | null> {
  const [r] = await tx.select().from(schema.blogReviews).where(eq(schema.blogReviews.postId, postId)).orderBy(desc(schema.blogReviews.createdAt)).limit(1);
  if (!r) return null;
  const names = await authorNames(tx, [r.requestedBy, r.reviewerId]);
  return {
    id: r.id,
    status: r.status as ReviewStatus,
    draftVersion: r.draftVersion,
    requestedBy: { id: r.requestedBy, name: names.get(r.requestedBy) ?? "A writer" },
    reviewer: { id: r.reviewerId, name: names.get(r.reviewerId) ?? "A writer" },
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    decidedAt: iso(r.decidedAt),
  };
}

export async function getEditorPost(me: Author, postId: string, now = new Date()): Promise<EditorPost | null> {
  const d = await db();
  const [row] = await d.select().from(schema.blogPosts).where(eq(schema.blogPosts.id, postId)).limit(1);
  if (!row) return null;
  const draft = readDraft(row);
  const [names, review, images] = await Promise.all([authorNames(d, [row.draftUpdatedBy, row.editingBy, row.authorId]), latestReview(d, row.id), editorImages(imageIdsOf(draft))]);
  const lockFresh = row.editingAt && now.getTime() - row.editingAt.getTime() < SOFT_LOCK_MINUTES * 60_000;
  return {
    id: row.id,
    status: row.status as PostStatus,
    draft,
    draftVersion: row.draftVersion,
    liveVersion: row.liveVersion,
    liveSlug: row.slug,
    featured: row.featured,
    publishedAt: iso(row.publishedAt),
    updatedOn: iso(row.updatedOn),
    editedAt: row.draftUpdatedAt.toISOString(),
    editedBy: row.draftUpdatedBy ? (names.get(row.draftUpdatedBy) ?? null) : null,
    author: { id: row.authorId, name: names.get(row.authorId) ?? "" },
    lock: row.editingBy && row.editingBy !== me.id && lockFresh ? { name: names.get(row.editingBy) ?? "Another writer", at: row.editingAt!.toISOString() } : null,
    review,
    images,
  };
}

/**
 * The draft as the post page would show it, for /write's preview through the reader's own
 * PostArticle: the author as they are now, today's date until it's published, and only the
 * photos that are uploaded. No share image (previews aren't shared).
 */
export async function previewPost(post: EditorPost, now = new Date()): Promise<LivePost> {
  const d = await db();
  const draft = post.draft;
  const images: Record<string, LiveImage> = {};
  for (const id of imageIdsOf(draft)) if (post.images[id]) images[id] = toLiveImage(post.images[id]);
  const coverImage = draft.cover ? images[draft.cover.imageId] : undefined;
  return {
    ...postPart(draft),
    id: post.id,
    slug: draft.slug || post.liveSlug,
    topic: draft.topic,
    language: "en",
    cover: draft.cover && coverImage ? { ...coverImage, ...draft.cover } : null,
    author: await publicAuthor(d, post.author.id),
    publishedAt: post.publishedAt ?? now.toISOString(),
    updatedOn: post.updatedOn,
    readingMinutes: readingMinutes(draft),
    featured: post.featured,
    share: null,
    images,
  };
}

// ── Writing drafts ──────────────────────────────────────────────────────────

export type CreateResult = { ok: true; id: string } | { ok: false; error: "invalid"; issues: string[] };

/** A new draft, empty or from an import. Its address is the import's if free, else a placeholder. */
export async function createPost(me: Author, input?: unknown): Promise<CreateResult> {
  const id = newId();
  const placeholder = placeholderSlug(id.replace(/-/g, ""));
  let draft = emptyDraft(placeholder);
  if (input !== undefined) {
    const parsed = parseDraft({ ...emptyDraft(placeholder), ...(input as object) });
    if (!parsed.ok) return { ok: false, error: "invalid", issues: parsed.issues };
    draft = parsed.draft;
  }
  const d = await db();
  await d.transaction(async (tx) => {
    if (!draft.slug || !(await slugFree(tx, draft.slug, id))) draft = { ...draft, slug: placeholder };
    await tx.insert(schema.blogPosts).values({
      id,
      slug: draft.slug,
      topic: draft.topic,
      authorId: me.id,
      draft,
      draftUpdatedBy: me.id,
      editingBy: me.id,
      editingAt: new Date(),
    });
  });
  return { ok: true, id };
}

export type SaveResult =
  | { ok: true; version: number; savedAt: string }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "invalid"; issues: string[] }
  | { ok: false; error: "conflict"; version: number; by: string | null; at: string }
  | { ok: false; error: "slug_taken"; suggestion: string | null };

/** Autosave. Only from the version the editor loaded; the address must be free. */
export async function saveDraft(me: Author, postId: string, baseVersion: number, input: unknown): Promise<SaveResult> {
  const parsed = parseDraft(input);
  if (!parsed.ok) return { ok: false, error: "invalid", issues: parsed.issues };
  const draft = parsed.draft;
  const d = await db();
  return d.transaction(async (tx): Promise<SaveResult> => {
    const [row] = await tx
      .select({ status: schema.blogPosts.status, slug: schema.blogPosts.slug, draftVersion: schema.blogPosts.draftVersion, by: schema.blogPosts.draftUpdatedBy, at: schema.blogPosts.draftUpdatedAt })
      .from(schema.blogPosts)
      .where(eq(schema.blogPosts.id, postId))
      .for("update");
    if (!row) return { ok: false, error: "not_found" };
    if (row.draftVersion !== baseVersion) {
      const names = await authorNames(tx, [row.by]);
      return { ok: false, error: "conflict", version: row.draftVersion, by: row.by ? (names.get(row.by) ?? null) : null, at: row.at.toISOString() };
    }
    // An empty address is allowed while drafting (Publish asks for one); the column keeps its old value.
    if (draft.slug && draft.slug !== row.slug && !(await slugFree(tx, draft.slug, postId))) {
      return { ok: false, error: "slug_taken", suggestion: await suggestSlug(tx, draft.slug, postId) };
    }
    const now = new Date();
    const version = row.draftVersion + 1;
    // Before the first publish the columns follow the draft; after it they hold what's live.
    const mirror = row.status === "draft" ? { slug: draft.slug || row.slug, topic: draft.topic } : {};
    await tx
      .update(schema.blogPosts)
      .set({ ...mirror, draft, draftVersion: version, draftUpdatedBy: me.id, draftUpdatedAt: now, editingBy: me.id, editingAt: now })
      .where(eq(schema.blogPosts.id, postId));
    return { ok: true, version, savedAt: now.toISOString() };
  });
}

/** The editor's heartbeat: "{Name} is editing this post" for others while it's recent. */
export async function heartbeat(me: Author, postId: string): Promise<boolean> {
  const d = await db();
  const rows = await d.update(schema.blogPosts).set({ editingBy: me.id, editingAt: new Date() }).where(eq(schema.blogPosts.id, postId)).returning({ id: schema.blogPosts.id });
  return rows.length > 0;
}

// ── Publishing ──────────────────────────────────────────────────────────────

export type PublishInput = {
  draftVersion: number;
  checklist: Partial<Record<ChecklistItem, string>>;
  meaningful: boolean;
  featured: boolean;
  shareImageId: string | null;
};

export type PublishResult =
  | { ok: true; slug: string; action: "publish" | "update"; checks: CheckResult[] }
  | { ok: false; error: "not_found" | "sign_in_again" | "review_needed" | "taken_down" }
  | { ok: false; error: "invalid"; issues?: string[] }
  | { ok: false; error: "checklist"; missing: ChecklistItem[] }
  | { ok: false; error: "conflict"; version: number }
  | { ok: false; error: "checks"; checks: CheckResult[] }
  | { ok: false; error: "slug_taken"; suggestion: string | null };

async function publicAuthor(tx: Db, authorId: string): Promise<PublicAuthor> {
  const [a] = await tx.select().from(schema.blogAuthors).where(eq(schema.blogAuthors.id, authorId)).limit(1);
  const photos = a?.photoImageId ? await editorImages([a.photoImageId], tx) : {};
  const photo = a?.photoImageId ? photos[a.photoImageId] : undefined;
  return {
    id: authorId,
    slug: a?.slug ?? "",
    name: a?.name ?? "",
    role: a?.role ?? "",
    bio: a?.bio ?? "",
    photo: photo ? toLiveImage(photo) : null,
    links: parseLinks(a?.links),
  };
}

/** Did a different writer say "Looks good" to exactly this version? */
async function hasLooksGood(tx: Db, postId: string, draftVersion: number): Promise<boolean> {
  const rows = await tx
    .select({ requestedBy: schema.blogReviews.requestedBy, reviewerId: schema.blogReviews.reviewerId })
    .from(schema.blogReviews)
    .where(and(eq(schema.blogReviews.postId, postId), eq(schema.blogReviews.draftVersion, draftVersion), eq(schema.blogReviews.status, "looks_good")));
  return rows.some((r) => r.reviewerId !== r.requestedBy);
}

/** Publish a draft for the first time, or update a live post with its draft. */
export async function publishPost(me: Author, postId: string, input: PublishInput): Promise<PublishResult> {
  if (!me.freshSession) return { ok: false, error: "sign_in_again" };
  const d = await db();
  const result = await d.transaction(async (tx): Promise<PublishResult> => {
    const [row] = await tx.select().from(schema.blogPosts).where(eq(schema.blogPosts.id, postId)).for("update");
    if (!row) return { ok: false, error: "not_found" };
    if (row.status === "taken_down") return { ok: false, error: "taken_down" };
    if (row.draftVersion !== input.draftVersion) return { ok: false, error: "conflict", version: row.draftVersion };
    const { parsed } = parseStored(row);
    if (!parsed.ok) return { ok: false, error: "invalid" };
    const draft = parsed.draft;

    const imageIds = imageIdsOf(draft);
    const images = await editorImages([...imageIds, ...(input.shareImageId ? [input.shareImageId] : [])], tx);
    const widths = Object.fromEntries(Object.values(images).map((i) => [i.id, i.width]));
    const ownRights = Object.fromEntries(Object.values(images).map((i) => [i.id, i.ownRights]));
    const checks = automaticChecks(draft, { imageWidths: widths, ownRights });
    if (blockers(checks).length) return { ok: false, error: "checks", checks };

    const wasLive = row.status === "live" && row.live !== null;
    const live = wasLive ? (row.live as StoredLive) : null;
    const bodyChanged = !live || canonicalPost(live) !== canonicalPost(draft);
    if (bodyChanged) {
      const missing = missingTicks(input.checklist);
      if (missing.length) return { ok: false, error: "checklist", missing };
    }
    const reviewed = needsReview(draft.topic);
    if (reviewed && (bodyChanged || !needsReview(live?.topic ?? null)) && !(await hasLooksGood(tx, postId, row.draftVersion))) {
      return { ok: false, error: "review_needed" };
    }
    if (!(await slugFree(tx, draft.slug, postId))) return { ok: false, error: "slug_taken", suggestion: await suggestSlug(tx, draft.slug, postId) };

    // The share image drawn for this version, or none (the reader pages fall back to the
    // site's): never one drawn for an older title.
    const shareImage = input.shareImageId ? images[input.shareImageId] : undefined;
    const liveImages: Record<string, LiveImage> = {};
    for (const id of imageIds) liveImages[id] = toLiveImage(images[id]);

    const candidate: StoredLive = {
      ...postPart(draft),
      topic: draft.topic,
      language: "en",
      readingMinutes: readingMinutes(draft),
      author: await publicAuthor(tx, row.authorId),
      images: liveImages,
      share: shareImage ? shareImagesOf(shareImage) : null,
    };
    // The reader's own gate, last: a copy the post page would refuse never goes live.
    const checked = PostLiveSchema.safeParse(candidate);
    if (!checked.success) return { ok: false, error: "invalid", issues: checked.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) };
    const next = candidate;
    const now = new Date();
    if (input.featured && !row.featured) {
      await tx.update(schema.blogPosts).set({ featured: false }).where(and(eq(schema.blogPosts.featured, true), ne(schema.blogPosts.id, postId)));
    }
    await tx
      .update(schema.blogPosts)
      .set({
        status: "live",
        slug: draft.slug,
        topic: draft.topic,
        featured: input.featured,
        live: next,
        liveVersion: row.draftVersion,
        publishedAt: row.publishedAt ?? now,
        updatedOn: wasLive && input.meaningful ? now : row.updatedOn,
        liveChangedAt: now,
      })
      .where(eq(schema.blogPosts.id, postId));
    await tx.insert(schema.blogSlugs).values({ slug: draft.slug, postId }).onConflictDoNothing();
    const ticks = bodyChanged ? input.checklist : null;
    await tx.insert(schema.blogPublishes).values({
      id: newId(),
      postId,
      action: wasLive ? "update" : "publish",
      draftVersion: row.draftVersion,
      byAuthor: me.id,
      checklist: ticks,
      checks,
      meaningful: wasLive && input.meaningful,
      snapshot: next,
    });
    return { ok: true, slug: draft.slug, action: wasLive ? "update" : "publish", checks };
  });
  if (result.ok) revalidatePost(postId);
  return result;
}

export type StatusAction = "take_down" | "restore" | "discard";
export type StatusResult = { ok: true; version?: number } | { ok: false; error: "not_found" | "sign_in_again" | "wrong_state" };

/**
 * Take down (the address answers 404 until restored), restore (the same live copy
 * comes back), or discard (the draft goes back to what's live).
 */
export async function changeStatus(me: Author, postId: string, action: StatusAction): Promise<StatusResult> {
  if (action !== "discard" && !me.freshSession) return { ok: false, error: "sign_in_again" };
  const d = await db();
  const result = await d.transaction(async (tx): Promise<StatusResult> => {
    const [row] = await tx.select().from(schema.blogPosts).where(eq(schema.blogPosts.id, postId)).for("update");
    if (!row) return { ok: false, error: "not_found" };
    const now = new Date();
    if (action === "discard") {
      if (!row.live) return { ok: false, error: "wrong_state" };
      const draft = draftFromLive(row.live as StoredLive, row.slug, row.topic);
      const version = row.draftVersion + 1;
      await tx.update(schema.blogPosts).set({ draft, draftVersion: version, draftUpdatedBy: me.id, draftUpdatedAt: now }).where(eq(schema.blogPosts.id, postId));
      return { ok: true, version };
    }
    const from = action === "take_down" ? "live" : "taken_down";
    if (row.status !== from || !row.live) return { ok: false, error: "wrong_state" };
    await tx
      .update(schema.blogPosts)
      .set({ status: action === "take_down" ? "taken_down" : "live", liveChangedAt: now, ...(action === "take_down" ? { featured: false } : {}) })
      .where(eq(schema.blogPosts.id, postId));
    await tx.insert(schema.blogPublishes).values({ id: newId(), postId, action, draftVersion: row.draftVersion, byAuthor: me.id });
    return { ok: true };
  });
  if (result.ok && action !== "discard") revalidatePost(postId);
  return result;
}

export type DeleteResult = { ok: true } | { ok: false; error: "not_found" | "sign_in_again" | "wrong_state" };

/**
 * Deletes a draft that never went live, or a taken-down post. A deleted post's
 * addresses stay in blog_slugs with no post, so they answer "gone" and are never reused.
 */
export async function deletePost(me: Author, postId: string): Promise<DeleteResult> {
  if (!me.freshSession) return { ok: false, error: "sign_in_again" };
  const d = await db();
  const result = await d.transaction(async (tx): Promise<DeleteResult> => {
    const [row] = await tx.select({ status: schema.blogPosts.status }).from(schema.blogPosts).where(eq(schema.blogPosts.id, postId)).for("update");
    if (!row) return { ok: false, error: "not_found" };
    if (row.status === "live") return { ok: false, error: "wrong_state" };
    await tx.delete(schema.blogPosts).where(eq(schema.blogPosts.id, postId));
    return { ok: true };
  });
  if (result.ok) revalidatePost(postId);
  return result;
}

// ── "Ready for a read" ──────────────────────────────────────────────────────

export type ReviewRequestResult =
  | { ok: true; review: ReviewView; reviewerEmail: string; title: string }
  | { ok: false; error: "not_found" | "no_reviewer" };

/** Ask another writer to read the current version. */
export async function requestReview(me: Author, postId: string, reviewerId: string): Promise<ReviewRequestResult> {
  const d = await db();
  const [[post], [reviewer]] = await Promise.all([
    d.select({ draft: schema.blogPosts.draft, draftVersion: schema.blogPosts.draftVersion }).from(schema.blogPosts).where(eq(schema.blogPosts.id, postId)).limit(1),
    d.select().from(schema.blogAuthors).where(eq(schema.blogAuthors.id, reviewerId)).limit(1),
  ]);
  if (!post) return { ok: false, error: "not_found" };
  if (!reviewer || reviewer.id === me.id || !reviewer.active || !isOwnerEmail(reviewer.email)) return { ok: false, error: "no_reviewer" };
  const id = newId();
  await d.insert(schema.blogReviews).values({ id, postId, draftVersion: post.draftVersion, requestedBy: me.id, reviewerId });
  const review = await latestReview(d, postId);
  const title = (post.draft as { title?: string })?.title?.trim() || "Untitled";
  return { ok: true, review: review!, reviewerEmail: reviewer.email, title };
}

export type DecideResult = { ok: true; review: ReviewView } | { ok: false; error: "not_found" | "not_reviewer" | "changed" };

/** The reviewer's answer, for the version they read. If the post changed since, they read it again. */
export async function decideReview(me: Author, reviewId: string, input: { status: "looks_good" | "needs_changes"; note: string | null; draftVersion: number }): Promise<DecideResult> {
  const d = await db();
  return d.transaction(async (tx): Promise<DecideResult> => {
    const [review] = await tx.select().from(schema.blogReviews).where(eq(schema.blogReviews.id, reviewId)).for("update");
    if (!review) return { ok: false, error: "not_found" };
    if (review.reviewerId !== me.id) return { ok: false, error: "not_reviewer" };
    const [post] = await tx.select({ draftVersion: schema.blogPosts.draftVersion }).from(schema.blogPosts).where(eq(schema.blogPosts.id, review.postId)).for("update");
    if (!post) return { ok: false, error: "not_found" };
    if (post.draftVersion !== input.draftVersion) return { ok: false, error: "changed" };
    await tx
      .update(schema.blogReviews)
      .set({ status: input.status, note: input.note, draftVersion: input.draftVersion, decidedAt: new Date() })
      .where(eq(schema.blogReviews.id, reviewId));
    return { ok: true, review: (await latestReview(tx, review.postId))! };
  });
}

/** A plain transactional email to the reviewer (not a lifecycle email). Locally without a key, a log line. */
export async function sendReviewEmail(input: { to: string; reviewerName: string; requesterName: string; title: string; postId: string }): Promise<void> {
  const link = absoluteUrl(`/write/${input.postId}/preview`);
  const subject = `${input.requesterName} asked you to read "${input.title}"`;
  const text = `${input.requesterName} would like your read of "${input.title}" before it goes live.\n\nOpen the preview: ${link}\n\nChoose Looks good or Needs changes at the top of the preview.`;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[blog] Review request for ${input.to}: ${link}`);
    return;
  }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:32px 16px;background:#fff;font:16px/24px Archivo,Helvetica,Arial,sans-serif;color:#000">
<p style="margin:0 0 16px">${esc(input.requesterName)} would like your read of <strong>${esc(input.title)}</strong> before it goes live.</p>
<p style="margin:0 0 16px"><a href="${esc(link)}" style="color:#000">Open the preview</a></p>
<p style="margin:0;color:#5c5c5c">Choose Looks good or Needs changes at the top of the preview.</p></body></html>`;
  const { error } = await new Resend(key).emails.send({ from: process.env.RESEND_FROM || "D-Human <hello@dhuman.fit>", to: input.to, subject, html, text });
  if (error) console.error("[blog] Review email failed:", error.name, error.message);
}

// ── Author profiles ─────────────────────────────────────────────────────────

const LINK_LABELS = ["LinkedIn", "X", "GitHub", "Website"] as const;

function parseLinks(raw: unknown): AuthorLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is AuthorLink => !!l && typeof l === "object" && LINK_LABELS.includes((l as AuthorLink).label) && typeof (l as AuthorLink).url === "string")
    .slice(0, BLOG_LIMITS.authorLinksMax);
}

export type AuthorProfile = { id: string; slug: string; name: string; role: string; bio: string; links: AuthorLink[]; photo: EditorImage | null };

export async function getAuthorProfile(me: Author): Promise<AuthorProfile> {
  const d = await db();
  const [a] = await d.select().from(schema.blogAuthors).where(eq(schema.blogAuthors.id, me.id)).limit(1);
  const photos = a?.photoImageId ? await editorImages([a.photoImageId]) : {};
  return {
    id: me.id,
    slug: a?.slug ?? me.slug,
    name: a?.name ?? me.name,
    role: a?.role ?? "",
    bio: a?.bio ?? "",
    links: parseLinks(a?.links),
    photo: a?.photoImageId ? (photos[a.photoImageId] ?? null) : null,
  };
}

const oneLine = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

const profileSchema = z
  .object({
    name: oneLine(60).pipe(z.string().min(1)),
    role: oneLine(80),
    bio: oneLine(BLOG_LIMITS.bioMax),
    links: z
      .array(z.object({ label: z.enum(LINK_LABELS), url: z.string().max(500) }).strict())
      .max(BLOG_LIMITS.authorLinksMax),
    photoImageId: z
      .string()
      .regex(/^[0-9a-f-]{36}$/)
      .nullable(),
  })
  .strict();

export type ProfileResult = { ok: true } | { ok: false; error: "invalid"; issues: string[] };

/** Name, role, bio, photo and up to two links. Bylines on live posts update when each post is next updated. */
export async function updateAuthorProfile(me: Author, input: unknown): Promise<ProfileResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", issues: parsed.error.issues.map((i) => i.path.join(".") || "profile") };
  const p = parsed.data;
  const links: AuthorLink[] = [];
  for (const l of p.links) {
    const url = safeHref(l.url);
    if (!url || url.startsWith("/") || !url.startsWith("https:")) return { ok: false, error: "invalid", issues: ["links"] };
    links.push({ label: l.label, url });
  }
  if (p.photoImageId && !(await editorImages([p.photoImageId]))[p.photoImageId]) return { ok: false, error: "invalid", issues: ["photoImageId"] };
  const d = await db();
  await d
    .update(schema.blogAuthors)
    .set({ name: p.name, role: p.role, bio: p.bio, links, photoImageId: p.photoImageId, updatedAt: new Date() })
    .where(eq(schema.blogAuthors.id, me.id));
  revalidateBlogAuthors();
  revalidateBlog();
  return { ok: true };
}
