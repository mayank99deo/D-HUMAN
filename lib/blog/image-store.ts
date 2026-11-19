import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Db } from "@/lib/db";
import { FILE_NAME_PATTERN } from "./blocks";
import { IMAGE_FILE_MAX_BYTES, IMAGE_MIMES, IMAGE_WIDTHS, SHARE_IMAGE_SIZES, type ImageFile, type LiveImage, type ShareImageKind, type ShareImages } from "./types";

// Blog photos, kept in Postgres for v1 (blog_images, blog_image_files). The author's
// browser resizes each photo to up to three widths and re-encodes it, which also drops
// its location data; this module checks what arrives byte by byte, stores it under
// content-hashed names, and reads it back for the image route. Moving to Vercel Blob
// later changes this file only. Design: architecture §2.4.

export const IMAGE_MIME = { webp: "image/webp", jpeg: "image/jpeg" } as const;
type Mime = ImageFile["mime"];

/** One request's photo files together stay under the host's 4.5 MB body limit. */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const LARGEST_MIN_WIDTH = 200;
const HEIGHT_MAX = 4_000;

const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Files are named "w960-3fa9c1.webp" (photos) or "og-3fa9c1.jpg", "16x9-…", "4x3-…", "1x1-…" (share images). Reads accept whatever the reader lane's image route accepts. */
const READ_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHARE_KINDS = Object.keys(SHARE_IMAGE_SIZES) as ShareImageKind[];

/** Trusts the first bytes, never the name or the browser's label. */
export function sniffImage(bytes: Uint8Array): Mime | null {
  const b = bytes;
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return IMAGE_MIME.jpeg;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 16 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return IMAGE_MIME.webp;
  return null;
}

export type ImageFacts = { width: number; height: number; metadata: boolean };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

// Segments that can carry camera, location or author details: APP1 (EXIF and XMP),
// APP13 (Photoshop and IPTC) and comments. The editor re-encodes every photo through a
// canvas, which writes none of them, so finding one means the file didn't come from it.
const JPEG_METADATA = new Set([0xe1, 0xed, 0xfe]);
const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;
const isFrameHeader = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * A JPEG's size from its frame header, and whether any segment anywhere in the file
 * carries metadata. Walks every segment from start to end-of-image, stepping over the
 * compressed data after each scan, so nothing hides after the frame header or between
 * scans. A file that doesn't walk cleanly, or has bytes after its end, isn't read.
 */
function jpegFacts(b: Uint8Array): ImageFacts | null {
  let i = 2;
  let size: { width: number; height: number } | null = null;
  let metadata = false;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd9) return size && i + 2 === b.length ? { ...size, metadata } : null;
    if (marker === 0xd8 || marker === 0x01 || isRestart(marker)) {
      i += 2;
      continue;
    }
    if (i + 4 > b.length) return null;
    const length = u16be(b, i + 2);
    if (length < 2 || i + 2 + length > b.length) return null;
    if (JPEG_METADATA.has(marker)) metadata = true;
    if (isFrameHeader(marker) && !size) {
      if (length < 7) return null;
      size = { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + length;
    if (marker === 0xda) {
      // Compressed data runs to the next marker; 0xFF 0x00 is an escaped byte, restarts belong to it.
      while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0x00 && !isRestart(b[i + 1]))) i++;
    }
  }
  return null;
}

/** RIFF chunks that hold camera, location or author details. */
const WEBP_METADATA = new Set(["EXIF", "XMP "]);

/**
 * A WebP's size from its first chunk (lossy, lossless or extended), and whether any chunk
 * carries EXIF or XMP (or the extended header says it does). Walks every chunk the RIFF
 * header covers; a chunk that runs past the file means it isn't read.
 */
