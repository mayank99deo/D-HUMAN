// The public address of the site, used for canonical tags, share previews,
// structured data, the sitemap and email links.
//
// One canonical host: https://www.dhuman.fit. dhuman.fit, www.d-human.fit,
// d-human.fit and d-human.vercel.app serve the same deployment, and
// next.config.ts sends their page requests here with a 308.
//
// NEXT_PUBLIC_SITE_URL still wins when it names some other address (a new
// domain one day). When it names one of the hosts above, it's read as the
// canonical host instead, so a stale value can never point search engines at
// a host that redirects. Without it: the canonical host on Vercel (production
// and previews alike, so previews never compete with the live site), and
// nothing locally (callers fall back to the request's own origin).
// Pure, so tests can import it.

export const SITE_HOST = "www.dhuman.fit";
export const SITE_ORIGIN = `https://${SITE_HOST}`;

/** Hosts that serve this site but aren't the canonical one. */
export const LEGACY_HOSTS = ["dhuman.fit", "www.d-human.fit", "d-human.fit", "d-human.vercel.app"] as const;

export function siteUrl(): string | undefined {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    let host: string | null = null;
    try {
      host = new URL(explicit).hostname;
    } catch {
      host = null;
    }
    if (host && (LEGACY_HOSTS as readonly string[]).includes(host)) return SITE_ORIGIN;
    return explicit.replace(/\/$/, "");
  }
  return process.env.VERCEL ? SITE_ORIGIN : undefined;
}

/** An absolute URL on the public site; the canonical host when nothing else is set. */
export function absoluteUrl(path = "/"): string {
  return `${siteUrl() ?? SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
