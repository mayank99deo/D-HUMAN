"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { send } from "@/components/platform/net";
import { BLOG_LIMITS, BLOG_TOPICS, SLUG_MAX, type Block, type BlockType, type BlogTopic, type Source, type Span } from "@/lib/blog/types";
import { blockTexts, readingMinutes, slugify, TOPIC_LABELS, wordCount, type WriteDraft } from "@/lib/blog/checks";
import type { EditorImage } from "@/lib/blog/image-store";
import type { EditorPost, ReviewView } from "@/lib/blog/store";
import { BlockFields, newBlock, PhotoWords } from "./BlockFields";
import { BLOCK_LABELS, BLOCK_MENU } from "./labels";
import { clearLocal, localAtLoad, parseLocal, writeLocal } from "./local-copy";
import { newBlockId, type PasteResult } from "./paste";
import { PhotoField } from "./PhotoField";
import { PublishSheet, SignInAgain } from "./PublishSheet";
import type { FocusAt } from "./RichText";

// The editor at /write/<id>. One column of blocks, built for a phone first: buttons to
// move blocks (they work everywhere, and with a screen reader), autosave a moment after
// each change, a copy of unsaved edits kept on the device, and every conflict said in
// words (designer §3.4 and §3.12). Saving never publishes: Publish opens the checks.

type SaveState =
  | { kind: "saved"; at: string }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "offline" }
  | { kind: "retrying" }
  | { kind: "signed_out" }
  | { kind: "gone" }
  | { kind: "invalid"; issues: string[] }
  | { kind: "slug_taken"; suggestion: string | null }
  | { kind: "conflict"; by: string | null; at: string; version: number };

const BLOCKED = new Set(["signed_out", "gone", "conflict"]);
const time = (iso: string) => new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));
const noChanges = () => () => {};

/** What goes to the server: photo blocks still waiting for their photo stay on this device. */
const forSave = (d: WriteDraft): WriteDraft => ({ ...d, blocks: d.blocks.filter((b) => b.type !== "photo" || b.imageId) });

