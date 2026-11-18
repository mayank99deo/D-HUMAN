import type { CSSProperties, ReactNode } from "react";
import type { PublicAuthor } from "@/lib/blog/types";
import { BlogImage } from "./BlogImage";

// Who wrote it: a square avatar with the logo's cut corner (the notch of the D), the name,
// and one quiet line under it. A real photo, in black and white, or the initials.

const CUT: CSSProperties = { clipPath: "polygon(6px 0, 100% 0, 100% 100%, 0 100%, 0 6px)" };

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();

export function Avatar({ author, size = 40 }: { author: PublicAuthor; size?: 32 | 40 | 96 }) {
  const box: CSSProperties = { ...CUT, width: size, height: size };
  if (author.photo) {
    return (
      <span className="relative block shrink-0 overflow-hidden bg-lift" style={box}>
        <BlogImage image={author.photo} alt="" sizes={`${size}px`} />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`semiwide grid shrink-0 place-items-center bg-lift font-bold text-paper ${size > 40 ? "text-3xl" : "text-xs"}`} style={box}>
      {initials(author.name)}
    </span>
  );
}

/** Avatar, name, and a line under it (a date and reading time, or a role). */
export function AuthorChip({ author, line, size = 40, tone = "ink" }: { author: PublicAuthor; line?: ReactNode; size?: 32 | 40; tone?: "ink" | "paper" }) {
  return (
    <span className="flex items-center gap-3">
      <Avatar author={author} size={size} />
      <span className="min-w-0">
        <span className="block text-[0.9375rem] leading-[1.3] font-semibold">{author.name}</span>
        {line && <span className={`block text-sm leading-[1.35] ${tone === "paper" ? "text-smoke" : "text-graphite"}`}>{line}</span>}
      </span>
    </span>
  );
}
