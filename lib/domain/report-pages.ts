// A report read from only some of its pages (G10). An app can send at most 6 page photos of a PDF
// over 4 MB, so a 24-page report may be read from 6 of them; the upload keeps { sent, of } in
// reports.pages. Such a read must never pass for a complete one, so:
// - the read's request gets one line saying so (partReadLine in lib/ai/report.ts);
// - code starts the read's summary with "Read from 6 of 24 pages." (withPagesNote), whatever the
//   model writes. It's fixed English, like the safety floor's doctor wording, until Hindi and
//   Hinglish versions are reviewed.
// The verdict isn't touched here: the safety floor in code stays the authority, and a cap for
// part-read reports is Mayank's call. Pure: used by the read and by tests.

export type PartPages = { sent: number; of: number };

/** The pages, when the report was read from fewer pages than it has; otherwise null. */
export function partRead(pages: unknown): PartPages | null {
  if (!pages || typeof pages !== "object") return null;
  const { sent, of } = pages as Record<string, unknown>;
  if (typeof sent !== "number" || typeof of !== "number") return null;
  if (!Number.isInteger(sent) || !Number.isInteger(of) || sent < 1 || sent >= of || of > 500) return null;
  return { sent, of };
}

/** "Read from 6 of 24 pages." */
export const pagesNote = (p: PartPages) => `Read from ${p.sent} of ${p.of} pages.`;

/** The summary, starting with the page count when the report was part-read; otherwise as written. */
export function withPagesNote(summary: string, pages: unknown): string {
  const p = partRead(pages);
  if (!p) return summary;
  const note = pagesNote(p);
  return summary.startsWith(note) ? summary : `${note} ${summary}`;
}