export function Editor({ initial, me, reviewers }: { initial: EditorPost; me: { id: string; name: string; freshSession: boolean }; reviewers: { id: string; name: string }[] }) {
  const router = useRouter();
  const postId = initial.id;
  const [draft, setDraft] = useState(initial.draft);
  const [images, setImages] = useState(initial.images);
  const [version, setVersion] = useState(initial.draftVersion);
  const [liveVersion, setLiveVersion] = useState(initial.liveVersion);
  const [status, setStatus] = useState(initial.status);
  const [featured, setFeatured] = useState(initial.featured);
  const [review, setReview] = useState<ReviewView | null>(initial.review);
  const [save, setSave] = useState<SaveState>({ kind: "saved", at: initial.editedAt });
  const [edits, setEdits] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [focus, setFocus] = useState<{ blockId: string; at: FocusAt } | null>(null);
  const [lockOk, setLockOk] = useState(!initial.lock);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localDismissed, setLocalDismissed] = useState(false);

  const draftRef = useRef(draft);
  const versionRef = useRef(version);
  const editsRef = useRef(0);
  const savedEditsRef = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);

  // ── Saving ──────────────────────────────────────────────────────────────

  const doSave = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      const at = editsRef.current;
      setSave({ kind: "saving" });
      const r = await send<{ version: number; savedAt: string; error: string; issues: string[]; suggestion: string | null; by: string | null; at: string }>(`/api/write/posts/${postId}`, {
        method: "PUT",
        body: { baseVersion: versionRef.current, draft: forSave(draftRef.current) },
      });
      if (r.ok && r.data.version) {
        versionRef.current = r.data.version;
        setVersion(r.data.version);
        savedEditsRef.current = at;
        if (editsRef.current === at) {
          clearLocal(postId);
          setSave({ kind: "saved", at: r.data.savedAt ?? new Date().toISOString() });
        } else setSave({ kind: "pending" });
        return true;
      }
      if (r.offline) setSave({ kind: "offline" });
      else if (r.status === 401) setSave({ kind: "signed_out" });
      else if (r.status === 404) setSave({ kind: "gone" });
      else if (r.data.error === "conflict") setSave({ kind: "conflict", by: r.data.by ?? null, at: r.data.at ?? new Date().toISOString(), version: r.data.version ?? versionRef.current });
      else if (r.data.error === "slug_taken") setSave({ kind: "slug_taken", suggestion: r.data.suggestion ?? null });
      else if (r.data.error === "invalid") setSave({ kind: "invalid", issues: r.data.issues ?? [] });
      else setSave({ kind: "retrying" });
      return false;
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [postId]);

  // Autosave a moment after the last change; slower retries while offline or failing.
  useEffect(() => {
    if (!lockOk || edits <= savedEditsRef.current || BLOCKED.has(save.kind) || save.kind === "saving") return;
    if (save.kind === "slug_taken" || save.kind === "invalid") return; // waits for the next edit
    const wait = save.kind === "offline" || save.kind === "retrying" ? 8_000 : 1_200;
    const timer = setTimeout(() => void doSave(), wait);
    return () => clearTimeout(timer);
  }, [edits, save, lockOk, doSave]);

  useEffect(() => {
    const online = () => {
      if (editsRef.current > savedEditsRef.current) void doSave();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [doSave]);

  // Warn before leaving with edits the server doesn't have yet (they're on the device too).
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (editsRef.current > savedEditsRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);

  // The soft lock: tell the other writer this post is open here.
  useEffect(() => {
    if (!lockOk) return;
    const beat = () => {
      if (document.visibilityState === "visible") void send(`/api/write/posts/${postId}/heartbeat`);
    };
    beat();
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [lockOk, postId]);

  /** Saves now if anything is pending. The version to publish or preview, or null. */
  const flush = useCallback(async (): Promise<number | null> => {
    for (let i = 0; i < 3 && editsRef.current > savedEditsRef.current; i++) {
      if (!(await doSave())) return null;
    }
    return editsRef.current > savedEditsRef.current ? null : versionRef.current;
  }, [doSave]);

  const update = useCallback(
    (change: (d: WriteDraft) => WriteDraft) => {
      const next = change(draftRef.current);
      draftRef.current = next;
      setDraft(next);
      editsRef.current += 1;
      setEdits(editsRef.current);
      setSave((s) => (BLOCKED.has(s.kind) ? s : { kind: "pending" }));
      writeLocal(postId, { base: versionRef.current, at: new Date().toISOString(), draft: next });
    },
    [postId],
  );

  /** Replaces the editor's text with the server's (after Load theirs or Discard changes). */
  async function reload(message: string) {
    const r = await send<EditorPost>(`/api/write/posts/${postId}`, { method: "GET" });
    if (!r.ok || !r.data.draft) return setNotice("Couldn't load the post. Check your connection and try again.");
    const post = r.data as EditorPost;
    draftRef.current = post.draft;
    versionRef.current = post.draftVersion;
    savedEditsRef.current = editsRef.current;
    setDraft(post.draft);
    setVersion(post.draftVersion);
    setLiveVersion(post.liveVersion);
    setStatus(post.status);
    setImages(post.images);
    setReview(post.review);
    setResetKey((k) => k + 1);
    clearLocal(postId);
    setSave({ kind: "saved", at: post.editedAt });
    setNotice(message);
  }

  // ── Edits on this device that never reached the server ─────────────────

  const localRaw = useSyncExternalStore(noChanges, () => localAtLoad(postId), () => null);
  const local = useMemo(() => {
    const copy = parseLocal(localRaw);
    return copy && JSON.stringify(forSave(copy.draft)) !== JSON.stringify(initial.draft) ? copy : null;
  }, [localRaw, initial.draft]);

  function restoreLocal() {
    if (!local) return;
    update(() => local.draft);
    setResetKey((k) => k + 1);
    setLocalDismissed(true);
  }

  // ── Blocks ──────────────────────────────────────────────────────────────

  const setBlock = (id: string, b: Block) => update((d) => ({ ...d, blocks: d.blocks.map((x) => (x.id === id ? b : x)) }));
  const addImage = (img: EditorImage) => setImages((m) => ({ ...m, [img.id]: img }));

  function insertBlocks(at: number, blocks: Block[], focusFirst = true) {
    update((d) => ({ ...d, blocks: [...d.blocks.slice(0, at), ...blocks, ...d.blocks.slice(at)].slice(0, BLOG_LIMITS.blocksMax) }));
    if (focusFirst && blocks[0]) setFocus({ blockId: blocks[0].id, at: { at: "start", n: Date.now() } });
  }

  function addBlock(type: BlockType, at: number) {
    insertBlocks(at, [newBlock(type, newBlockId())]);
  }

  function move(i: number, by: -1 | 1) {
    update((d) => {
      const j = i + by;
      if (j < 0 || j >= d.blocks.length) return d;
      const blocks = [...d.blocks];
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...d, blocks };
    });
  }

  function remove(i: number, ask = true) {
    const b = draftRef.current.blocks[i];
    const hasContent = b && (b.type === "photo" ? !!b.imageId : blockTexts(b).some((t) => t.trim()));
    if (ask && hasContent && !window.confirm("Delete this block?")) return;
    update((d) => ({ ...d, blocks: d.blocks.filter((_, j) => j !== i) }));
    const prev = draftRef.current.blocks[i - 1];
    if (prev) setFocus({ blockId: prev.id, at: { at: "end", n: Date.now() } });
  }

  function pasteBlocks(i: number, result: PasteResult) {
    const current = draftRef.current.blocks[i];
    const emptyHere = current && (current.type === "paragraph" || current.type === "doctor") && current.spans.length === 0;
    if (result.title && !draftRef.current.title.trim()) update((d) => ({ ...d, title: result.title!.slice(0, BLOG_LIMITS.titleMax) }));
    update((d) => ({ ...d, blocks: [...d.blocks.slice(0, emptyHere ? i : i + 1), ...result.blocks, ...d.blocks.slice(i + 1)].slice(0, BLOG_LIMITS.blocksMax) }));
    setFocus(null);
    setResetKey((k) => k + 1);
    const dropped = [result.dropped.images && `${result.dropped.images} image${result.dropped.images > 1 ? "s" : ""} (add them as Photo blocks)`, result.dropped.tables && "a table's layout (rebuild it as a Table block)", result.dropped.links && `${result.dropped.links} link${result.dropped.links > 1 ? "s" : ""} that weren't https`].filter(Boolean);
    setNotice(dropped.length ? `Pasted. Left out: ${dropped.join("; ")}.` : "Pasted.");
  }

  function showMe(target: string) {
    const el = document.getElementById(target === "body" ? "body" : target === "title" || target === "details" || target === "cover" ? target : `block-${target}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLElement>("input, textarea, [contenteditable], select, button")?.focus({ preventScroll: true });
  }

  // ── Status actions ──────────────────────────────────────────────────────

  async function statusAction(action: "take_down" | "restore" | "discard") {
    const confirmCopy = {
      take_down: "Take this post down? Its link will show 'This post isn't available', and search engines will drop it over time. You can put it back later.",
      restore: null,
      discard: "Discard your changes? The post goes back to what's live now.",
    }[action];
    if (confirmCopy && !window.confirm(confirmCopy)) return;
    if (action === "discard") editsRef.current = savedEditsRef.current; // nothing pending to save over it
    const r = await send<{ error: string }>(`/api/write/posts/${postId}/status`, { body: { action } });
    if (!r.ok) return setNotice(r.offline ? "No connection. Check your signal and try again." : r.data.error === "sign_in_again" ? "Sign in again to do this (sessions older than 7 days can't change the public site)." : "That didn't work. Try again.");
    if (action === "discard") return reload("Changes discarded. This is what's live.");
    setStatus(action === "take_down" ? "taken_down" : "live");
    if (action === "take_down") setFeatured(false);
    setNotice(action === "take_down" ? "Taken down. Its link now shows 'This post isn't available'." : "Restored at the same address.");
  }

  async function deletePost() {
    const live = status === "taken_down";
    if (!window.confirm(live ? "Delete this post for good? Its address will answer 'gone' and is never reused. This can't be undone." : "Delete this draft? This can't be undone.")) return;
    const r = await send<{ error: string }>(`/api/write/posts/${postId}`, { method: "DELETE" });
    if (!r.ok) return setNotice(r.data.error === "sign_in_again" ? "Sign in again to delete (sessions older than 7 days can't change the public site)." : "Couldn't delete. Try again.");
    editsRef.current = savedEditsRef.current;
    clearLocal(postId);
    router.push("/write");
  }

  async function preview() {
    const v = await flush();
    if (v === null) return setNotice("Couldn't save your latest changes, so the preview would be out of date. Try again.");
    router.push(`/write/${postId}/preview`);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const changesNotLive = status !== "draft" && liveVersion !== version;
  const statusWord = status === "draft" ? "Draft" : status === "taken_down" ? "Taken down" : changesNotLive ? "Live · changes not live" : "Live";
  const saveWord = {
    saved: save.kind === "saved" ? `Saved ${time(save.at)}` : "",
    pending: "Saving…",
    saving: "Saving…",
    offline: "Offline",
    retrying: "Couldn't save. Trying again…",
    signed_out: "Signed out",
    gone: "Not saved",
    invalid: "Not saved",
    slug_taken: "Not saved",
    conflict: "Not saved",
  }[save.kind];
  const words = wordCount(draft);
  const cover = draft.cover;

  return (
    <div className="pb-24">
      <div className="sticky top-0 z-20 border-b border-line bg-ink">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2 sm:px-6">
          <Link href="/write" className="link-quiet inline-flex min-h-11 items-center pr-2 text-sm">
            Posts
          </Link>
          <p className="min-w-0 flex-1 truncate text-sm text-graphite" role="status" aria-live="polite">
            <span className="text-paper">{statusWord}</span> · {saveWord}
          </p>
          <button type="button" onClick={preview} className="button-ghost h-11 px-3 text-sm">
            Preview
          </button>
          <button type="button" onClick={() => setPublishing(true)} disabled={!lockOk} className="button-primary h-11 px-4 text-sm">
            {status === "live" ? "Update" : "Publish"}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <Banners
          save={save}
          lock={lockOk ? null : initial.lock}
          onOpenAnyway={() => setLockOk(true)}
          local={local && !localDismissed ? local : null}
          currentVersion={initial.draftVersion}
          onRestore={restoreLocal}
          onDiscardLocal={() => {
            clearLocal(postId);
            setLocalDismissed(true);
          }}
          onKeepMine={() => {
            if (save.kind !== "conflict") return;
            versionRef.current = save.version;
            setVersion(save.version);
            setSave({ kind: "pending" });
          }}
          onLoadTheirs={() => reload("Loaded the latest saved version.")}
          onUseSuggestion={(s) => update((d) => ({ ...d, slug: s }))}
          changesNotLive={changesNotLive}
          onDiscardChanges={() => statusAction("discard")}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
        />

        {!lockOk ? null : (
          <div key={resetKey}>
            <section id="cover" className="mt-6" aria-label="Cover photo">
              <PhotoField
                image={cover ? images[cover.imageId] : undefined}
                label="Add a cover photo"
                onImage={(img) => {
                  addImage(img);
                  update((d) => ({ ...d, cover: { ...(d.cover ?? { alt: "" }), imageId: img.id } }));
                }}
                onMeta={addImage}
              />
              {cover && (
                <div className="mt-3 space-y-3">
                  <PhotoWords value={cover} onChange={(w) => update((d) => ({ ...d, cover: d.cover ? { ...d.cover, ...w } : null }))} needsCredit={images[cover.imageId]?.ownRights === false} />
                  <button type="button" className="link-quiet min-h-11 text-sm" onClick={() => update((d) => ({ ...d, cover: null }))}>
                    Remove the cover photo
                  </button>
                </div>
              )}
              {!cover && <p className="mt-2 text-sm text-graphite">No photo? The post gets a drawn contour cover.</p>}
            </section>

            <section id="title" className="mt-8">
              <label className="block">
                <span className="sr-only">Title</span>
                <textarea
                  rows={2}
                  className="w-full resize-none border-0 border-b border-line-strong bg-transparent pb-2 text-[clamp(1.75rem,6vw,2.5rem)] leading-tight font-bold semiwide outline-none placeholder:text-graphite focus-visible:border-paper"
                  maxLength={BLOG_LIMITS.titleMax}
                  placeholder="Title"
                  value={draft.title}
                  onChange={(e) => update((d) => ({ ...d, title: e.target.value.replace(/\n/g, " ") }))}
                />
              </label>
              {draft.title.length > BLOG_LIMITS.titleWarnFrom && (
                <p className="mt-1 text-sm text-graphite">
                  {draft.title.length}/{BLOG_LIMITS.titleMax}. Shorter titles read better on phones and in search.
                </p>
              )}
              <label className="mt-4 block">
                <span className="sr-only">Dek</span>
                <textarea
                  rows={2}
                  className="textarea min-h-0 text-lg"
                  maxLength={BLOG_LIMITS.dekMax}
                  placeholder="One or two sentences on what the reader gets (optional)"
                  value={draft.dek}
                  onChange={(e) => update((d) => ({ ...d, dek: e.target.value.replace(/\n/g, " ") }))}
                />
              </label>
            </section>

            <section id="body" className="mt-8" aria-label="Body">
              {draft.blocks.length === 0 && <p className="mb-3 text-graphite">Start with a paragraph, or paste from Google Docs into one.</p>}
              <ol className="space-y-3">
                {draft.blocks.map((b, i) => (
                  <li key={b.id} id={`block-${b.id}`} className="scroll-mt-20">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold tracking-wide text-graphite uppercase">{BLOCK_LABELS[b.type]}</span>
                      <span className="flex">
                        <button type="button" className="h-11 min-w-11 text-graphite active:text-paper disabled:opacity-30" aria-label={`Move ${BLOCK_LABELS[b.type].toLowerCase()} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                          ↑
                        </button>
                        <button type="button" className="h-11 min-w-11 text-graphite active:text-paper disabled:opacity-30" aria-label={`Move ${BLOCK_LABELS[b.type].toLowerCase()} down`} disabled={i === draft.blocks.length - 1} onClick={() => move(i, 1)}>
                          ↓
                        </button>
                        <button type="button" className="h-11 min-w-11 text-graphite active:text-paper" aria-label={`Delete ${BLOCK_LABELS[b.type].toLowerCase()}`} onClick={() => remove(i)}>
                          ✕
                        </button>
                      </span>
                    </div>
                    <BlockFields
                      block={b}
                      onChange={(next) => setBlock(b.id, next)}
                      sources={draft.sources}
                      images={images}
                      onImage={addImage}
                      focusAt={focus?.blockId === b.id ? focus.at : null}
                      onEnter={(after: Span[]) => insertBlocks(i + 1, [{ id: newBlockId(), type: "paragraph", spans: after }])}
                      onBackspaceEmpty={() => remove(i, false)}
                      onPasteBlocks={(r) => pasteBlocks(i, r)}
                    />
                    {i < draft.blocks.length - 1 && <AddHere onAdd={(type) => addBlock(type, i + 1)} />}
                  </li>
                ))}
              </ol>
              <AddMenu onAdd={(type) => addBlock(type, draft.blocks.length)} />
              <p className="mt-4 text-sm text-graphite">
                {words} {words === 1 ? "word" : "words"} · {readingMinutes(draft)} min read
              </p>
            </section>

            <Sources sources={draft.sources} onChange={(sources) => update((d) => ({ ...d, sources }))} />
            <Details draft={draft} liveSlug={initial.status === "draft" ? null : initial.liveSlug} onChange={(change) => update((d) => ({ ...d, ...change }))} />

            <section className="mt-12 border-t border-line pt-6" aria-label="Post actions">
              <div className="flex flex-wrap gap-3">
                {status === "live" && (
                  <button type="button" onClick={() => statusAction("take_down")} className="button-ghost h-12">
                    Take down
                  </button>
                )}
                {status === "taken_down" && (
                  <button type="button" onClick={() => statusAction("restore")} className="button-ghost h-12">
                    Put it back
                  </button>
                )}
                {status !== "live" && (
                  <button type="button" onClick={deletePost} className="button-ghost h-12">
                    {status === "draft" ? "Delete draft" : "Delete for good"}
                  </button>
                )}
              </div>
              {!me.freshSession && (
                <div className="mt-4">
                  <p className="text-sm text-graphite">Publishing, taking down and deleting need a sign-in from the last 7 days. Your words are kept on this device while you sign in.</p>
                  <SignInAgain />
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {publishing && (
        <PublishSheet
          postId={postId}
          draft={forSave(draft)}
          images={images}
          status={status}
          featured={featured}
          review={review}
          version={version}
          reviewers={reviewers}
          freshSession={me.freshSession}
          onClose={() => setPublishing(false)}
          onShowMe={showMe}
          flush={flush}
          onReview={setReview}
          onPublished={(r) => {
            setStatus("live");
            setLiveVersion(r.version);
            setFeatured(r.featured);
          }}
        />
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Banners(p: {
  save: SaveState;
  lock: EditorPost["lock"];
  onOpenAnyway: () => void;
  local: ReturnType<typeof parseLocal>;
  currentVersion: number;
  onRestore: () => void;
  onDiscardLocal: () => void;
  onKeepMine: () => void;
  onLoadTheirs: () => void;
  onUseSuggestion: (slug: string) => void;
  changesNotLive: boolean;
  onDiscardChanges: () => void;
  notice: string | null;
  onDismissNotice: () => void;
}) {
  const box = "mt-4 border border-line-strong p-4";
  const s = p.save;
  return (
    <div aria-live="polite">
      {p.lock && (
        <div className={box}>
          <p>
            {p.lock.name} is editing this post (opened at {time(p.lock.at)}). Two people editing at once means one of you will have to choose whose changes to keep.
          </p>
          <button type="button" onClick={p.onOpenAnyway} className="button-primary mt-3 h-12">
            Open anyway
          </button>
        </div>
      )}
      {p.local && (
        <div className={box}>
          <p>
            This device has changes that weren&apos;t saved (from {time(p.local.at)}).
            {p.local.base !== p.currentVersion ? " The post was saved again since; restoring puts your version back over it." : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={p.onRestore} className="button-primary h-12">
              Restore them
            </button>
            <button type="button" onClick={p.onDiscardLocal} className="button-ghost h-12">
              Discard them
            </button>
          </div>
        </div>
      )}
      {s.kind === "conflict" && (
        <div className={box}>
          <p className="error-mark">
            {s.by ?? "Someone"} changed this post at {time(s.at)}. Keep yours, or load theirs?
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={p.onKeepMine} className="button-primary h-12">
              Keep mine
            </button>
            <button type="button" onClick={p.onLoadTheirs} className="button-ghost h-12">
              Load theirs
            </button>
          </div>
        </div>
      )}
      {s.kind === "offline" && <p className={`${box} text-sm`}>Offline. Your changes are kept on this device and will save when you&apos;re back.</p>}
      {s.kind === "signed_out" && (
        <div className={box}>
          <p className="error-mark">You&apos;ve been signed out. Sign in again; nothing you wrote is lost (it&apos;s kept on this device).</p>
          <Link href="/signin" className="button-ghost mt-3 h-12">
            Sign in
          </Link>
        </div>
      )}
      {s.kind === "gone" && <p className={`${box} error-mark`}>This post was deleted, or you can no longer edit it. Your text is kept on this device.</p>}
      {s.kind === "invalid" && <p className={`${box} error-mark`}>Couldn&apos;t save: {s.issues[0] ?? "something in the post isn't allowed"}. Fix it and it saves.</p>}
      {s.kind === "slug_taken" && (
        <div className={box}>
          <p className="error-mark">Another post uses this web address, so nothing saved.</p>
          {s.suggestion && (
            <button type="button" onClick={() => p.onUseSuggestion(s.suggestion!)} className="button-ghost mt-3 h-12">
              Use {s.suggestion}
            </button>
          )}
        </div>
      )}
      {p.changesNotLive && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-l-2 border-paper pl-4">
          <p className="text-sm">Changes aren&apos;t live yet. Update the post to publish them.</p>
          <button type="button" onClick={p.onDiscardChanges} className="link-quiet min-h-11 text-sm">
            Discard changes
          </button>
        </div>
      )}
      {p.notice && (
        <div className="mt-4 flex items-start justify-between gap-3 text-sm">
          <p>{p.notice}</p>
          <button type="button" onClick={p.onDismissNotice} className="link-quiet min-h-11 shrink-0">
            OK
          </button>
        </div>
      )}
    </div>
  );
}

function AddMenu({ onAdd, onDone }: { onAdd: (t: BlockType) => void; onDone?: () => void }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Add a block">
      {BLOCK_MENU.map((t) => (
        <button
          key={t}
          type="button"
          className="button-ghost h-11 justify-start px-3 text-sm"
          onClick={() => {
            onAdd(t);
            onDone?.();
          }}
        >
          + {BLOCK_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

function AddHere({ onAdd }: { onAdd: (t: BlockType) => void }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="mb-2">
      <AddMenu onAdd={onAdd} onDone={() => setOpen(false)} />
      <button type="button" className="link-quiet min-h-11 text-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  ) : (
    <button type="button" className="min-h-11 w-full text-left text-sm text-graphite active:text-paper" onClick={() => setOpen(true)}>
      + Add a block here
    </button>
  );
}

function Sources({ sources, onChange }: { sources: Source[]; onChange: (s: Source[]) => void }) {
  const set = (i: number, s: Source) => onChange(sources.map((x, j) => (j === i ? s : x)));
  return (
    <section id="sources" className="mt-12 border-t border-line pt-6" aria-labelledby="sources-title">
      <h2 id="sources-title" className="text-xl font-bold semiwide">
        Sources
      </h2>
      <p className="mt-1 text-sm text-graphite">Every health number names its source here. Readers see them numbered.</p>
      <ol className="mt-4 space-y-4">
        {sources.map((s, i) => (
          <li key={s.id} className="grid gap-2 sm:grid-cols-[2rem_1fr_1fr_auto] sm:items-center">
            <span className="text-sm text-graphite">{i + 1}.</span>
            <input className="field h-12" maxLength={200} value={s.name} placeholder="ICMR-NIN, 2020" aria-label={`Source ${i + 1} name`} onChange={(e) => set(i, { ...s, name: e.target.value })} />
            <input
              className="field h-12"
              maxLength={2000}
              inputMode="url"
              value={s.url ?? ""}
              placeholder="https://… (optional)"
              aria-label={`Source ${i + 1} link`}
              aria-invalid={!!s.url && !/^https?:\/\//.test(s.url)}
              onChange={(e) => set(i, { ...s, url: e.target.value || undefined })}
            />
            <button type="button" className="button-ghost h-12" aria-label={`Remove source ${i + 1}`} onClick={() => onChange(sources.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      {sources.length < BLOG_LIMITS.sourcesMax && (
        <button type="button" className="button-ghost mt-4 h-12" onClick={() => onChange([...sources, { id: `s${newBlockId().slice(0, 6)}`, name: "" }])}>
          Add a source
        </button>
      )}
    </section>
  );
}

function Details({ draft, liveSlug, onChange }: { draft: WriteDraft; liveSlug: string | null; onChange: (c: Partial<WriteDraft>) => void }) {
  const suggestion = slugify(draft.title);
  const searchTitle = draft.seoTitle ?? "";
  return (
    <section id="details" className="mt-12 space-y-6 border-t border-line pt-6" aria-labelledby="details-title">
      <h2 id="details-title" className="text-xl font-bold semiwide">
        Details
      </h2>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Topic</span>
        <span className="mb-2 block text-sm text-graphite">Where this post lives on the blog.</span>
        <select className="field h-12" value={draft.topic ?? ""} onChange={(e) => onChange({ topic: (e.target.value || null) as BlogTopic | null })}>
          <option value="">Pick a topic</option>
          {BLOG_TOPICS.map((t) => (
            <option key={t} value={t}>
              {TOPIC_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <div>
        <label htmlFor="slug" className="mb-1.5 block text-sm font-semibold">
          Web address
        </label>
        <div className="flex items-center border border-line-strong focus-within:border-paper">
          <span className="shrink-0 pl-3 text-sm text-graphite">d-human.fit/blog/</span>
          <input
            id="slug"
            className="h-12 min-w-0 flex-1 bg-transparent pr-3 outline-none"
            maxLength={SLUG_MAX}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={/^untitled-/.test(draft.slug) ? "" : draft.slug}
            placeholder="roti-calories"
            onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-") })}
            onBlur={() => {
              const trimmed = draft.slug.replace(/^-+|-+$/g, "");
              if (trimmed !== draft.slug) onChange({ slug: trimmed });
            }}
          />
        </div>
        <p className="mt-1.5 text-sm text-graphite">
          {suggestion && suggestion !== draft.slug ? (
            <button type="button" className="link-quiet min-h-11" onClick={() => onChange({ slug: suggestion })}>
              Use {suggestion}
            </button>
          ) : !suggestion && draft.title ? (
            "Write the address in English letters, for example roti-calories."
          ) : (
            "Lowercase words and hyphens, 3 to 6 words."
          )}
        </p>
        {liveSlug && draft.slug && draft.slug !== liveSlug && <p className="mt-1 text-sm">Old links will send readers to the new address once you update the post.</p>}
      </div>
      <label className="block">
        <span className="mb-1.5 flex justify-between text-sm font-semibold">
          <span>Search title</span>
          <span className={`font-normal ${(searchTitle || draft.title).length > BLOG_LIMITS.seoTitleWarnFrom ? "error-mark" : "text-graphite"}`}>{(searchTitle || draft.title).length}/60</span>
        </span>
        <input className="field h-12" maxLength={100} value={searchTitle} placeholder={draft.title || "Defaults to the title"} onChange={(e) => onChange({ seoTitle: e.target.value || undefined })} />
        {(searchTitle || draft.title).length > BLOG_LIMITS.seoTitleWarnFrom && <span className="mt-1 block text-sm text-graphite">Search engines will cut this. Write a shorter search title.</span>}
      </label>
      <label className="block">
        <span className="mb-1.5 flex justify-between text-sm font-semibold">
          <span>Search description</span>
          <span className={`font-normal ${draft.seoDescription.length > BLOG_LIMITS.seoDescriptionWarnFrom ? "error-mark" : "text-graphite"}`}>{draft.seoDescription.length}/155</span>
        </span>
        <span className="mb-2 block text-sm text-graphite">What someone sees under the title in Google.</span>
        <textarea className="textarea min-h-24" maxLength={300} value={draft.seoDescription} onChange={(e) => onChange({ seoDescription: e.target.value.replace(/\n/g, " ") })} />
      </label>
      <p className="text-sm text-graphite">Language: English. Hindi and Hinglish posts come later.</p>
    </section>
  );
}
