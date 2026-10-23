// The public address of the site, used for share previews and email links.
// NEXT_PUBLIC_SITE_URL wins when set. Otherwise, on Vercel, this is the
// project's production domain: d-human.vercel.app today, and dhuman.fit once
// that domain is added to the project, with no code change.
export function siteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : undefined;
}
