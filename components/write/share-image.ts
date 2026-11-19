// The post's share image (what WhatsApp and search show), drawn in the author's browser
// at Publish and uploaded like a photo. A browser shapes Devanagari correctly, which
// next/og's renderer doesn't (graphic designer, 2026-11-18). Layout follows the site's
// share image: the wordmark top left, the topic in graphite, the title in Archivo set
// wide, bottom left, at most three lines. JPEGs at every SHARE_IMAGE_SIZES size: "og"
// (1200 × 630) for link previews, 16:9, 4:3 and 1:1 for Article markup.

import { WORDMARK } from "@/components/brand/paths";
import { TOPIC_LABELS } from "@/lib/blog/checks";
import { SHARE_IMAGE_SIZES, type BlogTopic, type ShareImageKind } from "@/lib/blog/types";

const PAD = 72;

/** Title size by length (graphic designer): Latin 92/76/62/52 px, Devanagari 84/68/56. */
function titleSize(title: string): number {
  const devanagari = /[\u0900-\u097f]/.test(title);
  const n = title.length;
  if (devanagari) return n <= 28 ? 84 : n <= 48 ? 68 : 56;
  return n <= 28 ? 92 : n <= 48 ? 76 : n <= 72 ? 62 : 52;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.replace(/\s*\S+$/, "");
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/** The family next/font gave Archivo, so the canvas uses the same font as the page. */
function archivoFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-archivo").trim();
  return v || "Archivo, system-ui, sans-serif";
}

/** Every size, link preview first; empty when this browser can't draw them (pages then use the site's image). */
export async function drawShareImages(title: string, topic: BlogTopic | null): Promise<Blob[]> {
  if (typeof document === "undefined") return [];
  const family = archivoFamily();
  try {
    await Promise.all([document.fonts.load(`800 ${titleSize(title)}px ${family}`, title), document.fonts.load(`600 30px ${family}`)]);
  } catch {
    /* draw with whatever is loaded */
  }
  const blobs: Blob[] = [];
  for (const kind of Object.keys(SHARE_IMAGE_SIZES) as ShareImageKind[]) {
    const blob = await drawOne(title, topic, family, SHARE_IMAGE_SIZES[kind]);
    if (!blob) return kind === "og" ? [] : blobs;
    blobs.push(blob);
  }
  return blobs;
}

async function drawOne(title: string, topic: BlogTopic | null, family: string, { width: W, height: H }: { width: number; height: number }): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const size = titleSize(title);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  // The wordmark, 256 px wide.
  const [vx, vy, vw] = WORDMARK.viewBox.split(" ").map(Number);
  const scale = 256 / vw;
  ctx.save();
  ctx.translate(PAD, 72);
  ctx.scale(scale, scale);
  ctx.translate(-vx, -vy);
  ctx.fillStyle = "#fff";
  ctx.fill(new Path2D(WORDMARK.path));
  ctx.restore();

  // Set wide where the browser can (Chrome, Edge); elsewhere Archivo at its normal width.
  const wide = ctx as CanvasRenderingContext2D & { fontStretch?: string };
  if ("fontStretch" in wide) wide.fontStretch = "semi-expanded";

  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${size}px ${family}`;
  const lines = wrap(ctx, title, W - PAD * 2, 3);
  const lineHeight = Math.round(size * (/[\u0900-\u097f]/.test(title) ? 1.3 : 1.05));
  let y = H - PAD - (lines.length - 1) * lineHeight;
  if (topic) {
    ctx.font = `600 30px ${family}`;
    ctx.fillStyle = "#8c8c8c";
    ctx.fillText(TOPIC_LABELS[topic], PAD, y - size - 28);
  }
  ctx.font = `800 ${size}px ${family}`;
  ctx.fillStyle = "#fff";
  for (const line of lines) {
    ctx.fillText(line, PAD, y);
    y += lineHeight;
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b && b.type === "image/jpeg" ? b : null), "image/jpeg", 0.86));
}
