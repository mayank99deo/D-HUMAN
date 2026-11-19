import { writerAccess } from "@/lib/auth/author";
import { isPublicImage, readImageFile } from "@/lib/blog/image-store";

// Blog photos and share images: /blog/img/<id>/<file>. Under /blog/, not /api/, so image
// search may crawl them (robots.txt blocks /api/).
//
// Readers get an image only while a live post uses it (or it's a writer's byline photo):
// a draft's photos, and a taken-down post's, answer 404. Writers, signed in, also get the
// photos of drafts, so /write's preview shows them; those answers are private.
//
// A file's name carries a hash of its bytes, so its content never changes, but whether it
// may be shown does. Vercel's CDN keeps a public answer for a day and browsers for an
// hour, so a take-down reaches every copy within a day. This function runs on a CDN miss.

/** Browsers: an hour. */
const PUBLIC_BROWSER = "public, max-age=3600";
/** Vercel's CDN reads CDN-Cache-Control: a day, the longest a taken-down photo stays reachable. */
const PUBLIC_CDN = "public, max-age=86400";
/** A writer's view of a draft's photo: never in a shared cache. */
const WRITER_ONLY = "private, max-age=3600";

const missing = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_request: Request, { params }: RouteContext<"/blog/img/[id]/[file]">) {
  const { id, file } = await params;
  // Decided before anything about the visitor is read, so a public answer is the same for everyone.
  const forReaders = await isPublicImage(id);
  if (!forReaders && (await writerAccess()).kind !== "author") return missing();
  const found = await readImageFile(id, file);
  if (!found) return missing();
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.mime,
      "Content-Length": String(found.bytes.length),
      ...(forReaders ? { "Cache-Control": PUBLIC_BROWSER, "CDN-Cache-Control": PUBLIC_CDN } : { "Cache-Control": WRITER_ONLY }),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
