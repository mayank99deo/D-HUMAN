"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { send, OFFLINE } from "@/components/platform/net";
import { automaticChecks, blockers, CHECKLIST_COPY, needsReview, type WriteDraft } from "@/lib/blog/checks";
import type { EditorImage } from "@/lib/blog/image-store";
import type { ReviewView } from "@/lib/blog/store";
import { CHECKLIST_ITEMS, type ChecklistItem, type CheckResult, type PostStatus } from "@/lib/blog/types";
import { SITE_HOST } from "@/lib/site-url";
import { drawShareImages } from "./share-image";
import { uploadImage } from "./resize";

// "Before this goes live": the automatic checks, the other founder's read for health
// topics, and the eight boxes (designer §4.1), then Publish now or Update post. The
// server runs every check again in one transaction; this sheet explains what's missing.

/** "d-human.fit", as people say it. */
const SITE_HOST_LABEL = SITE_HOST.replace(/^www\./, "");

type Props = {
  postId: string;
  draft: WriteDraft;
  images: Readonly<Record<string, EditorImage>>;
  status: PostStatus;
  featured: boolean;
  review: ReviewView | null;
  version: number;
  reviewers: { id: string; name: string }[];
  freshSession: boolean;
  onClose: () => void;
  onShowMe: (target: string) => void;
  /** Saves pending edits; the version to publish, or null when it couldn't. */
  flush: () => Promise<number | null>;
  onPublished: (r: { slug: string; version: number; featured: boolean }) => void;
  onReview: (review: ReviewView) => void;
};

const PUBLISH_ERRORS: Record<string, string> = {
  checklist: "Tick every box first.",
  review_needed: "This post needs the other founder's Looks good on this version first.",
  conflict: "Someone saved a newer version. Close this, check the post, then publish.",
  sign_in_again: "Sign in again to publish. Sessions older than 7 days can't change the public site.",
  taken_down: "Restore this post before updating it.",
  invalid: "This draft couldn't be read. Make a small change so it saves, then try again.",
  not_found: "This post was deleted.",
  rate_limited: "Too many tries. Wait a few minutes.",
};

