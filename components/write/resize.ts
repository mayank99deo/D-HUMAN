// A blog photo, made ready in the author's browser: turned the right way up, drawn at
// 480, 960 and 1,600 px wide (never wider than the original), and encoded as WebP, or
// JPEG where the browser can't make WebP. Re-encoding drops all camera data, including
// the phone's GPS location. Built like components/platform/shrink.ts, which meals use.

import { IMAGE_FILE_MAX_BYTES, IMAGE_WIDTHS } from "@/lib/blog/types";

export type ResizedPhoto = { blobs: Blob[]; width: number; height: number; mime: "image/webp" | "image/jpeg" };

export class PhotoError extends Error {
  code: "unsupported" | "too_large";
  constructor(code: "unsupported" | "too_large") {
    super(code);
    this.code = code;
  }
}

type Decoded = { image: CanvasImageSource; width: number; height: number; close?: () => void };

async function decode(file: File): Promise<Decoded> {
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img>, which Safari can use for HEIC */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    throw new PhotoError("unsupported");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The widths to make: the steps below the original, then the original capped at 1,600. */
export function widthsFor(natural: number): number[] {
  const top = Math.min(natural, IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]);
  return [...IMAGE_WIDTHS.filter((w) => w < top), top];
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export async function resizePhoto(file: File): Promise<ResizedPhoto> {
  const src = await decode(file);
  try {
    const widths = widthsFor(src.width);
    const ratio = src.height / src.width;
    let mime: ResizedPhoto["mime"] | null = null;
    const blobs: Blob[] = [];
    for (const w of widths) {
      const h = Math.max(1, Math.round(w * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new PhotoError("unsupported");
      ctx.imageSmoothingQuality = "high";
      // Posts sit on paper: white behind anything transparent (and JPEG has no transparency).
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(src.image, 0, 0, w, h);
      // Browsers that can't make WebP quietly return PNG; then every width is JPEG.
      mime ??= (await encode(canvas, "image/webp", 0.82))?.type === "image/webp" ? "image/webp" : "image/jpeg";
      let blob: Blob | null = null;
      for (const quality of [0.82, 0.7, 0.58]) {
        const b = await encode(canvas, mime, quality);
        if (b && b.size <= IMAGE_FILE_MAX_BYTES * 0.95) {
          blob = b;
          break;
        }
      }
      if (!blob) throw new PhotoError("too_large");
      blobs.push(blob);
    }
    const top = widths[widths.length - 1];
    return { blobs, width: top, height: Math.round(top * ratio), mime: mime ?? "image/jpeg" };
  } finally {
    src.close?.();
  }
}

/** Uploads a photo's widths (or the share image) with progress, 0 to 1. */
export function uploadImage(blobs: Blob[], kind: "photo" | "share", onProgress?: (share: number) => void): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.set("kind", kind);
    blobs.forEach((b, i) => form.append("file", b, `${kind}-${i}.${b.type === "image/webp" ? "webp" : "jpg"}`));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/write/images");
    xhr.responseType = "json";
    xhr.timeout = 60_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, body: (xhr.response as Record<string, unknown>) ?? {} });
    xhr.onerror = xhr.ontimeout = () => resolve({ status: 0, body: {} });
    xhr.send(form);
  });
}
