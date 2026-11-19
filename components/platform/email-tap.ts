// Taps on links in our emails (UX spec §7.4). Every button in a lifecycle email carries
// e=<send id>. When a page opens signed in, EmailTap.tsx tells the server once (it records
// only the first tap, and only on the signed-in person's own email), then drops `e` from
// the address bar so it isn't copied or shared. Pure, so it can be tested in Node.

/** The send ids /api/email/tap accepts. Anything else is dropped from the URL but never sent. */
const SEND_ID = /^[A-Za-z0-9-]{1,64}$/;

export type EmailTapLink = { sendId: string | null; cleanHref: string };

/**
 * The email's send id in `href`, and the same address without `e` (path, the rest of the
 * query and #fragment kept), or null when there is no `e`. A malformed id still comes out
 * of the address, with sendId null.
 */
export function emailTapFrom(href: string): EmailTapLink | null {
  const url = new URL(href);
  if (!url.searchParams.has("e")) return null;
  const value = url.searchParams.get("e") ?? "";
  url.searchParams.delete("e");
  return { sendId: SEND_ID.test(value) ? value : null, cleanHref: `${url.pathname}${url.search}${url.hash}` };
}

// Ids already sent from this page's lifetime: React runs effects twice in development, and
// a screen can mount again before the address bar has caught up.
const sent = new Set<string>();

/** True the first time for each send id, so a tap is posted once per page load. */
export function firstTap(sendId: string): boolean {
  if (sent.has(sendId)) return false;
  sent.add(sendId);
  return true;
}
