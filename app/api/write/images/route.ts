import { writeGuard } from "@/lib/auth/author";
import { UPLOAD_MAX_BYTES, checkPhotoFiles, checkShareFiles, saveImage } from "@/lib/blog/image-store";
import { allowRequest } from "@/lib/waitlist/rate-limit";
import { fail, reply } from "../http";

// Photo uploads from /write. The browser has already resized the photo to up to three
// widths and re-encoded it (which drops location data); this checks every file's bytes
// (type, size, real width and height, no EXIF) before storing. "share" is the post's
// share image, drawn in the browser at Publish.

const STATUS: Record<string, number> = { too_large: 413, unsupported_type: 415, metadata: 415 };

export async function POST(request: Request) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  if (!allowRequest(`write:image:${guard.author.id}`, 120, 60 * 60_000)) return fail({ error: "rate_limited" });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > UPLOAD_MAX_BYTES + 64 * 1024) return reply({ error: "too_large" }, 413);

  const form = await request.formData().catch(() => null);
  if (!form) return reply({ error: "invalid" }, 400);
  const kind = form.get("kind") === "share" ? "share" : "photo";
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const parts = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  const checked = kind === "share" ? checkShareFiles(parts) : checkPhotoFiles(parts);
  if (!checked.ok) return reply({ error: checked.error }, STATUS[checked.error] ?? 400);

  const image = await saveImage(guard.author.id, checked, { keepColour: kind === "share" });
  return reply({ image: { ...image, ownRights: true, credit: null } }, 201);
}
