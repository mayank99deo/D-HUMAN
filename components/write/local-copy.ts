// A copy of unsaved edits on this device, so a dropped connection, a closed tab or an
// expired session never loses words (designer §3.12). Written on every change, cleared
// once the server has the same text. Storage can be missing or full (private windows),
// so every read and write is wrapped.

import type { WriteDraft } from "@/lib/blog/checks";

export type LocalCopy = { base: number; at: string; draft: WriteDraft };

const key = (postId: string) => `dh-write:${postId}`;

export function writeLocal(postId: string, copy: LocalCopy) {
  try {
    localStorage.setItem(key(postId), JSON.stringify(copy));
  } catch {
    /* storage full or blocked: the server copy is still there */
  }
}

export function clearLocal(postId: string) {
  try {
    localStorage.removeItem(key(postId));
  } catch {
    /* nothing to clear */
  }
}

// Read once per page load, so the banner offering it doesn't change under the author.
const atLoad = new Map<string, string | null>();

export function localAtLoad(postId: string): string | null {
  if (!atLoad.has(postId)) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key(postId));
    } catch {
      raw = null;
    }
    atLoad.set(postId, raw);
  }
  return atLoad.get(postId) ?? null;
}

export function parseLocal(raw: string | null): LocalCopy | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as LocalCopy;
    return v && typeof v.base === "number" && v.draft && typeof v.draft === "object" ? v : null;
  } catch {
    return null;
  }
}