export function PublishSheet(p: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [ticks, setTicks] = useState<Partial<Record<ChecklistItem, string>>>({});
  const [featured, setFeatured] = useState(p.featured);
  const [meaningful, setMeaningful] = useState(false);
  const [reviewer, setReviewer] = useState(p.reviewers[0]?.id ?? "");
  const [busy, setBusy] = useState<null | "saving" | "drawing" | "publishing" | "asking">(null);
  const [error, setError] = useState<string | null>(null);
  const [serverChecks, setServerChecks] = useState<CheckResult[] | null>(null);
  const [done, setDone] = useState<{ slug: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const checks = useMemo(() => {
    const widths = Object.fromEntries(Object.values(p.images).map((i) => [i.id, i.width]));
    const ownRights = Object.fromEntries(Object.values(p.images).map((i) => [i.id, i.ownRights]));
    return serverChecks ?? automaticChecks(p.draft, { imageWidths: widths, ownRights });
  }, [p.draft, p.images, serverChecks]);
  const blocking = blockers(checks);
  const warnings = checks.filter((c) => c.level === "warn");
  const missing = CHECKLIST_ITEMS.filter((i) => !ticks[i]);
  const reviewNeeded = needsReview(p.draft.topic);
  const review = p.review;
  const reviewOk = !reviewNeeded || (review?.status === "looks_good" && review.draftVersion === p.version);
  const isUpdate = p.status === "live";
  const ready = !blocking.length && !missing.length && reviewOk && p.freshSession && p.status !== "taken_down";
  const link = `${SITE_HOST_LABEL}/blog/${p.draft.slug}`;

  function close() {
    dialog.current?.close();
    p.onClose();
  }

  async function ask() {
    if (!reviewer) return;
    setBusy("saving");
    setError(null);
    const v = await p.flush();
    if (v === null) {
      setBusy(null);
      return setError("Couldn't save your latest changes. Try again.");
    }
    setBusy("asking");
    const r = await send<{ review: ReviewView; error: string }>(`/api/write/posts/${p.postId}/review`, { body: { reviewerId: reviewer } });
    setBusy(null);
    if (r.ok && r.data.review) p.onReview(r.data.review);
    else setError(r.offline ? OFFLINE : "Couldn't send the request. Try again.");
  }

  async function publish() {
    setBusy("saving");
    setError(null);
    setServerChecks(null);
    const version = await p.flush();
    if (version === null) {
      setBusy(null);
      return setError("Couldn't save your latest changes, so nothing was published. Try again.");
    }
    // The share image, drawn here (browsers shape Hindi correctly). Without it the page uses the site's.
    setBusy("drawing");
    let shareImageId: string | null = null;
    try {
      const blobs = await drawShareImages(p.draft.title, p.draft.topic);
      if (blobs.length) {
        const up = await uploadImage(blobs, "share");
        const img = up.body.image as EditorImage | undefined;
        if (up.status === 201 && img) shareImageId = img.id;
      }
    } catch {
      shareImageId = null;
    }
    setBusy("publishing");
    const checklist = Object.fromEntries(Object.entries(ticks).filter(([, at]) => at)) as Partial<Record<ChecklistItem, string>>;
    const r = await send<{ slug: string; error: string; checks: CheckResult[]; suggestion: string | null }>(`/api/write/posts/${p.postId}/publish`, {
      body: { draftVersion: version, checklist, meaningful: isUpdate && meaningful, featured, shareImageId },
      timeoutMs: 30_000,
    });
    setBusy(null);
    if (r.ok && r.data.slug) {
      setDone({ slug: r.data.slug });
      p.onPublished({ slug: r.data.slug, version, featured });
      return;
    }
    if (r.offline) return setError("Couldn't publish. Your post is saved. Try again.");
    const code = r.data.error ?? "";
    if (code === "checks" && r.data.checks) {
      setServerChecks(r.data.checks);
      return setError(`Fix ${blockers(r.data.checks).length} things before publishing.`);
    }
    if (code === "slug_taken") return setError(`Another post uses this address.${r.data.suggestion ? ` Try ${r.data.suggestion}, or reword it.` : ""}`);
    setError(PUBLISH_ERRORS[code] ?? "Couldn't publish. Your post is saved. Try again.");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`https://${link}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const reviewLine = (() => {
    if (!reviewNeeded) return null;
    if (review && review.draftVersion === p.version) {
      if (review.status === "looks_good") return `${review.reviewer.name} said Looks good to this version.`;
      if (review.status === "requested") return `Waiting for ${review.reviewer.name}'s read. They have an email with the preview.`;
      return `${review.reviewer.name}: Needs changes.${review.note ? ` "${review.note}"` : ""}`;
    }
    if (review) return `The post changed since ${review.reviewer.name}'s read. Ask again.`;
    return "Posts on food, blood tests and supplements need the other founder's Looks good before they go live.";
  })();

  return (
    <dialog
      ref={dialog}
      onClose={p.onClose}
      aria-labelledby="publish-title"
      className="m-0 h-dvh max-h-dvh w-full max-w-none overflow-y-auto border-line-strong bg-ink p-0 text-paper backdrop:bg-black/70 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:border"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-ink px-5 py-3">
        <h2 id="publish-title" className="text-lg font-bold semiwide">
          {done ? (isUpdate ? "Updated" : "Published") : "Before this goes live"}
        </h2>
        <button type="button" onClick={close} className="link-quiet min-h-11 text-sm">
          Close
        </button>
      </div>

      {done ? (
        <div className="space-y-5 px-5 py-6">
          <p className="text-lg">
            Live at <span className="font-semibold break-all">{`${SITE_HOST_LABEL}/blog/${done.slug}`}</span>. The page updates within a minute.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={copyLink} className="button-primary h-12">
              {copied ? "Link copied" : "Copy link"}
            </button>
            <Link href={`/blog/${done.slug}`} className="button-ghost h-12">
              View post
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-8 px-5 py-6">
          {p.status === "taken_down" && <p className="error-mark">This post is taken down. Restore it first, at the bottom of the editor.</p>}

          <section aria-labelledby="checks-title">
            <h3 id="checks-title" className="font-semibold">
              {blocking.length ? `Fix ${blocking.length} ${blocking.length === 1 ? "thing" : "things"} before publishing` : "Automatic checks passed"}
            </h3>
            <ul className="mt-3 space-y-2">
              {blocking.map((c, i) => (
                <CheckRow key={`b${i}`} check={c} onShowMe={(t) => (close(), p.onShowMe(t))} />
              ))}
            </ul>
            {warnings.length > 0 && (
              <>
                <p className="mt-5 text-sm text-graphite">Worth a second look (these don&apos;t stop publishing):</p>
                <ul className="mt-2 space-y-2">
                  {warnings.map((c, i) => (
                    <CheckRow key={`w${i}`} check={c} onShowMe={(t) => (close(), p.onShowMe(t))} />
                  ))}
                </ul>
              </>
            )}
          </section>

          {reviewNeeded && (
            <section aria-labelledby="review-title">
              <h3 id="review-title" className="font-semibold">
                The other founder&apos;s read
              </h3>
              <p className={`mt-2 text-sm ${reviewOk ? "" : "text-graphite"}`}>{reviewLine}</p>
              {!reviewOk && (review?.status !== "requested" || review.draftVersion !== p.version) && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {p.reviewers.length > 1 && (
                    <select className="field h-12 w-auto" value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="Who reads it">
                      {p.reviewers.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {p.reviewers.length ? (
                    <button type="button" onClick={ask} disabled={!!busy} className="button-ghost h-12">
                      {busy === "asking" ? "Asking…" : `Ask ${p.reviewers.find((r) => r.id === reviewer)?.name ?? "them"} for a read`}
                    </button>
                  ) : (
                    <p className="text-sm text-graphite">The other founder needs to open /write once before they can be asked.</p>
                  )}
                </div>
              )}
            </section>
          )}

          <section aria-labelledby="checklist-title">
            <h3 id="checklist-title" className="font-semibold">
              Tick each one
            </h3>
            <ul className="mt-3 space-y-3">
              {CHECKLIST_ITEMS.map((item) => (
                <li key={item}>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0 accent-white"
                      checked={!!ticks[item]}
                      onChange={(e) => setTicks((t) => ({ ...t, [item]: e.target.checked ? new Date().toISOString() : undefined }))}
                    />
                    <span>
                      <span className="font-semibold">{CHECKLIST_COPY[item].title}</span> <span className="text-graphite">{CHECKLIST_COPY[item].body}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <label className="flex min-h-11 items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-white" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
              <span>
                Feature at the top of the blog <span className="text-graphite">(replaces the post featured now)</span>
              </span>
            </label>
            {isUpdate && (
              <label className="flex min-h-11 items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-white" checked={meaningful} onChange={(e) => setMeaningful(e.target.checked)} />
                <span>
                  This is a meaningful update <span className="text-graphite">(shows &ldquo;Updated&rdquo; with today&apos;s date; leave off for typo fixes)</span>
                </span>
              </label>
            )}
          </section>

          {!p.freshSession && (
            <div className="border border-line-strong p-4">
              <p className="error-mark">Sign in again to publish. Sessions older than 7 days can&apos;t change the public site.</p>
              <SignInAgain />
            </div>
          )}

          <div className="sticky bottom-0 -mx-5 border-t border-line bg-ink px-5 py-4">
            {error && (
              <p role="alert" className="error-mark mb-3 text-sm">
                {error}
              </p>
            )}
            <button type="button" onClick={publish} disabled={!ready || !!busy} className="button-primary h-12 w-full sm:w-auto sm:px-10">
              {busy === "saving" ? "Saving…" : busy === "drawing" ? "Making the share image…" : busy === "publishing" ? "Publishing…" : isUpdate ? "Update post" : "Publish now"}
            </button>
            {!ready && !busy && (
              <p className="mt-2 text-sm text-graphite">
                {blocking.length ? "Fix the things above first." : missing.length ? `Tick ${missing.length} more ${missing.length === 1 ? "box" : "boxes"}.` : !reviewOk ? "Waiting for the other founder's read." : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

function CheckRow({ check, onShowMe }: { check: CheckResult; onShowMe: (target: string) => void }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span className={check.level === "block" ? "error-mark" : "text-graphite"}>{check.message}</span>
      <button type="button" onClick={() => onShowMe(check.blockId ?? targetFor(check.code))} className="link-quiet min-h-11 text-sm">
        Show me
      </button>
    </li>
  );
}

const targetFor = (code: string) =>
  ({ missing_title: "title", title_long: "title", missing_topic: "details", missing_description: "details", missing_slug: "details", search_title_long: "details", description_long: "details" })[code] ?? "body";

/** Signs out, then opens sign-in: a fresh session for publishing. Nothing unsaved is lost (it's kept on this device). */
export function SignInAgain() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="button-ghost mt-3 h-12"
      onClick={async () => {
        setBusy(true);
        await send("/api/auth/signout");
        // A full page load, as sign-in itself does: nothing from the old session stays cached.
        // Back to this post afterwards (sign-in accepts any path under /write).
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/signin?next=${encodeURIComponent(window.location.pathname)}`);
      }}
    >
      {busy ? "Signing out…" : "Sign out and sign in again"}
    </button>
  );
}
