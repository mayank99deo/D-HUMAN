"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { safeHref } from "@/lib/blog/checks";
import type { Span } from "@/lib/blog/types";
import { blocksFromClipboard, inlineSpans, type PasteNode, type PasteResult } from "./paste";

// One rich-text field (a paragraph, a list item, a note): bold, italic and links, and
// nothing else. The field is the browser's own editable text, left alone while the
// author types; every change is read back into spans through the same walker as
// pasting, so only what a post may hold ever reaches the draft. Spans are drawn into
// the field with createElement and textContent, never as HTML.

function draw(el: HTMLElement, spans: readonly Span[]) {
  el.replaceChildren(...spans.map(spanNode));
}

function spanNode(s: Span): Node {
  let node: Node = document.createTextNode(s.text);
  if (s.italic) node = wrapIn("i", node);
  if (s.bold) node = wrapIn("b", node);
  if (s.href) {
    const a = document.createElement("a");
    a.href = s.href;
    a.append(node);
    node = a;
  }
  return node;
}

function wrapIn(tag: string, child: Node) {
  const el = document.createElement(tag);
  el.append(child);
  return el;
}

const read = (el: HTMLElement) => inlineSpans(el as unknown as PasteNode);

type LinkState = { open: boolean; value: string; error: string | null; needsSelection: boolean };
const CLOSED: LinkState = { open: false, value: "", error: null, needsSelection: false };

export type FocusAt = { at: "start" | "end"; n: number } | null;

export function RichText({
  spans,
  label,
  placeholder,
  onChange,
  onEnter,
  onBackspaceEmpty,
  onPasteBlocks,
  focusAt,
  className = "",
}: {
  spans: readonly Span[];
  label: string;
  placeholder?: string;
  onChange: (spans: Span[]) => void;
  /** Enter splits the field: what follows the caret goes to a new block. */
  onEnter?: (after: Span[]) => void;
  onBackspaceEmpty?: () => void;
  /** A paste of more than one paragraph becomes blocks after this one. */
  onPasteBlocks?: (result: PasteResult) => void;
  focusAt?: FocusAt;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(spans.length === 0);
  const [link, setLink] = useState<LinkState>(CLOSED);

  // Drawn once; after that the field holds the truth until the editor remounts it (a new key).
  const initial = useRef(spans);
  useLayoutEffect(() => {
    if (ref.current) draw(ref.current, initial.current);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!focusAt || !el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(focusAt.at === "start");
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [focusAt]);

  function changed() {
    const el = ref.current;
    if (!el) return;
    const next = read(el);
    setEmpty(next.length === 0);
    onChange(next);
  }

  function selectionInside(): Range | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return null;
    const range = sel.getRangeAt(0);
    return ref.current.contains(range.commonAncestorContainer) ? range : null;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    if (e.key === "Enter") {
      // One field is one paragraph: Enter starts the next block, Shift+Enter does nothing.
      e.preventDefault();
      if (e.shiftKey || !onEnter) return;
      const range = selectionInside();
      if (!range) return onEnter([]);
      const tail = document.createRange();
      tail.setStart(range.endContainer, range.endOffset);
      tail.setEnd(el, el.childNodes.length);
      range.deleteContents();
      const holder = document.createElement("div");
      holder.append(tail.extractContents());
      changed();
      onEnter(read(holder));
      return;
    }
    if (e.key === "Backspace" && !el.textContent && onBackspaceEmpty) {
      e.preventDefault();
      onBackspaceEmpty();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "i")) {
      e.preventDefault();
      format(e.key === "b" ? "bold" : "italic");
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const result = blocksFromClipboard(e.clipboardData);
    if (!result) return;
    const only = result.blocks.length === 1 && !result.title ? result.blocks[0] : null;
    if (result.blocks.length > 1 || result.title || (only && only.type !== "paragraph")) {
      onPasteBlocks?.(result);
      return;
    }
    if (!only || only.type !== "paragraph") return;
    const range = selectionInside();
    if (!range) return;
    range.deleteContents();
    const frag = document.createDocumentFragment();
    only.spans.forEach((s) => frag.append(spanNode(s)));
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    changed();
  }

  function format(command: "bold" | "italic" | "unlink") {
    ref.current?.focus();
    // execCommand is old but is still the one way every phone browser formats a selection.
    document.execCommand(command);
    changed();
  }

  function openLink() {
    const range = selectionInside();
    if (!range || range.collapsed) {
      setLink({ open: true, value: "", error: "Select the words to link first.", needsSelection: true });
      return;
    }
    saved.current = range.cloneRange();
    setLink({ open: true, value: "", error: null, needsSelection: false });
  }

  function applyLink(e: React.FormEvent) {
    e.preventDefault();
    const href = safeHref(link.value);
    if (!href) {
      setLink({ ...link, error: "Links start with https://, or are a D-Human page such as /calorie-tracker." });
      return;
    }
    const range = saved.current;
    if (!range || !ref.current) return setLink(CLOSED);
    ref.current.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand("createLink", false, href);
    saved.current = null;
    setLink(CLOSED);
    changed();
  }

  const toolbar = focused || link.open;
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keeps the text selected

  return (
    <div className={className}>
      <div className="relative">
        {empty && placeholder && (
          <span aria-hidden className="pointer-events-none absolute left-4 top-3 text-graphite">
            {placeholder}
          </span>
        )}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          onInput={changed}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="min-h-12 w-full whitespace-pre-wrap break-words border border-line-strong px-4 py-3 leading-relaxed outline-none focus-visible:border-paper [&_a]:underline [&_a]:underline-offset-2"
        />
      </div>
      {toolbar && (
        <div className="mt-1 flex flex-wrap items-center gap-1" role="toolbar" aria-label={`Format ${label.toLowerCase()}`}>
          <button type="button" onMouseDown={keep} onClick={() => format("bold")} className="button-ghost h-11 min-w-11 px-3 font-bold" aria-label="Bold">
            B
          </button>
          <button type="button" onMouseDown={keep} onClick={() => format("italic")} className="button-ghost h-11 min-w-11 px-3 italic" aria-label="Italic">
            I
          </button>
          <button type="button" onMouseDown={keep} onClick={openLink} className="button-ghost h-11 px-3">
            Link
          </button>
          <button type="button" onMouseDown={keep} onClick={() => format("unlink")} className="button-ghost h-11 px-3">
            Remove link
          </button>
        </div>
      )}
      {link.open && (
        <form onSubmit={applyLink} className="mt-2 flex flex-wrap items-start gap-2">
          {link.needsSelection ? (
            <p role="alert" className="error-mark w-full text-sm">
              {link.error}
            </p>
          ) : (
            <>
              <input
                autoFocus
                className="field h-11 min-w-0 flex-1 basis-60"
                inputMode="url"
                placeholder="https://… or /calorie-tracker"
                value={link.value}
                onChange={(e) => setLink({ ...link, value: e.target.value, error: null })}
                aria-label="Link address"
              />
              <button type="submit" className="button-primary h-11">
                Add link
              </button>
              {link.error && (
                <p role="alert" className="error-mark w-full text-sm">
                  {link.error}
                </p>
              )}
            </>
          )}
          <button type="button" onClick={() => setLink(CLOSED)} className="link-quiet min-h-11 text-sm">
            Close
          </button>
        </form>
      )}
    </div>
  );
}
