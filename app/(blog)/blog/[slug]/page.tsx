import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PostArticle } from "@/components/blog/PostArticle";
import { JsonLd } from "@/components/site/Guide";
import { livePost, livePosts, relatedPosts } from "@/lib/blog/registry";
import { postLd, postMetadata, postPath } from "@/lib/seo";

// A post. Static: live posts are rendered at build, a post published later on its first
// visit (ensureStatic makes that visit wait for the whole page, so a missing post answers a
// real 404, never a 200), and every one again when /write publishes. A retired address
// gets a 308 to the post's current one; a draft, taken-down or deleted post is a 404.

export const ensureStatic = "navigation";

/** Not a valid post address, so it reads as missing without touching the database. */
const NO_POSTS_YET = "__none__";

export async function generateStaticParams() {
  const posts = await livePosts();
  // Cache Components needs at least one; before the first post, a placeholder that 404s.
  return posts.length ? posts.map((p) => ({ slug: p.slug })) : [{ slug: NO_POSTS_YET }];
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const found = await livePost((await params).slug);
  return found.kind === "live" ? postMetadata(found.post) : {};
}

export default async function PostPage({ params }: PageProps<"/blog/[slug]">) {
  const found = await livePost((await params).slug);
  if (found.kind === "moved") permanentRedirect(postPath(found.slug));
  if (found.kind === "missing") notFound();
  const related = relatedPosts(found.post, await livePosts());
  return (
    <>
      <JsonLd data={postLd(found.post)} />
      <PostArticle post={found.post} related={related} />
    </>
  );
}
