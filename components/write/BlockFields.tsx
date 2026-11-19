"use client";

import { useState } from "react";
import { GUIDES } from "@/lib/seo";
import type { EditorImage } from "@/lib/blog/image-store";
import { BLOG_LIMITS, TRY_IT_DESTINATIONS, type Block, type Source, type Span } from "@/lib/blog/types";
import { TRY_IT } from "./labels";
import type { PasteResult } from "./paste";
import { PhotoField } from "./PhotoField";
import { RichText, type FocusAt } from "./RichText";

// The fields of one block. Every field has a hard limit matching lib/blog/checks.ts, so
// what the author types always saves.

type Props<B extends Block> = {
  block: B;
  onChange: (b: Block) => void;
  sources: readonly Source[];
  images: Readonly<Record<string, EditorImage>>;
  onImage: (img: EditorImage) => void;
  focusAt: FocusAt;
  onEnter: (after: Span[]) => void;
  onBackspaceEmpty: () => void;
  onPasteBlocks: (r: PasteResult) => void;
};

const fieldLabel = "mb-1.5 block text-sm text-graphite";

function Counter({ value, max, warnFrom }: { value: string; max: number; warnFrom?: number }) {
  const over = warnFrom !== undefined && value.length > warnFrom;
  return <span className={`text-xs ${over ? "error-mark" : "text-graphite"}`}>{`${value.length}/${max}`}</span>;
}

