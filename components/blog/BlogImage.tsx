import type { CSSProperties } from "react";
import { imagePath, type ImageFile, type LiveImage } from "@/lib/blog/types";

// A blog photo. Plain <img srcset>, not next/image: Next's optimiser counts transformations
// against Vercel Hobby's monthly cap, and past it new images show only their alt text. The
// author's browser already made 480, 960 and 1600 px files, served from /blog/img/… (cached a day
// by the CDN, so a taken-down post's photos stop loading within a day). Crops are CSS around the author's focal point; photos are black and white
// unless the author marked them a screenshot or chart (keep colour). The box holds its space
// (CLS 0) with a flat grey until the photo arrives; a broken photo shows its alt text there.

const srcSet = (image: LiveImage, files: ImageFile[]) => files.map((f) => `${imagePath(image.id, f.name)} ${f.width}w`).join(", ");

/** The file closest to 960 px wide: what a browser without srcset support gets. */
const fallback = (files: ImageFile[]) => files.reduce((a, b) => (Math.abs(b.width - 960) < Math.abs(a.width - 960) ? b : a));

const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;

export function BlogImage({
  image,
  alt,
  sizes,
  priority = false,
  className = "",
}: {
  image: LiveImage;
  alt: string;
  /** The `sizes` attribute: how wide the photo shows at each screen width. */
  sizes: string;
  /** Only the one photo most likely to be the page's largest paint. */
  priority?: boolean;
  className?: string;
}) {
  const webp = image.files.filter((f) => f.mime === "image/webp");
  const jpeg = image.files.filter((f) => f.mime === "image/jpeg");
  const main = jpeg.length ? jpeg : webp;
  const style: CSSProperties = {
    objectPosition: `${pct(image.focalX)} ${pct(image.focalY)}`,
    filter: image.keepColour ? undefined : "grayscale(1)",
  };
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized files; see the note above
    <img
      src={imagePath(image.id, fallback(main).name)}
      srcSet={srcSet(image, main)}
      sizes={sizes}
      alt={alt}
      width={image.width}
      height={image.height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={`h-full w-full object-cover ${className}`}
      style={style}
    />
  );
  if (!webp.length || !jpeg.length) return img;
  return (
    <picture className="contents">
      <source type="image/webp" srcSet={srcSet(image, webp)} sizes={sizes} />
      {img}
    </picture>
  );
}