function webpFacts(b: Uint8Array): ImageFacts | null {
  if (b.length < 30) return null;
  const fourcc = (at: number) => String.fromCharCode(...b.subarray(at, at + 4));
  const u32le = (at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  let size: { width: number; height: number } | null = null;
  let metadata = false;
  const chunk = fourcc(12);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    size = { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  } else if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  } else if (chunk === "VP8X") {
    metadata = (b[20] & 0x0c) !== 0;
    size = { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  } else {
    return null;
  }
  const end = 8 + u32le(4);
  if (end > b.length) return null;
  for (let at = 12; at < end; ) {
    if (at + 8 > end) return null;
    const length = u32le(at + 4);
    const next = at + 8 + length + (length % 2);
    if (next > end + (length % 2)) return null;
    if (WEBP_METADATA.has(fourcc(at))) metadata = true;
    at = next;
  }
  return { ...size, metadata };
}

export function imageFacts(bytes: Uint8Array, mime: Mime): ImageFacts | null {
  return mime === IMAGE_MIME.jpeg ? jpegFacts(bytes) : webpFacts(bytes);
}

export type CheckedFile = { name: string; mime: Mime; width: number; height: number; bytes: Buffer };
export type PhotoCheck = { ok: true; files: CheckedFile[]; width: number; height: number } | { ok: false; error: UploadError };
export type UploadError = "no_file" | "too_many_files" | "too_large" | "unsupported_type" | "unreadable" | "metadata" | "mixed_types" | "bad_widths" | "bad_shape" | "bad_share_size";

const contentName = (prefix: string, bytes: Uint8Array, mime: Mime) =>
  `${prefix}-${createHash("sha256").update(bytes).digest("hex").slice(0, 6)}.${mime === IMAGE_MIME.webp ? "webp" : "jpg"}`;

function readFile(bytes: Buffer): { ok: true; mime: Mime; facts: ImageFacts } | { ok: false; error: UploadError } {
  if (bytes.length > IMAGE_FILE_MAX_BYTES) return { ok: false, error: "too_large" };
  const mime = sniffImage(bytes);
  if (!mime) return { ok: false, error: "unsupported_type" };
  const facts = imageFacts(bytes, mime);
  if (!facts || !facts.width || !facts.height) return { ok: false, error: "unreadable" };
  if (facts.metadata) return { ok: false, error: "metadata" };
  return { ok: true, mime, facts };
}

/**
 * A photo's files, as the editor makes them: one type, ascending widths, every width
 * but the largest from IMAGE_WIDTHS, the largest no wider than 1,600 px (smaller only
 * when the original was), one shape. Sizes are read from the bytes, never trusted.
 */
export function checkPhotoFiles(parts: readonly Buffer[]): PhotoCheck {
  if (!parts.length) return { ok: false, error: "no_file" };
  if (parts.length > IMAGE_WIDTHS.length) return { ok: false, error: "too_many_files" };
  if (parts.reduce((n, p) => n + p.length, 0) > UPLOAD_MAX_BYTES) return { ok: false, error: "too_large" };
  const read: { mime: Mime; facts: ImageFacts; bytes: Buffer }[] = [];
  for (const bytes of parts) {
    const r = readFile(bytes);
    if (!r.ok) return r;
    read.push({ mime: r.mime, facts: r.facts, bytes });
  }
  if (new Set(read.map((r) => r.mime)).size > 1) return { ok: false, error: "mixed_types" };
  read.sort((a, b) => a.facts.width - b.facts.width);
  const widths = read.map((r) => r.facts.width);
  const largest = read[read.length - 1].facts;
  const maxWidth = IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
  const steps = widths.slice(0, -1);
  if (
    new Set(widths).size !== widths.length ||
    steps.some((w) => !(IMAGE_WIDTHS as readonly number[]).includes(w)) ||
    largest.width > maxWidth ||
    largest.width < LARGEST_MIN_WIDTH
  ) {
    return { ok: false, error: "bad_widths" };
  }
  const ratio = largest.height / largest.width;
  if (largest.height > HEIGHT_MAX || ratio > 3 || ratio < 0.25) return { ok: false, error: "bad_shape" };
  // Every width is the same picture: the same shape within rounding.
  if (read.some((r) => Math.abs(r.facts.height - r.facts.width * ratio) > 2)) return { ok: false, error: "bad_shape" };
  return {
    ok: true,
    width: largest.width,
    height: largest.height,
    files: read.map((r) => ({ name: contentName(`w${r.facts.width}`, r.bytes, r.mime), mime: r.mime, width: r.facts.width, height: r.facts.height, bytes: r.bytes })),
  };
}

/** Which share size a picture is, by its exact width and height. */
const shareKindOf = (width: number, height: number) => SHARE_KINDS.find((k) => SHARE_IMAGE_SIZES[k].width === width && SHARE_IMAGE_SIZES[k].height === height) ?? null;

/**
 * A post's share image: JPEGs at the SHARE_IMAGE_SIZES, each size at most once, the link
 * preview ("og", 1200 × 630) required. Named by size: "og-3fa9c1.jpg", "16x9-…".
 */
export function checkShareFiles(parts: readonly Buffer[]): PhotoCheck {
  if (!parts.length) return { ok: false, error: "no_file" };
  if (parts.length > SHARE_KINDS.length) return { ok: false, error: "too_many_files" };
  if (parts.reduce((n, p) => n + p.length, 0) > UPLOAD_MAX_BYTES) return { ok: false, error: "too_large" };
  const files: CheckedFile[] = [];
  const seen = new Set<ShareImageKind>();
  for (const bytes of parts) {
    const r = readFile(bytes);
    if (!r.ok) return r;
    const kind = shareKindOf(r.facts.width, r.facts.height);
    if (r.mime !== IMAGE_MIME.jpeg || !kind || seen.has(kind)) return { ok: false, error: "bad_share_size" };
    seen.add(kind);
    files.push({ name: contentName(kind, bytes, r.mime), mime: r.mime, width: r.facts.width, height: r.facts.height, bytes });
  }
  if (!seen.has("og")) return { ok: false, error: "bad_share_size" };
  const { width, height } = SHARE_IMAGE_SIZES.og;
  return { ok: true, width, height, files };
}

/** The `share` field a live post carries, from a stored share image's files; null if it has no link preview. */
export function shareImagesOf(img: Pick<LiveImage, "id" | "files">): ShareImages | null {
  const named = (kind: ShareImageKind) => img.files.find((f) => f.name.startsWith(`${kind}-`))?.name;
  const og = named("og");
  if (!og) return null;
  const files: ShareImages["files"] = { og };
  for (const kind of ["16x9", "4x3", "1x1"] as const) {
    const name = named(kind);
    if (name) files[kind] = name;
  }
  return { imageId: img.id, files };
}

/** Stores checked files as a new image (random id). Photos start in black and white, owned by the uploader. */
export async function saveImage(authorId: string, checked: Extract<PhotoCheck, { ok: true }>, opts: { keepColour?: boolean } = {}): Promise<LiveImage> {
  const id = crypto.randomUUID();
  const d = await db();
  await d.transaction(async (tx) => {
    await tx.insert(schema.blogImages).values({ id, width: checked.width, height: checked.height, keepColour: !!opts.keepColour, uploadedBy: authorId });
    await tx.insert(schema.blogImageFiles).values(
      checked.files.map((f) => ({ imageId: id, name: f.name, mime: f.mime, width: f.width, byteSize: f.bytes.length, bytes: f.bytes })),
    );
  });
  return {
    id,
    width: checked.width,
    height: checked.height,
    focalX: 0.5,
    focalY: 0.5,
    keepColour: !!opts.keepColour,
    files: checked.files.map((f) => ({ name: f.name, width: f.width, mime: f.mime })),
  };
}

/**
 * One file's bytes, for the image routes (the public /blog/img/<id>/<file> and the writers'
 * /api/write/images/…): one row by its key, nothing else read. Ids and names are checked
 * against the reader's patterns first, and only WebP and JPEG ever come back.
 */
export async function readImageFile(imageId: string, name: string): Promise<{ mime: (typeof IMAGE_MIMES)[number]; bytes: Buffer } | null> {
  if (!READ_ID.test(imageId) || !FILE_NAME_PATTERN.test(name)) return null;
  const d = await db();
  const [row] = await d
    .select({ mime: schema.blogImageFiles.mime, bytes: schema.blogImageFiles.bytes })
    .from(schema.blogImageFiles)
    .where(and(eq(schema.blogImageFiles.imageId, imageId), eq(schema.blogImageFiles.name, name)))
    .limit(1);
  if (!row || !(IMAGE_MIMES as readonly string[]).includes(row.mime)) return null;
  return { mime: row.mime as (typeof IMAGE_MIMES)[number], bytes: row.bytes };
}

/**
 * Whether readers may load this image: it's in the live copy of a post that is live now
 * (a cover, a photo, the share image or the byline photo taken at publish), or it's a
 * writer's current byline photo (shown on /team). Drafts' photos and those of taken-down
 * posts aren't. Two lookups by key and a scan of the live posts' JSON, on a CDN miss only.
 */
export async function isPublicImage(imageId: string): Promise<boolean> {
  if (!READ_ID.test(imageId)) return false;
  const d = await db();
  const posts = schema.blogPosts;
  const live = posts.live;
  const [[post], [author]] = await Promise.all([
    d
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          eq(posts.status, "live"),
          sql`(jsonb_exists(${live}->'images', ${imageId}) or ${live}->'share'->>'imageId' = ${imageId} or ${live}->'author'->'photo'->>'id' = ${imageId})`,
        ),
      )
      .limit(1),
    d.select({ id: schema.blogAuthors.id }).from(schema.blogAuthors).where(eq(schema.blogAuthors.photoImageId, imageId)).limit(1),
  ]);
  return Boolean(post || author);
}

