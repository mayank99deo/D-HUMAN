import type { Marker } from "@/lib/db/schema";

// A marker's words and numbers as the screens show them: the value, its status, its range.
// Plain functions, so the server's view builders (lib/platform/views) give the apps the same
// words the web's marker tiles show. Markers.tsx re-exports them unchanged.

/** One point of the contour fingerprint (components/platform/Contour.tsx draws them). */
export type ContourMarker = {
  id: string;
  short: string;
  name: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  low: number | null;
  high: number | null;
  status: string;
  range: string;
};

export const fmt = (n: number | null | undefined) =>
  n == null ? "" : Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-IN") : String(+n.toFixed(n % 1 === 0 ? 0 : Math.abs(n) < 10 ? 2 : 1));

export function statusGlyph(status: string) {
  if (status === "in_range") return "glyph-in";
  if (status === "edge_low" || status === "edge_high") return "glyph-edge";
  if (status === "low" || status === "high") return "glyph-out";
  return "glyph-unknown";
}

export function statusWords(status: string) {
  return (
    {
      in_range: "In range",
      edge_low: "Low end of range",
      edge_high: "High end of range",
      low: "Below range",
      high: "Above range",
      unknown: "No range printed",
    }[status] ?? "No range printed"
  );
}

export function rangeText(m: Pick<Marker, "refLow" | "refHigh" | "refText" | "rangeSource">) {
  const r =
    m.refLow != null && m.refHigh != null
      ? `${fmt(m.refLow)}–${fmt(m.refHigh)}`
      : m.refLow != null
        ? `above ${fmt(m.refLow)}`
        : m.refHigh != null
          ? `below ${fmt(m.refHigh)}`
          : m.refText || "no range printed";
  if (m.rangeSource === "derived") return `${r} (typical range; calculated from your results)`;
  return m.rangeSource === "catalog" ? `${r} (typical range)` : r;
}
