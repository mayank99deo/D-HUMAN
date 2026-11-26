// What a blood report upload may be (app/api/reports/route.ts checks it; GET /api/upload tells
// the apps). Files are checked by their bytes, not their names: PDF, JPEG, PNG or WebP.
export const REPORT_UPLOAD = {
  maxFiles: 6,
  maxTotalBytes: 4 * 1024 * 1024,
  types: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
} as const;
