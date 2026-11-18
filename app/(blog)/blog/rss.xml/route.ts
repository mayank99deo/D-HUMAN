import { livePosts } from "@/lib/blog/registry";
import { blogRss } from "@/lib/seo";

// The blog's feed: RSS 2.0, the latest 20 posts, descriptions only (lib/seo.ts builds it).
// It reads only the cached registry, so it's prerendered and refreshed when /write publishes.
export async function GET() {
  const posts = await livePosts();
  return new Response(blogRss(posts), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
