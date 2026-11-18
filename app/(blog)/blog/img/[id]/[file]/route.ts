import { and, eq } from "drizzle-orm";
import { FILE_NAME_PATTERN } from "@/lib/blog/blocks";
import { IMAGE_MIMES } from "@/lib/blog/types";
import { db, schema } from "@/lib/db";

// Blog photos and share images: /blog/img/<id>/<file>. Under /blog/, not /api/, so image
// search may crawl them (robots.txt blocks /api/). A file's name carries a hash of its bytes,
// so a URL never changes what it serves: browsers and Vercel's CDN keep it for a year, and
// this function runs only on a CDN miss, reading one row by its key. It reads nothing else,
// and serves only the two image types uploads may have.

const IMAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FOREVER = "public, max-age=31536000, immutable";

const missing = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_request: Request, { params }: RouteContext<"/blog/img/[id]/[file]">) {
  const { id, file } = await params;
  if (!IMAGE_ID.test(id) || !FILE_NAME_PATTERN.test(file)) return missing();
  const d = await db();
  const [row] = await d
    .select({ mime: schema.blogImageFiles.mime, bytes: schema.blogImageFiles.bytes })
    .from(schema.blogImageFiles)
    .where(and(eq(schema.blogImageFiles.imageId, id), eq(schema.blogImageFiles.name, file)))
    .limit(1);
  if (!row || !(IMAGE_MIMES as readonly string[]).includes(row.mime)) return missing();
  return new Response(new Uint8Array(row.bytes), {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.bytes.length),
      "Cache-Control": FOREVER,
      // Vercel's CDN reads this one; Cache-Control alone may only reach browsers.
      "CDN-Cache-Control": FOREVER,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
