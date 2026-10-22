"use client";

import { useSyncExternalStore } from "react";
import type { SourceValue } from "@/lib/waitlist/options";

// One signup state shared by every waitlist form on the page, so joining in
// the hero also updates the form at the bottom. Kept for the browser session.

export type Signup =
  | { phase: "none" }
  | { phase: "joined"; email: string; token?: string }
  | { phase: "exists"; email: string }
  | { phase: "done"; email: string; firstName?: string; saved: boolean };

const KEY = "dhuman.waitlist";
const NONE: Signup = { phase: "none" };
let state: Signup = NONE;
let loaded = false;
let focusSource: SourceValue | null = null;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved) state = JSON.parse(saved) as Signup;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Memory still works.
  }
}

/** Updates every form; the form that made the change takes keyboard focus. */
export function setSignup(next: Signup, from: SourceValue) {
  state = next;
  focusSource = from;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
}

export function takeFocus(source: SourceValue) {
  if (focusSource !== source) return false;
  focusSource = null;
  return true;
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSignup() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => NONE,
  );
}
