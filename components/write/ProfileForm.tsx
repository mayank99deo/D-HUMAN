"use client";

import { useState } from "react";
import { OFFLINE, send } from "@/components/platform/net";
import type { EditorImage } from "@/lib/blog/image-store";
import type { AuthorProfile } from "@/lib/blog/store";
import { BLOG_LIMITS, type AuthorLink } from "@/lib/blog/types";
import { PhotoField } from "./PhotoField";
import { SignInAgain } from "./PublishSheet";

// "Your profile" (designer §3.11): the byline readers see on posts and on /team/<you>.

const LABELS: AuthorLink["label"][] = ["LinkedIn", "X", "GitHub", "Website"];

export function ProfileForm({ initial }: { initial: AuthorProfile }) {
  const [name, setName] = useState(initial.name);
  const [role, setRole] = useState(initial.role);
  const [bio, setBio] = useState(initial.bio);
  const [links, setLinks] = useState<AuthorLink[]>(initial.links);
  const [photo, setPhoto] = useState<EditorImage | null>(initial.photo);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const setLink = (i: number, l: AuthorLink) => setLinks((all) => all.map((x, j) => (j === i ? l : x)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    setStale(false);
    const r = await send<{ error: string }>("/api/write/profile", {
      method: "PUT",
      body: { name, role, bio, links: links.filter((l) => l.url.trim()), photoImageId: photo?.id ?? null },
    });
    if (r.ok) return setState("saved");
    setState("error");
    // The byline shows on every post, so changing it needs a recent sign-in, like publishing.
    if (r.data?.error === "sign_in_again") {
      setStale(true);
      return setError("Sign in again to change your byline. Sessions older than 7 days can't change the public site.");
    }
    setError(r.offline ? OFFLINE : r.status === 422 ? "Check the name (required) and that links start with https://." : "Couldn't save. Try again.");
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pt-8 pb-20 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Your profile</h1>
      <p className="mt-3 text-graphite">Readers see this on your posts and on your page at d-human.fit/team/{initial.slug}.</p>
      <form onSubmit={save} className="mt-8 space-y-6">
        <div>
          <p className="mb-2 text-sm font-semibold">Photo</p>
          <div className="max-w-xs">
            <PhotoField image={photo ?? undefined} label="Add a photo of you" onImage={setPhoto} onMeta={setPhoto} />
          </div>
          {photo && (
            <button type="button" onClick={() => setPhoto(null)} className="link-quiet min-h-11 text-sm">
              Remove the photo
            </button>
          )}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Name</span>
          <input className="field h-12" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Role</span>
          <input className="field h-12" maxLength={80} value={role} placeholder="Co-founder, D-Human" onChange={(e) => setRole(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 flex justify-between text-sm font-semibold">
            <span>Bio</span>
            <span className="font-normal text-graphite">
              {bio.length}/{BLOG_LIMITS.bioMax}
            </span>
          </span>
          <textarea className="textarea" maxLength={BLOG_LIMITS.bioMax} value={bio} onChange={(e) => setBio(e.target.value.replace(/\n/g, " "))} />
          <span className="mt-1.5 block text-sm text-graphite">Say only what&apos;s true. Don&apos;t list a qualification you don&apos;t hold.</span>
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Links (up to two)</legend>
          <div className="space-y-3">
            {links.map((l, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <select className="field h-12 w-32" value={l.label} aria-label={`Link ${i + 1} type`} onChange={(e) => setLink(i, { ...l, label: e.target.value as AuthorLink["label"] })}>
                  {LABELS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <input className="field h-12 min-w-0 flex-1 basis-48" inputMode="url" maxLength={500} value={l.url} placeholder="https://" aria-label={`Link ${i + 1} address`} onChange={(e) => setLink(i, { ...l, url: e.target.value })} />
                <button type="button" className="button-ghost h-12" onClick={() => setLinks((all) => all.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          {links.length < BLOG_LIMITS.authorLinksMax && (
            <button type="button" className="link-quiet mt-2 min-h-11 text-sm" onClick={() => setLinks((all) => [...all, { label: "LinkedIn", url: "" }])}>
              Add a link
            </button>
          )}
        </fieldset>
        <div className="flex items-center gap-4 border-t border-line pt-5">
          <button type="submit" disabled={state === "saving"} className="button-primary h-12 px-8">
            {state === "saving" ? "Saving…" : "Save"}
          </button>
          <span role="status" className={state === "error" ? "error-mark text-sm" : "text-sm text-graphite"}>
            {state === "saved" ? "Saved. Bylines on live posts change when each post is next updated." : (error ?? "")}
          </span>
        </div>
        {stale && <SignInAgain />}
      </form>
    </main>
  );
}
