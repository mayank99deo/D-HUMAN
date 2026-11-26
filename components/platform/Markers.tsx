import type { Marker } from "@/lib/db/schema";
import { markerDef, type MarkerStatus } from "@/lib/domain/markers";
import { ASK_COPY } from "./ask-copy";
import { askAboutMarker, markerPrefill } from "./ask-starters";
import { AskAbout } from "./AskAbout";
import { fmt, rangeText, statusGlyph, statusWords } from "@/lib/domain/marker-text";

// Range rails and marker tiles. The band is the lab's range; the pin is you. The words and
// numbers come from lib/domain/marker-text.ts, which the apps' view builders use too.

export { rangeText, statusGlyph, statusWords };

const PIN: Record<string, string> = {
  in_range: "var(--color-serum)",
  edge_low: "var(--color-straw)",
  edge_high: "var(--color-straw)",
  low: "var(--color-haem)",
  high: "var(--color-haem)",
};

export function RangeRail({ value, low, high, status, className = "" }: { value: number | null; low: number | null; high: number | null; status: string; className?: string }) {
  if (value == null || (low == null && high == null)) return <div className={`h-6 ${className}`} aria-hidden />;
  // The visible scale: the band in the middle third, with room either side.
  let min: number;
  let max: number;
  if (low != null && high != null) {
    const span = high - low || Math.abs(high) || 1;
    min = low - span;
    max = high + span;
  } else if (high != null) {
    min = 0;
    max = high * 2;
  } else {
    min = 0;
    max = (low as number) * 2.5;
  }
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const a = low != null ? pct(low) : 0;
  const b = high != null ? pct(high) : 100;
  const p = pct(value);
  return (
    <div className={`relative h-6 ${className}`} aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
      <div className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-paper/30" style={{ left: `${a}%`, width: `${Math.max(1, b - a)}%` }} />
      <div className="absolute top-0 h-6 w-[3px] -translate-x-1/2" style={{ left: `${p}%`, background: PIN[status] ?? "var(--color-graphite)" }} />
    </div>
  );
}

export function Trend({ now, before }: { now: number | null; before?: number }) {
  if (now == null || before == null || before === now) return null;
  const up = now > before;
  return (
    <span className="text-sm text-graphite">
      <span aria-hidden>{up ? "↑" : "↓"}</span> from {fmt(before)}
    </span>
  );
}

/** "Ask about this" for a marker that's out of range, at the edge or flagged, when Ask is open to the person. */
function AskAboutMarker({ m, name, className = "" }: { m: Marker; name: string; className?: string }) {
  if (!askAboutMarker(m)) return null;
  return <AskAbout prefill={markerPrefill({ id: m.id, name, status: m.status as MarkerStatus, flag: m.flag })} label={ASK_COPY.aboutThis} className={className} />;
}

export function MarkerTile({ m, note, before, size = "lg", ask = false }: { m: Marker; note?: string; before?: number; size?: "lg" | "sm"; ask?: boolean }) {
  const def = markerDef(m.key);
  const name = def?.name ?? m.name;
  const value = m.value != null ? fmt(m.value) : m.valueText ?? "–";
  return (
    <article className={`flex flex-col border-t border-line ${size === "lg" ? "gap-3 py-6" : "gap-2 py-4"}`}>
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{name}</h3>
        <span className="flex items-center gap-2 text-sm text-graphite">
          <span className={`glyph ${statusGlyph(m.status)}`} aria-hidden />
          {statusWords(m.status)}
          {m.flag && <span className="error-mark font-semibold text-paper">{m.flag === "urgent" ? "Get advice today" : "Show a doctor"}</span>}
        </span>
      </header>
      <div className="flex items-end gap-2">
        <span className={`display-num ${size === "lg" ? "text-[clamp(3rem,10vw,4.5rem)]" : "text-4xl"}`}>{value}</span>
        <span className="pb-1 text-graphite">{m.unit}</span>
        <span className="ml-auto pb-1">
          <Trend now={m.value} before={before} />
        </span>
      </div>
      <RangeRail value={m.value} low={m.refLow} high={m.refHigh} status={m.status} />
      <p className="text-sm text-graphite">Range {rangeText(m)}</p>
      {note && <p className="max-w-prose text-[0.9375rem] leading-relaxed">{note}</p>}
      {ask && <AskAboutMarker m={m} name={name} className="-mt-2 self-start" />}
    </article>
  );
}

export function MarkerRow({ m, note, ask = false }: { m: Marker; note?: string; ask?: boolean }) {
  const def = markerDef(m.key);
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 border-t border-line py-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
      <span className="flex items-center gap-2 font-semibold">
        <span className={`glyph ${statusGlyph(m.status)}`} aria-hidden />
        <span className="sr-only">{statusWords(m.status)}: </span>
        {def?.name ?? m.name}
      </span>
      <RangeRail value={m.value} low={m.refLow} high={m.refHigh} status={m.status} className="order-3 col-span-2 sm:order-none sm:col-span-1" />
      <span className="text-right">
        <span className="font-bold semiwide">{m.value != null ? fmt(m.value) : m.valueText}</span> <span className="text-sm text-graphite">{m.unit}</span>
      </span>
      <span className="order-4 col-span-2 text-sm text-graphite sm:col-span-3">
        {statusWords(m.status)}, range {rangeText(m)}
        {m.flag && <span className="error-mark ml-2 font-semibold text-paper">{m.flag === "urgent" ? "Get medical advice today" : "Worth showing a doctor"}</span>}
        {note && <span className="mt-1 block text-paper/85">{note}</span>}
      </span>
      {ask && <AskAboutMarker m={m} name={def?.name ?? m.name} className="order-5 col-span-2 justify-self-start sm:col-span-3" />}
    </li>
  );
}

export { fmt };
