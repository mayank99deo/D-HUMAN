import { writeGuard } from "@/lib/auth/author";
import { readImageFile } from "@/lib/blog/image-store";

// Photos inside the editor and the preview, for writers only. Readers get the same files
// from /blog/img/<id>/<file> (reader lane), cached publicly for a year.
export async function GET(request: Request, ctx: RouteContext<"/api/write/images/[id]/[file]">) {
  const guard = await writeGuard(request, { mutation: false });
  if (!guard.ok) return guard.response;
  const { id, file } = await ctx.params;
  const found = await readImageFile(id, file);
  if (!found) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "content-type": found.mime,
      // The name carries a content hash, so the bytes never change; private, as this route checks who asks.
      "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": "inline",
    },
  });
}
