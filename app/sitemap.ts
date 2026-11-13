import type { MetadataRoute } from "next";
import { GUIDES, HOME_UPDATED } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site-url";

// Every public page, on the canonical host. Dates are each page's last real change
// (lib/seo.ts), not the build time, so crawlers can trust them.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl("/"), lastModified: HOME_UPDATED },
    ...GUIDES.map((g) => ({ url: absoluteUrl(g.path), lastModified: g.updated })),
  ];
}
