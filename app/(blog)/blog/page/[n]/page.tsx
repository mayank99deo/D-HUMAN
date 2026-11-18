import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BlogIndex, pageCount } from "@/components/blog/BlogIndex";
import { livePosts } from "@/lib/blog/registry";
import { BLOG_DESCRIPTION, BLOG_PATH, BLOG_TITLE, blogPagePath, blogPageMetadata } from "@/lib/seo";

// Older posts: /blog/page/2 and on, each its own canonical page (SEO plan §4.6). Page 1 is
// /blog itself; a page past the end is a 404.

export const ensureStatic = "navigation";

/** "2" → 2; anything else (including "1" written as "01") isn't a page address. */
const pageNumber = (n: string) => (/^[1-9]\d{0,3}$/.test(n) ? Number(n) : null);

export async function generateStaticParams() {
  const pages = pageCount(await livePosts());
  // Cache Components needs at least one; with a single page, "2" renders the 404.
  return Array.from({ length: Math.max(1, pages - 1) }, (_, i) => ({ n: String(i + 2) }));
}

export async function generateMetadata({ params }: PageProps<"/blog/page/[n]">): Promise<Metadata> {
  const page = pageNumber((await params).n);
  if (!page || page < 2) return {};
  return blogPageMetadata({ path: blogPagePath(page), title: `${BLOG_TITLE}, page ${page} | D-Human`, description: BLOG_DESCRIPTION });
}

export default async function OlderPostsPage({ params }: PageProps<"/blog/page/[n]">) {
  const page = pageNumber((await params).n);
  if (page === 1) permanentRedirect(BLOG_PATH);
  const posts = await livePosts();
  if (!page || page > pageCount(posts)) notFound();
  return <BlogIndex posts={posts} page={page} />;
}
