// The one place the site reads published posts: blog pages, topic hubs, team pages, the
// sitemap, the feed, the footer's Blog link and structured data all come through here, so
// none of them can list a post the others don't. Only `live` is ever read, and only for
// posts whose status is live; drafts never leave the database through this module.
//
// Two layers:
// - read* functions take a database and return plain data. Tests call them on PGlite.
// - The exported readers wrap them in 'use cache' with cacheLife("max") and the blog's tags,
//   so pages are static and change only when /write publishes (revalidateBlog below).
//
// Builds: a Vercel build reads the production database, and an error fails the build rather
// than baking an empty blog into production. A local build with no Postgres URL reads
// nothing (it must not open .data/pglite while `next dev` may have it open).

import "server-only";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { db, schema, type Db } from "../db/index.ts";
import { databaseUrl } from "../db/url.mjs";
import { AuthorLinkSchema, PostLiveSchema, isPostSlug } from "./blocks.ts";
import {
  BLOG_TAGS,
  BLOG_TOPICS,
  type BlogRegistry,
  type BlogTopic,
  type LiveImage,
  type LivePost,
  type PostLive,
  type PostLookup,
  type PostSummary,
  type PublicAuthor,
} from "./types.ts";

export { BLOG_TAGS };

const { blogAuthors, blogImageFiles, blogImages, blogPosts, blogSlugs } = schema;

// ── Reading ─────────────────────────────────────────────────────────────────

const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();
const asTopic = (value: string | null): BlogTopic | null => ((BLOG_TOPICS as readonly string[]).includes(value ?? "") ? (value as BlogTopic) : null);

/** Photos by id, with their files' names (never their bytes). */
export async function readImages(d: Db, ids: readonly string[]): Promise<Map<string, LiveImage>> {
  const out = new Map<string, LiveImage>();
  if (!ids.length) return out;
  const [images, files] = await Promise.all([
    d.select().from(blogImages).where(inArray(blogImages.id, [...ids])),
    d
      .select({ imageId: blogImageFiles.imageId, name: blogImageFiles.name, width: blogImageFiles.width, mime: blogImageFiles.mime })
      .from(blogImageFiles)
      .where(inArray(blogImageFiles.imageId, [...ids])),
  ]);
  for (const image of images) {
    const own = files
      .filter((f) => f.imageId === image.id && (f.mime === "image/webp" || f.mime === "image/jpeg"))
      .map((f) => ({ name: f.name, width: f.width, mime: f.mime as LiveImage["files"][number]["mime"] }))
      .sort((a, b) => a.width - b.width || a.name.localeCompare(b.name));
    if (!own.length) continue;
    out.set(image.id, {
      id: image.id,
      width: image.width,
      height: image.height,
      focalX: image.focalX,
      focalY: image.focalY,
      keepColour: image.keepColour,
      files: own,
    });
  }
  return out;
}

export type TeamMember = PublicAuthor & { active: boolean };

/** An author's profile links that pass the link rules; any other entry is dropped. */
function safeLinks(value: unknown): PublicAuthor["links"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((link) => {
    const parsed = AuthorLinkSchema.safeParse(link);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Every author as they are now (name, role, bio, photo, links), whether or not they've published. */
export async function readAuthors(d: Db): Promise<TeamMember[]> {
  const rows = await d.select().from(blogAuthors).orderBy(blogAuthors.createdAt, blogAuthors.id);
  const photos = await readImages(d, rows.map((r) => r.photoImageId).filter((id): id is string => Boolean(id)));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    role: r.role,
    bio: r.bio,
    photo: (r.photoImageId && photos.get(r.photoImageId)) || null,
    links: safeLinks(r.links),
    active: r.active,
  }));
}

const publicAuthor = (m: TeamMember): PublicAuthor => ({ id: m.id, slug: m.slug, name: m.name, role: m.role, bio: m.bio, photo: m.photo, links: m.links });

/**
 * The byline: the post's author (its author_id, the foreign key) as they are now. The copy
 * publish took is only a fallback, and can't name a different person.
 */
const authorOf = (members: readonly TeamMember[], authorId: string, snapshot: PublicAuthor): PublicAuthor => {
  const current = members.find((m) => m.id === authorId);
  return current ? publicAuthor(current) : { ...snapshot, id: authorId };
};

