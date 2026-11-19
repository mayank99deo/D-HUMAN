"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OFFLINE, send } from "@/components/platform/net";
import { slugify } from "@/lib/blog/checks";
import { BLOG_LIMITS, type Block } from "@/lib/blog/types";
import { BLOCK_LABELS, blockCount, droppedWords } from "./labels";
import { blocksFromClipboard, blocksFromText, newBlockId, type PasteResult } from "./paste";

// Stage 0 (Mayank, 2026-11-18): paste a whole Google Doc and get a draft with its
// headings, bold, italic, links and lists, so the first posts go in before the editor is
// polished. Converted here in the browser; the server checks the blocks again on save.

function preview(b: Block): string {
  switch (b.type) {
    case "paragraph":
    case "doctor":
    case "note":
      return b.spans.map((s) => s.text).join("");
    case "list":
      return b.items.map((i) => i.map((s) => s.text).join("")).join(" · ");
    case "heading":
    case "quote":
      return b.text;
    default:
      return "";
  }
}

export function ImportPaste() {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<PasteResult | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function take(r: PasteResult | null) {
    if (!r || (!r.blocks.length && !r.title)) return setError("Nothing to bring in. Copy the document's text and paste again.");
    setError(null);
    setResult(r);
    if (r.title) setTitle(r.title.slice(0, BLOG_LIMITS.titleMax));
  }

  async function create() {
    if (!result) return;
    setBusy(true);
    setError(null);
    const r = await send<{ id: string; issues: string[] }>("/api/write/posts", { body: { draft: { title: title.trim(), blocks: result.blocks, slug: slugify(title) } } });
    if (r.ok && r.data.id) return router.push(`/write/${r.data.id}`);
    setBusy(false);
    setError(r.offline ? OFFLINE : r.status === 422 ? `Couldn't bring this in: ${r.data.issues?.[0] ?? "something isn't allowed"}.` : "Couldn't create the draft. Try again.");
  }

  const counts = result
    ? Object.entries(
        result.blocks.reduce<Record<string, number>>((acc, b) => {
          acc[b.type] = (acc[b.type] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([type, n]) => blockCount(type as Block["type"], n))
    : [];
  const left = result
    ? [
        droppedWords(result.dropped).images,
        result.dropped.tables && "tables came in as plain lines: rebuild them as Table blocks",
        droppedWords(result.dropped).links,
        result.dropped.cut && "text past the length limits",
      ].filter(Boolean)
    : [];

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-20 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Import</h1>
      <p className="mt-3 max-w-prose text-graphite">
        In Google Docs, select everything (Ctrl+A or ⌘A), copy it, and paste it below. Headings, bold, italic, links and lists come across; fonts, colours and images don&apos;t.
      </p>

      {!result ? (
        <div className="mt-8">
          <label htmlFor="paste" className="mb-2 block text-sm font-semibold">
            Paste here
          </label>
          <textarea
            id="paste"
            className="textarea min-h-56"
            placeholder="Paste the document…"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              take(blocksFromClipboard(e.clipboardData));
            }}
          />
          {typed.trim() && (
            <button type="button" className="button-ghost mt-3 h-12" onClick={() => take(blocksFromText(typed, newBlockId))}>
              Use this text
            </button>
          )}
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Title</span>
            <input className="field h-12 text-lg font-semibold" maxLength={BLOG_LIMITS.titleMax} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The post's title" />
            {!result.title && <span className="mt-1.5 block text-sm text-graphite">No title found in the document. Write one here or in the editor.</span>}
          </label>
          <div>
            <p className="font-semibold">Found {counts.join(", ") || "no text"}.</p>
            {left.length > 0 && <p className="mt-1 text-sm text-graphite">Left out: {left.join("; ")}.</p>}
          </div>
          <ol className="max-h-[50dvh] space-y-2 overflow-y-auto border border-line p-3 text-sm">
            {result.blocks.map((b) => (
              <li key={b.id} className="flex gap-3">
                <span className="w-20 shrink-0 text-graphite">{BLOCK_LABELS[b.type]}</span>
                <span className={`min-w-0 break-words ${b.type === "heading" ? "font-bold" : ""}`}>{preview(b).slice(0, 140) || "—"}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={create} disabled={busy} className="button-primary h-12">
              {busy ? "Creating…" : "Create draft"}
            </button>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setTitle("");
                setTyped("");
              }}
              className="button-ghost h-12"
            >
              Paste again
            </button>
          </div>
          <p className="text-sm text-graphite">The draft opens in the editor. Add photos, sources, a topic and the search details there, then Preview and Publish.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="error-mark mt-4 text-sm">
          {error}
        </p>
      )}
    </main>
  );
}
