// Words the editor shows: block names, the Try it lines and buttons (product designer
// §2.6), and what upload errors mean. Shared by the editor and the preview.

import { TRY_IT_COPY } from "@/lib/blog/blocks";
import { TRY_IT_DESTINATIONS, type BlockType, type TryItDestination } from "@/lib/blog/types";

export const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: "Paragraph",
  heading: "Heading",
  list: "List",
  photo: "Photo",
  quote: "Pull quote",
  note: "Note",
  doctor: "Worth showing a doctor",
  keyNumber: "Key number",
  tryIt: "Try it",
  table: "Table",
};

/** The order of the "Add" menu: the everyday blocks first. */
export const BLOCK_MENU: BlockType[] = ["paragraph", "heading", "list", "photo", "quote", "note", "doctor", "keyNumber", "tryIt", "table"];

const TRY_IT_LABELS: Record<TryItDestination, string> = { fuel: "Fuel", upload: "Upload", stack: "Stack", wraps: "Wraps", start: "Start free", guide: "A guide" };

/** Where a Try it goes, in the editor's menu, with the reader's own line and button (lib/blog/blocks.ts). */
export const TRY_IT = Object.fromEntries(
  TRY_IT_DESTINATIONS.map((d) => [d, { label: TRY_IT_LABELS[d], line: TRY_IT_COPY[d].line, button: TRY_IT_COPY[d].button }]),
) as Record<TryItDestination, { label: string; line: string; button: string }>;

export const UPLOAD_ERRORS: Record<string, string> = {
  unsupported: "This photo type isn't supported. Save it as JPEG and try again.",
  unsupported_type: "This photo type isn't supported. Save it as JPEG and try again.",
  too_large: "This photo is too large even after shrinking. Try a smaller one.",
  metadata: "This photo still carries camera data. Add it again from this screen.",
  bad_widths: "This photo is too small to use. Pick one at least 200 pixels wide.",
  bad_shape: "This photo is too tall or too wide. Crop it closer to 3:2 and try again.",
  offline: "Photo didn't upload. Check your connection, then Retry.",
  default: "Photo didn't upload. Retry.",
};
