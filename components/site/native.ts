import type { CSSProperties } from "react";

// Indian scripts on the landing page, in the phone's own fonts.
//
// The app's Hindi font (Anek Devanagari, app/layout.tsx) ships its Devanagari
// subset as one 726 KB variable file, and it sits in the default font stack. Its
// range covers the Devanagari block, which includes the danda (।) that Bengali
// uses as its full stop, so Hindi, Marathi or Bengali set normally make every
// visitor download it. Those get stacks without it: Latin letters inside (marker
// names) stay in Archivo, the script comes from the system (Kohinoor or Sangam on
// Apple, Noto Sans on Android, Nirmala UI on Windows). Other scripts (Tamil,
// Telugu and the rest) aren't covered by any web font on the site, so they
// already fall through to the system and need nothing.
const SYSTEM: Record<string, string> = {
  deva: '"Kohinoor Devanagari", "Devanagari Sangam MN", "Noto Sans Devanagari", "Nirmala UI", Mangal',
  beng: '"Kohinoor Bangla", "Bangla Sangam MN", "Noto Sans Bengali", "Nirmala UI", Vrinda',
};
const SCRIPT_OF: Record<string, keyof typeof SYSTEM> = { hi: "deva", mr: "deva", bn: "beng" };

/** Inline style for text in this language, or undefined when the default stack is fine. */
export function nativeStyle(lang?: string): CSSProperties | undefined {
  const script = lang ? SCRIPT_OF[lang] : undefined;
  return script ? { fontFamily: `var(--font-archivo), ${SYSTEM[script]}, sans-serif` } : undefined;
}