function SourcePicker({ value, sources, onChange, optional }: { value: string | undefined; sources: readonly Source[]; onChange: (id: string) => void; optional?: boolean }) {
  return (
    <label className="block">
      <span className={fieldLabel}>Source {optional ? "(needed when it holds numbers)" : ""}</span>
      <select className="field h-12" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{sources.length ? "Pick a source" : "Add a source under Sources first"}</option>
        {sources.map((s, i) => (
          <option key={s.id} value={s.id}>
            {`Source ${i + 1}: ${s.name || "untitled"}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BlockFields(props: Props<Block>) {
  const { block, onChange } = props;
  switch (block.type) {
    case "paragraph":
    case "doctor":
      return (
        <>
          {block.type === "doctor" && <p className="mb-2 text-sm font-semibold">Worth showing a doctor (fixed title). Say when, never what the reader has.</p>}
          <RichText
            spans={block.spans}
            label={block.type === "doctor" ? "Worth showing a doctor" : "Paragraph"}
            placeholder={block.type === "paragraph" ? "Write, or paste from Google Docs…" : "If this sounds like you, it's worth showing a doctor…"}
            onChange={(spans) => onChange({ ...block, spans })}
            onEnter={block.type === "paragraph" ? props.onEnter : undefined}
            onBackspaceEmpty={props.onBackspaceEmpty}
            onPasteBlocks={props.onPasteBlocks}
            focusAt={props.focusAt}
          />
        </>
      );
    case "note":
      return (
        <div className="space-y-2">
          <input className="field h-12 font-semibold" maxLength={100} value={block.title ?? ""} placeholder="Note title (optional)" aria-label="Note title" onChange={(e) => onChange({ ...block, title: e.target.value })} />
          <RichText spans={block.spans} label="Note" onChange={(spans) => onChange({ ...block, spans })} onBackspaceEmpty={props.onBackspaceEmpty} focusAt={props.focusAt} />
        </div>
      );
    case "heading":
      return (
        <div className="flex gap-2">
          <select className="field h-12 w-24 shrink-0" value={block.level} aria-label="Heading level" onChange={(e) => onChange({ ...block, level: e.target.value === "3" ? 3 : 2 })}>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <input
            className={`field h-12 min-w-0 flex-1 font-bold ${block.level === 2 ? "text-xl" : "text-lg"}`}
            maxLength={200}
            value={block.text}
            placeholder="Heading"
            aria-label="Heading"
            autoFocus={!!props.focusAt}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !block.text) {
                e.preventDefault();
                props.onBackspaceEmpty();
              }
            }}
          />
        </div>
      );
    case "list":
      return <ListFields block={block} onChange={onChange} />;
    case "photo":
      return (
        <div className="space-y-3">
          <PhotoField
            image={props.images[block.imageId]}
            label="Add a photo"
            onImage={(img) => {
              props.onImage(img);
              onChange({ ...block, imageId: img.id });
            }}
            onMeta={props.onImage}
          />
          <PhotoWords value={block} onChange={(w) => onChange({ ...block, ...w })} needsCredit={props.images[block.imageId]?.ownRights === false} />
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-white" checked={!!block.wide} onChange={(e) => onChange({ ...block, wide: e.target.checked || undefined })} />
            Wide on laptops
          </label>
        </div>
      );
    case "quote":
      return (
        <div className="space-y-2">
          <textarea className="textarea text-lg font-bold" maxLength={500} value={block.text} placeholder="A line from this post, or from a named person who agreed" aria-label="Pull quote" onChange={(e) => onChange({ ...block, text: e.target.value })} />
          <input className="field h-12" maxLength={120} value={block.attribution ?? ""} placeholder="Who said it (optional)" aria-label="Who said it" onChange={(e) => onChange({ ...block, attribution: e.target.value })} />
        </div>
      );
    case "keyNumber":
      return (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label>
            <span className={fieldLabel}>Number</span>
            <input className="field h-12 text-xl font-bold" maxLength={24} value={block.value} placeholder="76%" onChange={(e) => onChange({ ...block, value: e.target.value })} />
          </label>
          <label>
            <span className={fieldLabel}>What it means, in one line</span>
            <input className="field h-12" maxLength={200} value={block.label} placeholder="of people tested were low in vitamin D" onChange={(e) => onChange({ ...block, label: e.target.value })} />
          </label>
          <div className="sm:col-span-2">
            <SourcePicker value={block.sourceId} sources={props.sources} onChange={(sourceId) => onChange({ ...block, sourceId })} />
          </div>
        </div>
      );
    case "tryIt":
      return (
        <div className="space-y-3">
          <label className="block">
            <span className={fieldLabel}>Where it goes</span>
            <select
              className="field h-12"
              value={block.destination}
              onChange={(e) => {
                const destination = e.target.value as (typeof TRY_IT_DESTINATIONS)[number];
                const wasDefault = !block.line || Object.values(TRY_IT).some((t) => t.line === block.line);
                onChange({ ...block, destination, line: wasDefault ? TRY_IT[destination].line : block.line });
              }}
            >
              {TRY_IT_DESTINATIONS.map((d) => (
                <option key={d} value={d}>
                  {TRY_IT[d].label}
                </option>
              ))}
            </select>
          </label>
          {block.destination === "guide" && (
            <label className="block">
              <span className={fieldLabel}>Which guide</span>
              <select
                className="field h-12"
                value={block.guidePath ?? ""}
                onChange={(e) => {
                  const g = GUIDES.find((x) => x.path === e.target.value);
                  onChange({ ...block, guidePath: g?.path, line: block.line || g?.blurb || "" });
                }}
              >
                <option value="">Pick a guide</option>
                {GUIDES.map((g) => (
                  <option key={g.path} value={g.path}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className={`${fieldLabel} flex justify-between`}>
              <span>The line above the button</span>
              <Counter value={block.line} max={BLOG_LIMITS.tryItLineMax} />
            </span>
            <input className="field h-12" maxLength={BLOG_LIMITS.tryItLineMax} value={block.line} onChange={(e) => onChange({ ...block, line: e.target.value })} />
          </label>
          <p className="text-sm text-graphite">Button: {TRY_IT[block.destination].button}. In waitlist mode it becomes Join the waitlist.</p>
        </div>
      );
    case "table":
      return <TableFields block={block} onChange={onChange} sources={props.sources} />;
  }
}

/** Alt text (required), caption and credit, shared by photo blocks and the cover. */
export function PhotoWords({
  value,
  onChange,
  needsCredit,
}: {
  value: { alt: string; caption?: string; credit?: string };
  onChange: (w: { alt: string; caption?: string; credit?: string }) => void;
  needsCredit: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className={fieldLabel}>Describe the photo for someone who can&apos;t see it (required)</span>
        <input className="field h-12" maxLength={300} value={value.alt} aria-invalid={!value.alt.trim()} onChange={(e) => onChange({ ...value, alt: e.target.value })} />
      </label>
      <label className="block">
        <span className={fieldLabel}>Caption (optional)</span>
        <input className="field h-12" maxLength={300} value={value.caption ?? ""} onChange={(e) => onChange({ ...value, caption: e.target.value || undefined })} />
      </label>
      <label className="block">
        <span className={fieldLabel}>{needsCredit ? "Credit (required): name, licence, source" : "Credit (optional)"}</span>
        <input
          className="field h-12"
          maxLength={200}
          value={value.credit ?? ""}
          aria-invalid={needsCredit && !value.credit?.trim()}
          placeholder="Photo: name, licence, source"
          onChange={(e) => onChange({ ...value, credit: e.target.value || undefined })}
        />
      </label>
    </div>
  );
}

function ListFields({ block, onChange }: { block: Extract<Block, { type: "list" }>; onChange: (b: Block) => void }) {
  // Item fields hold their own text while typed, so removing one redraws them all.
  const [generation, setGeneration] = useState(0);
  const setItem = (i: number, spans: Span[]) => onChange({ ...block, items: block.items.map((it, j) => (j === i ? spans : it)) });
  return (
    <div className="space-y-2">
      <div className="flex gap-2" role="radiogroup" aria-label="List style">
        {[
          [false, "Bullets"],
          [true, "Numbers"],
        ].map(([ordered, label]) => (
          <label key={String(label)} className="choice">
            <input type="radio" className="sr-only" checked={block.ordered === ordered} onChange={() => onChange({ ...block, ordered: ordered as boolean })} />
            {label}
          </label>
        ))}
      </div>
      <ol className="space-y-2">
        {block.items.map((item, i) => (
          <li key={`${generation}:${i}`} className="flex items-start gap-2">
            <span aria-hidden className="mt-3.5 w-6 shrink-0 text-right text-sm text-graphite">
              {block.ordered ? `${i + 1}.` : "▪"}
            </span>
            <RichText spans={item} label={`Item ${i + 1}`} className="min-w-0 flex-1" onChange={(spans) => setItem(i, spans)} />
            <button
              type="button"
              className="button-ghost h-12 shrink-0 px-3"
              aria-label={`Remove item ${i + 1}`}
              disabled={block.items.length === 1}
              onClick={() => {
                setGeneration((g) => g + 1);
                onChange({ ...block, items: block.items.filter((_, j) => j !== i) });
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
      {block.items.length < 50 && (
        <button type="button" className="link-quiet min-h-11 text-sm" onClick={() => onChange({ ...block, items: [...block.items, []] })}>
          Add an item
        </button>
      )}
    </div>
  );
}

function TableFields({ block, onChange, sources }: { block: Extract<Block, { type: "table" }>; onChange: (b: Block) => void; sources: readonly Source[] }) {
  const cols = block.header.length;
  const setCell = (r: number, c: number, v: string) => onChange({ ...block, rows: block.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  return (
    <div className="space-y-3">
      <label className="block">
        <span className={fieldLabel}>Caption (required)</span>
        <input className="field h-12" maxLength={200} value={block.caption} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
      </label>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <thead>
            <tr>
              {block.header.map((h, c) => (
                <th key={c} className="p-1">
                  <input className="field h-11 font-semibold" maxLength={60} value={h} placeholder={`Column ${c + 1}`} aria-label={`Column ${c + 1} heading`} onChange={(e) => onChange({ ...block, header: block.header.map((x, j) => (j === c ? e.target.value : x)) })} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="p-1">
                    <input className="field h-11" maxLength={120} value={cell} aria-label={`Row ${r + 1}, column ${c + 1}`} onChange={(e) => setCell(r, c, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4">
        {block.rows.length < BLOG_LIMITS.tableRowsMax && (
          <button type="button" className="link-quiet min-h-11 text-sm" onClick={() => onChange({ ...block, rows: [...block.rows, Array(cols).fill("")] })}>
            Add a row
          </button>
        )}
        {block.rows.length > 1 && (
          <button type="button" className="link-quiet min-h-11 text-sm" onClick={() => onChange({ ...block, rows: block.rows.slice(0, -1) })}>
            Remove the last row
          </button>
        )}
        {cols < BLOG_LIMITS.tableColsMax && (
          <button type="button" className="link-quiet min-h-11 text-sm" onClick={() => onChange({ ...block, header: [...block.header, ""], rows: block.rows.map((r) => [...r, ""]) })}>
            Add a column
          </button>
        )}
        {cols > 1 && (
          <button type="button" className="link-quiet min-h-11 text-sm" onClick={() => onChange({ ...block, header: block.header.slice(0, -1), rows: block.rows.map((r) => r.slice(0, -1)) })}>
            Remove the last column
          </button>
        )}
      </div>
      <SourcePicker value={block.sourceId} sources={sources} optional onChange={(sourceId) => onChange({ ...block, sourceId: sourceId || undefined })} />
    </div>
  );
}

/** A new block of a type, with sensible empty content. */
export function newBlock(type: Block["type"], id: string): Block {
  switch (type) {
    case "paragraph":
    case "doctor":
      return { id, type, spans: [] };
    case "note":
      return { id, type, spans: [] };
    case "heading":
      return { id, type, level: 2, text: "" };
    case "list":
      return { id, type, ordered: false, items: [[]] };
    case "photo":
      return { id, type, imageId: "", alt: "" };
    case "quote":
      return { id, type, text: "" };
    case "keyNumber":
      return { id, type, value: "", label: "", sourceId: "" };
    case "tryIt":
      return { id, type, destination: "fuel", line: TRY_IT.fuel.line };
    case "table":
      return { id, type, caption: "", header: ["", ""], rows: [["", ""]] };
  }
}
