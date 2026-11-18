import type { Metadata } from "next";
import { BlogIndex } from "@/components/blog/BlogIndex";
import { livePosts } from "@/lib/blog/registry";
import { BLOG_DESCRIPTION, BLOG_PATH, blogPageMetadata } from "@/lib/seo";

// The blog's front page. Static: rendered at build from the registry and again whenever /write
// publishes. With no live posts it's a short noindex page pointing at the guides.

const TITLE = "Blog: Indian food, blood tests and health | D-Human";

export async function generateMetadata(): Promise<Metadata> {
  const posts = await livePosts();
  return blogPageMetadata({ path: BLOG_PATH, title: TITLE, description: BLOG_DESCRIPTION, index: posts.length > 0 });
}

export default async function BlogPage() {
  const posts = await livePosts();
  return <BlogIndex posts={posts} page={1} />;
}
