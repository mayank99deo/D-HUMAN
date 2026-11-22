// A meal photo, from the camera or the gallery: the words on Fuel's photo controls, and
// turning a picked file into the small JPEG the meal is sent with, or a plain reason why not.
//
// Phones and tablets (a finger is the main pointer) get Snap, which opens the camera, and
// "Choose a photo from your gallery" under the tiles. Laptops have no camera capture, so the
// first tile picks a file and says so, and there's no second control doing the same thing.
// FuelLogger shows one set or the other with the `touch` variant (pointer: coarse), so the
// labels never change after the page loads.
import { shrinkImage } from "./shrink";

/**
 * Only "image/*". iPhone converts HEIC photos to JPEG for it; listing image/heic would get
 * HEIC files back, which most browsers can't open.
 */
export const PHOTO_ACCEPT = "image/*";
/** Long edge, in px, and JPEG quality: enough to read a plate, small on a slow connection. */
export const MEAL_PHOTO_EDGE = 1280;
export const MEAL_PHOTO_QUALITY = 0.8;

export type PhotoProblem = "heic" | "not_image" | "unreadable";

export const PHOTO_COPY = {
  /** The first tile on phones and tablets: it opens the camera. */
  snap: { title: "Snap", note: "A photo of your plate" },
  /** The first tile on laptops: it opens the file picker. */
  file: { title: "Photo", note: "Choose a photo of your plate" },
  /** Under the tiles, phones and tablets only. */
  gallery: "Choose a photo from your gallery",
  /** Under the photo: swap it. */
  retake: "Take another photo",
  regallery: "Choose from gallery",
  another: "Choose another photo",
  opening: "Opening your photo…",
  alt: "Your meal photo",
  problems: {
    heic: "This browser can't open HEIC photos (the iPhone format). Log it from your phone, or save it as a JPEG first.",
    not_image: "That file isn't a photo. Choose a JPEG or PNG.",
    unreadable: "We couldn't open that photo. Try another one, or a JPEG or PNG.",
  } satisfies Record<PhotoProblem, string>,
} as const;

// HEIF's "ftyp" box names its brand at bytes 8–11. AVIF shares the box, so its own
// brands are left out; it opens in every current browser anyway.
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);
const IMAGE_MAGIC: number[][] = [
  [0xff, 0xd8, 0xff], // JPEG
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x42, 0x4d], // BMP
];
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/**
 * Why a picked file couldn't be opened, from its first bytes, its name and the browser's label.
 * Only asked after decoding failed, so a browser that can open HEIC never gets here with one.
 */
export function photoProblem(file: { name: string; type: string }, head: Uint8Array): PhotoProblem {
  const heif = head.length >= 12 && ascii(head, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(head, 8, 12));
  if (heif || /^image\/hei[cf](-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return "heic";
  const looksImage =
    IMAGE_MAGIC.some((m) => m.every((v, i) => head[i] === v)) ||
    (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") ||
    (head.length >= 12 && ascii(head, 4, 8) === "ftyp");
  if (!looksImage && !file.type.startsWith("image/")) return "not_image";
  return "unreadable";
}

/**
 * A ref for the line saying why a photo couldn't be used. It appears under the control that was
 * tapped, which can sit on the phone's tab bar, so it scrolls just into view; its scroll margin
 * (PROBLEM_CLEARANCE) keeps it above the bar. Defined once, so it runs once per message.
 */
export function revealProblem(el: HTMLElement | null) {
  if (!el) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
}
/** The tab bar (3.5rem plus the home-indicator inset) and a little air; laptops have no bar there. */
export const PROBLEM_CLEARANCE = "scroll-mb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:scroll-mb-4";

/**
 * The picked file as a JPEG at most MEAL_PHOTO_EDGE on its long edge. Always re-encoded,
 * even when that comes out a little bigger, so no metadata (where or when it was taken)
 * leaves the phone. Screenshots and PNGs come out the same way, on white.
 */
export async function readMealPhoto(file: File): Promise<{ file: File } | { problem: PhotoProblem }> {
  try {
    return { file: await shrinkImage(file, MEAL_PHOTO_EDGE, MEAL_PHOTO_QUALITY, { keepSmaller: false }) };
  } catch {
    const head = await file
      .slice(0, 16)
      .arrayBuffer()
      .then((b) => new Uint8Array(b))
      .catch(() => new Uint8Array());
    return { problem: photoProblem(file, head) };
  }
}