type Row = {
  id: string;
  slug: string;
  topic: string | null;
  featured: boolean;
  publishedAt: Date | null;
  updatedOn: Date | null;
};

function summary(row: Row & { publishedAt: Date }, live: Omit<PostLive, "blocks" | "sources">, author: PublicAuthor): PostSummary {
  const cover = live.cover ? live.images[live.cover.imageId] : undefined;
  return {
    id: row.id,
    slug: row.slug,
    title: live.title,
    dek: live.dek,
    seoDescription: live.seoDescription,
    topic: asTopic(row.topic),
    language: live.language,
    cover: cover && live.cover ? { ...cover, alt: live.cover.alt } : null,
    author,
    publishedAt: iso(row.publishedAt),
    updatedOn: row.updatedOn ? iso(row.updatedOn) : null,
    readingMinutes: live.readingMinutes,
    featured: row.featured,
    share: live.share ?? null,
  };
}

const liveOnly = and(eq(blogPosts.status, "live"), isNotNull(blogPosts.live), isNotNull(blogPosts.publishedAt));

/**
 * Every live post, newest first, as list rows. The whole live copy is checked, body included,
 * so a post the page would refuse (404) is never listed either; it's left out and logged.
 * Bodies are read here but not returned: this runs once per publish, behind the cache.
 */
export async function readLivePosts(d: Db): Promise<PostSummary[]> {
  const [rows, members] = await Promise.all([
    d
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        topic: blogPosts.topic,
        featured: blogPosts.featured,
        publishedAt: blogPosts.publishedAt,
        updatedOn: blogPosts.updatedOn,
        authorId: blogPosts.authorId,
        live: blogPosts.live,
      })
      .from(blogPosts)
      .where(liveOnly)
      .orderBy(desc(blogPosts.publishedAt), blogPosts.id),
    readAuthors(d),
  ]);
  const posts: PostSummary[] = [];
  for (const row of rows) {
    const live = PostLiveSchema.safeParse(row.live);
    if (!live.success || !row.publishedAt) {
      console.error(`[blog] live post ${row.id} doesn't match the schema; left out`, live.error?.issues.slice(0, 3));
      continue;
    }
    posts.push(summary({ ...row, publishedAt: row.publishedAt }, live.data, authorOf(members, row.authorId, live.data.author)));
  }
  return posts;
}

/** Whether anything is live, for the Blog links in the footers (no link to an empty blog). */
export async function readHasLivePosts(d: Db): Promise<boolean> {
  const rows = await d.select({ id: blogPosts.id }).from(blogPosts).where(liveOnly).limit(1);
  return rows.length > 0;
}

/**
 * A post by its address: live, moved (a slug it used to have, 308 to the current one), or
 * missing (never was, a draft, taken down, deleted: all 404, Mayank's call).
 */
export async function readLivePost(d: Db, slug: string): Promise<PostLookup> {
  if (!isPostSlug(slug)) return { kind: "missing" };
  const [row] = await d
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      topic: blogPosts.topic,
      featured: blogPosts.featured,
      publishedAt: blogPosts.publishedAt,
      updatedOn: blogPosts.updatedOn,
      authorId: blogPosts.authorId,
      live: blogPosts.live,
    })
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), liveOnly))
    .limit(1);
  if (row?.publishedAt) {
    const live = PostLiveSchema.safeParse(row.live);
    if (!live.success) {
      console.error(`[blog] live post ${row.id} doesn't match the schema; answering 404`, live.error.issues.slice(0, 3));
      return { kind: "missing" };
    }
    const author = authorOf(await readAuthors(d), row.authorId, live.data.author);
    const head = summary({ ...row, publishedAt: row.publishedAt }, live.data, author);
    const cover = live.data.cover && head.cover ? { ...head.cover, ...live.data.cover } : null;
    const post: LivePost = { ...live.data, ...head, cover, author, share: head.share };
    return { kind: "live", post };
  }
  const [old] = await d
    .select({ current: blogPosts.slug })
    .from(blogSlugs)
    .innerJoin(blogPosts, eq(blogSlugs.postId, blogPosts.id))
    .where(and(eq(blogSlugs.slug, slug), liveOnly))
    .limit(1);
  return old && old.current !== slug ? { kind: "moved", slug: old.current } : { kind: "missing" };
}

