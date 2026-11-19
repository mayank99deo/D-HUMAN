import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { blogListingNow } from "@/lib/blog/registry";
import { siteMap } from "@/lib/seo";

// Every public page, on the canonical host (lib/seo.ts builds the list), read at request time.
//
// Why not prerendered, like the feed: Next hands a prerendered /sitemap.xml to the host as a
// plain static file, with no function and no cache tags (isStaticMetadataFile in
// next/dist/build/adapter/build-complete.js). On Vercel it then only changes with a deploy,
// so the first live post never reached it (2026-11-19). connection() keeps it a function.
// It reads the database itself rather than the 'use cache' readers, whose default store
// lives in one server instance's memory, so a publish, take-down or new address shows on
// the next fetch. That's a few small queries per fetch; crawlers fetch it a few times a day.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  return siteMap(await blogListingNow());
}
