import { readImageFile } from "@/lib/blog/image-store";

// Blog photos and share images: /blog/img/<id>/<file>. Under /blog/, not /api/, so image
// search may crawl them (robots.txt blocks /api/). A file's name carries a hash of its bytes,
// so a URL never changes what it serves: browsers and Vercel's CDN keep it for a year, and
// this function runs only on a CDN miss. The image store checks the id and name, reads one
// row by its key and returns only the two image types uploads may have.

const FOREVER = "public, max-age=31536000, immutable";

const missing = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_request: Request, { params }: RouteContext<"/blog/img/[id]/[file]">) {
  const { id, file } = await params;
  const found = await readImageFile(id, file);
  if (!found) return missing();
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.mime,
      "Content-Length": String(found.bytes.length),
      "Cache-Control": FOREVER,
      // Vercel's CDN reads this one; Cache-Control alone may only reach browsers.
      "CDN-Cache-Control": FOREVER,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