/** An image as the editor shows it: what readers get, plus the rights and credit fields. */
export type EditorImage = LiveImage & { ownRights: boolean; credit: string | null };

/**
 * Images by id, with their files; ids that don't exist are simply absent. Inside a
 * transaction pass it in: a second connection would wait on it (and PGlite has only one).
 */
export async function editorImages(ids: readonly string[], tx?: Db): Promise<Record<string, EditorImage>> {
  const wanted = [...new Set(ids.filter((id) => IMAGE_ID.test(id)))];
  if (!wanted.length) return {};
  const d = tx ?? (await db());
  const [rows, files] = await Promise.all([
    d.select().from(schema.blogImages).where(inArray(schema.blogImages.id, wanted)),
    d
      .select({ imageId: schema.blogImageFiles.imageId, name: schema.blogImageFiles.name, width: schema.blogImageFiles.width, mime: schema.blogImageFiles.mime })
      .from(schema.blogImageFiles)
      .where(inArray(schema.blogImageFiles.imageId, wanted)),
  ]);
  const out: Record<string, EditorImage> = {};
  for (const r of rows) {
    out[r.id] = {
      id: r.id,
      width: r.width,
      height: r.height,
      focalX: r.focalX,
      focalY: r.focalY,
      keepColour: r.keepColour,
      ownRights: r.ownRights,
      credit: r.credit,
      files: files
        .filter((f) => f.imageId === r.id)
        .map((f) => ({ name: f.name, width: f.width, mime: f.mime as Mime }))
        .sort((a, b) => a.width - b.width),
    };
  }
  return out;
}

