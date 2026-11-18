import type { MetadataRoute } from "next";
import { authors, livePosts } from "@/lib/blog/registry";
import { siteMap } from "@/lib/seo";

// Every public page, on the canonical host (lib/seo.ts builds the list). The blog's entries
// come from the registry, so they list exactly the live posts, and its cache tag refreshes
// this file whenever /write publishes.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, team] = await Promise.all([livePosts(), authors()]);
  return siteMap({ posts, authors: team });
}
