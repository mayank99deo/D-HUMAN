import type { MetadataRoute } from "next";
import { APP_PATHS } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site-url";

// Public pages are open to every crawler; the signed-in app and the API aren't.
// The app's pages also say noindex (app/(platform)), and /signin stays crawlable
// so crawlers can read its noindex. Next's own files under /_next stay allowed:
// search engines need the CSS and JavaScript to render pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...APP_PATHS] },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