export type ListOptions = { topic?: BlogTopic; authorId?: string; page?: number; perPage?: number };

/** Filters and pages a newest-first list. No page asked for: the whole list. */
export function listPosts(posts: readonly PostSummary[], { topic, authorId, page, perPage }: ListOptions = {}): PostSummary[] {
  const kept = posts.filter((p) => (!topic || p.topic === topic) && (!authorId || p.author.id === authorId));
  if (!page || !perPage) return kept;
  return kept.slice((page - 1) * perPage, page * perPage);
}

/**
 * The featured post (the one pinned, else the newest) and the rest, for /blog and its pages.
 * The featured post shows only on page 1; the rest are paged after it.
 */
export function splitFeatured(posts: readonly PostSummary[]): { featured: PostSummary | null; rest: PostSummary[] } {
  const featured = posts.find((p) => p.featured) ?? posts[0] ?? null;
  return { featured, rest: posts.filter((p) => p !== featured) };
}

/**
 * Up to `count` other posts to read next: the same topic first, newest first, then the newest
 * from anywhere.
 */
export function relatedPosts(post: Pick<PostSummary, "id" | "topic">, posts: readonly PostSummary[], count = 3): PostSummary[] {
  const others = posts.filter((p) => p.id !== post.id);
  const same = post.topic ? others.filter((p) => p.topic === post.topic) : [];
  return [...same, ...others.filter((p) => !same.includes(p))].slice(0, count);
}

// ── Cached readers (what pages call) ────────────────────────────────────────

/** The database, or null during a local build with no Postgres URL (see the top of this file). */
async function readerDb(): Promise<Db | null> {
  if (process.env.NEXT_PHASE === "phase-production-build" && !databaseUrl()) return null;
  return db();
}

/** Every live post, read once per publish and shared by every list below. */
async function allLivePosts(): Promise<PostSummary[]> {
  "use cache";
  cacheLife("max");
  cacheTag(BLOG_TAGS.list, BLOG_TAGS.authors);
  const d = await readerDb();
  return d ? readLivePosts(d) : [];
}

export async function livePosts(options: ListOptions = {}): Promise<PostSummary[]> {
  "use cache";
  cacheLife("max");
  cacheTag(BLOG_TAGS.list, BLOG_TAGS.authors);
  return listPosts(await allLivePosts(), options);
}

export async function livePost(slug: string): Promise<PostLookup> {
  "use cache";
  cacheLife("max");
  // The list tag too: a 404 cached for an address must clear when a post is published there.
  cacheTag(BLOG_TAGS.list, BLOG_TAGS.authors);
  const d = await readerDb();
  if (!d) return { kind: "missing" };
  const found = await readLivePost(d, slug);
  if (found.kind === "live") cacheTag(BLOG_TAGS.post(found.post.id));
  return found;
}

/** Authors with a public page: active ones, and anyone with a live post. */
export async function authors(): Promise<PublicAuthor[]> {
  "use cache";
  cacheLife("max");
  cacheTag(BLOG_TAGS.list, BLOG_TAGS.authors);
  const d = await readerDb();
  if (!d) return [];
  const [members, posts] = await Promise.all([readAuthors(d), allLivePosts()]);
  return members.filter((m) => m.active || posts.some((p) => p.author.id === m.id)).map(publicAuthor);
}

export async function hasLivePosts(): Promise<boolean> {
  "use cache";
  cacheLife("max");
  cacheTag(BLOG_TAGS.list);
  const d = await readerDb();
  return d ? readHasLivePosts(d) : false;
}

export const registry = { livePosts, livePost, authors } satisfies BlogRegistry;

// ── For /write (lane A) ─────────────────────────────────────────────────────

/**
 * Call after a publish, update, take-down, restore, delete or slug change commits. Every blog
 * page, the sitemap, the feed and the footers' Blog link read through the list tag, so all of
 * them render fresh on their next visit; { expire: 0 } means nobody is served the old copy.
 */
export function revalidateBlog(postId?: string): void {
  revalidateTag(BLOG_TAGS.list, { expire: 0 });
  if (postId) revalidateTag(BLOG_TAGS.post(postId), { expire: 0 });
}

/** Call after an author's name, role, bio, photo, links or active flag change. */
export function revalidateBlogAuthors(): void {
  revalidateTag(BLOG_TAGS.authors, { expire: 0 });
}
