// Small display rules for blog pages: dates, reading time and Devanagari titles. Pure.

import type { CSSProperties } from "react";
import { nativeStyle } from "@/components/site/native";
import { istDateTime } from "@/lib/seo";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

/** "14 November 2026", as the date fell in India. */
export const formatDate = (iso: string) => DATE.format(new Date(iso));

/** The same day for <time dateTime>, matching the structured data's India time zone. */
export const dayInIndia = (iso: string) => istDateTime(iso).slice(0, 10);

export const readingTime = (minutes: number) => `${minutes} minute read`;

const isDevanagari = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return c >= 0x900 && c <= 0x97f;
};

/**
 * Posts are English for now, but a title may be written in Hindi. Devanagari text is marked
 * lang="hi" (screen readers, line height) and set in the phone's own font, never the 726 KB
 * Anek file (components/site/native.ts).
 */
export function scriptOf(text: string): { lang?: "hi"; style?: CSSProperties } {
  return Array.from(text).some(isDevanagari) ? { lang: "hi", style: nativeStyle("hi") } : {};
}
