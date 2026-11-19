"use client";

import { useRef, useState } from "react";
import type { EditorImage } from "@/lib/blog/image-store";
import { IMAGE_SOFT_BELOW } from "@/lib/blog/types";
import { send } from "@/components/platform/net";
import { UPLOAD_ERRORS } from "./labels";
import { PhotoError, resizePhoto, uploadImage } from "./resize";

// Pick or take a photo, shrink it here, upload it with progress, then: tap the most
// important part (the focal point every crop centres on), see the crops, and say whether
// it's a screenshot (keeps colour) and whether you own it (else a credit is required).

export const editorImageUrl = (img: EditorImage, width = 960) => {
  const files = img.files.length ? img.files : [];
  const file = files.find((f) => f.width >= width) ?? files[files.length - 1];
  return file ? `/api/write/images/${img.id}/${file.name}` : "";
};

type Upload = { kind: "idle" } | { kind: "working"; share: number } | { kind: "error"; message: string; file: File };

export function PhotoField({
  image,
  label,
  onImage,
  onMeta,
}: {
  image: EditorImage | undefined;
  label: string;
  /** A new photo is stored: the editor points the block at it. */
  onImage: (img: EditorImage) => void;
  /** Focal point, colour or rights changed (already saved on the server). */
  onMeta: (img: EditorImage) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<Upload>({ kind: "idle" });
  const [metaError, setMetaError] = useState(false);

  async function take(file: File) {
    setUpload({ kind: "working", share: 0 });
    try {
      const resized = await resizePhoto(file);
      const r = await uploadImage(resized.blobs, "photo", (share) => setUpload({ kind: "working", share }));
      if (r.status === 201 && r.body.image) {
        setUpload({ kind: "idle" });
        onImage(r.body.image as EditorImage);
        return;
      }
      const code = r.status === 0 ? "offline" : String(r.body.error ?? "default");
      setUpload({ kind: "error", message: UPLOAD_ERRORS[code] ?? UPLOAD_ERRORS.default, file });
    } catch (e) {
      const code = e instanceof PhotoError ? e.code : "default";
      setUpload({ kind: "error", message: UPLOAD_ERRORS[code] ?? UPLOAD_ERRORS.default, file });
    }
  }

  async function patch(img: EditorImage, change: Partial<Pick<EditorImage, "focalX" | "focalY" | "keepColour" | "ownRights">>) {
    const next = { ...img, ...change };
    onMeta(next);
    const r = await send(`/api/write/images/${img.id}`, { method: "PATCH", body: change });
    setMetaError(!r.ok);
  }

  function setFocal(e: React.MouseEvent<HTMLButtonElement>, img: EditorImage) {
    const box = e.currentTarget.getBoundingClientRect();
    const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    void patch(img, { focalX: round((e.clientX - box.left) / box.width), focalY: round((e.clientY - box.top) / box.height) });
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void take(f);
      }}
    />
  );

  const status =
    upload.kind === "working" ? (
      <p role="status" className="mt-2 text-sm text-graphite">
        {upload.share < 1 ? `Uploading ${Math.round(upload.share * 100)}%` : "Saving the photo…"}
      </p>
    ) : upload.kind === "error" ? (
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p role="alert" className="error-mark text-sm">
          {upload.message}
        </p>
        <button type="button" className="button-ghost h-11" onClick={() => void take(upload.file)}>
          Retry
        </button>
      </div>
    ) : null;

  if (!image) {
    return (
      <div>
        {picker}
        <button type="button" onClick={() => input.current?.click()} disabled={upload.kind === "working"} className="button-ghost h-12 w-full sm:w-auto">
          {label}
        </button>
        {status}
      </div>
    );
  }

  const position = `${Math.round(image.focalX * 100)}% ${Math.round(image.focalY * 100)}%`;
  const look = image.keepColour ? "" : "grayscale";
  return (
    <div>
      {picker}
      <button
        type="button"
        onClick={(e) => setFocal(e, image)}
        className="relative block w-full cursor-crosshair overflow-hidden bg-lift"
        aria-label="Tap the most important part of the photo"
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the author's own upload, from our route */}
        <img src={editorImageUrl(image, 960)} alt="" className={`h-full w-full object-contain ${look}`} />
        <span
          aria-hidden
          className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper shadow-[0_0_0_2px_#000]"
          style={{ left: `${image.focalX * 100}%`, top: `${image.focalY * 100}%` }}
        />
      </button>
      <p className="mt-2 text-sm text-graphite">Tap the most important part of the photo. Crops centre on it:</p>
      <div className="mt-2 flex items-end gap-3" aria-hidden>
        {[
          ["3 / 2", "w-36"],
          ["1 / 1", "w-20"],
          ["1.91 / 1", "w-36"],
        ].map(([ratio, width]) => (
          // eslint-disable-next-line @next/next/no-img-element -- crop previews of the same file
          <img key={ratio} src={editorImageUrl(image, 480)} alt="" className={`${width} object-cover ${look}`} style={{ aspectRatio: ratio, objectPosition: position }} />
        ))}
      </div>
      {image.width < IMAGE_SOFT_BELOW && <p className="error-mark mt-2 text-sm">This photo is small and may look soft on laptops.</p>}
      <label className="mt-3 flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-white" checked={image.keepColour} onChange={(e) => void patch(image, { keepColour: e.target.checked })} />
        <span>This is a screenshot or chart (keep colour). Photos show in black and white.</span>
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-white" checked={image.ownRights} onChange={(e) => void patch(image, { ownRights: e.target.checked })} />
        <span>I took this photo. If you didn&apos;t, use only one you have the right to, and credit it below: name, licence and source.</span>
      </label>
      {metaError && (
        <p role="alert" className="error-mark text-sm">
          Couldn&apos;t save that change to the photo. Try again.
        </p>
      )}
      <button type="button" onClick={() => input.current?.click()} disabled={upload.kind === "working"} className="link-quiet mt-1 min-h-11 text-sm">
        Replace photo
      </button>
      {status}
    </div>
  );
}
