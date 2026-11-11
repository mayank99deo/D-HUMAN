import type { ReactNode } from "react";

// Devanagari on the landing page, in the phone's own Devanagari font.
//
// The app's Hindi font (Anek Devanagari, app/layout.tsx) ships its Devanagari
// subset as one 726 KB variable file. Any Devanagari set in the default font
// stack makes every visitor download it, nearly tripling the page's weight. A
// few lines of Hindi here don't justify that, so they skip Anek: Latin letters
// inside them (marker names) stay in Archivo, Devanagari comes from the system
// (Kohinoor on Apple, Noto Sans on Android, Nirmala UI on Windows).
const STACK =
  'var(--font-archivo), "Kohinoor Devanagari", "Devanagari Sangam MN", "Noto Sans Devanagari", "Nirmala UI", Mangal, sans-serif';

export function Hindi({ children, as: Tag = "span", className }: { children: ReactNode; as?: "span" | "p"; className?: string }) {
  return (
    <Tag lang="hi" className={className} style={{ fontFamily: STACK }}>
      {children}
    </Tag>
  );
}