/** What a live post carries for each image: no rights or credit fields (credits live on the block). */
export function toLiveImage(img: EditorImage): LiveImage {
  return { id: img.id, width: img.width, height: img.height, focalX: img.focalX, focalY: img.focalY, keepColour: img.keepColour, files: img.files };
}

export type ImagePatch = { focalX?: number; focalY?: number; keepColour?: boolean; ownRights?: boolean; credit?: string | null };

/** Focal point, colour and rights. Changes reach a live post only when it's next updated (live keeps its own copy). */
export async function updateImage(imageId: string, patch: ImagePatch): Promise<boolean> {
  if (!IMAGE_ID.test(imageId)) return false;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const set: Partial<typeof schema.blogImages.$inferInsert> = {};
  if (patch.focalX !== undefined) set.focalX = clamp(patch.focalX);
  if (patch.focalY !== undefined) set.focalY = clamp(patch.focalY);
  if (patch.keepColour !== undefined) set.keepColour = patch.keepColour;
  if (patch.ownRights !== undefined) set.ownRights = patch.ownRights;
  if (patch.credit !== undefined) set.credit = patch.credit;
  if (!Object.keys(set).length) return true;
  const d = await db();
  const rows = await d.update(schema.blogImages).set(set).where(eq(schema.blogImages.id, imageId)).returning({ id: schema.blogImages.id });
  return rows.length > 0;
}
