// Shrinks a photo in the browser before upload: phones shoot 4–12 MB images,
// and on a slow connection in a small town every megabyte counts. Long edge
// capped, re-encoded as JPEG. Keeps enough detail to read a lab report.
export async function shrinkImage(file: File, maxEdge = 2200, quality = 0.86): Promise<File> {
  const source = await decode(file);
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source.image, 0, 0, w, h);
  source.close?.();
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality),
  );
  // Small files already under the cap stay as they are if re-encoding grew them.
  if (blob.size >= file.size && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

async function decode(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; close?: () => void }> {
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
  } finally {
    URL.revokeObjectURL(url);
  }
}
