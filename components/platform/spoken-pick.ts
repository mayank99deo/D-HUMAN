"use client";

// The "Speaking in" language, shared by Fuel's Say card and Ask's mic, and what this
// browser has shown it can and can't listen in.
//
// - The pick is remembered in this browser (`dh-spoken`) only once it has heard words in
//   it. A pick the browser can't listen in is never the default next time, so a failed
//   language can't make every later visit fail the same way.
// - This visit's record (sessionStorage `dh-voice`): languages that started listening, and
//   languages the browser said it can't listen in. A language on the "can't" list isn't
//   handed to the recogniser again this visit; the card says so at once and offers the
//   ways that work. Handing an iPhone a language it can't transcribe is what led to the
//   mic that stopped responding until the page was reopened.
import { useCallback, useState, useSyncExternalStore } from "react";
import { SPOKEN_IDS, spokenById, spokenOf, type Spoken, type SpokenId } from "@/lib/domain/speech";
import { ruledOut, sameEngine } from "./listen-state";

const SPOKEN_KEY = "dh-spoken";
const VOICE_KEY = "dh-voice";
const CHANGED = "dh:spoken";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener(CHANGED, listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener(CHANGED, listener);
  };
}

/** The pick remembered here, or null (none yet, or storage blocked). */
export function savedSpoken(): SpokenId | null {
  try {
    return spokenOf(localStorage.getItem(SPOKEN_KEY))?.id ?? null;
  } catch {
    return null;
  }
}

/** Remember a pick that has heard words. Tells every open screen. */
export function rememberSpoken(id: SpokenId) {
  try {
    if (localStorage.getItem(SPOKEN_KEY) === id) return;
    localStorage.setItem(SPOKEN_KEY, id);
  } catch {
    /* private mode or blocked storage: the pick still holds for this visit */
  }
  notify();
  window.dispatchEvent(new Event(CHANGED));
}

export type VoiceRecord = { ok: SpokenId[]; off: SpokenId[] };
const EMPTY: VoiceRecord = { ok: [], off: [] };
let memory: VoiceRecord = EMPTY;
let cachedRaw: string | null | undefined;

const ids = (v: unknown): SpokenId[] => (Array.isArray(v) ? v.filter((x): x is SpokenId => SPOKEN_IDS.includes(x)) : []);

/** This visit's record. The same object until it changes, as useSyncExternalStore needs. */
export function voiceRecord(): VoiceRecord {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(VOICE_KEY);
  } catch {
    return memory;
  }
  if (raw === cachedRaw) return memory;
  cachedRaw = raw;
  try {
    const v = JSON.parse(raw ?? "null") as { ok?: unknown; off?: unknown } | null;
    memory = v ? { ok: ids(v.ok), off: ids(v.off) } : EMPTY;
  } catch {
    memory = EMPTY;
  }
  return memory;
}

function saveRecord(next: VoiceRecord) {
  memory = next;
  try {
    const raw = JSON.stringify(next);
    sessionStorage.setItem(VOICE_KEY, raw);
    cachedRaw = raw;
  } catch {
    /* kept in memory for this page */
  }
  notify();
}

/** The recogniser started listening in this language, so every pick sharing its engine can listen too. */
export function noteListened(id: SpokenId) {
  const r = voiceRecord();
  if (r.ok.includes(id) && !ruledOut(id, r.off)) return;
  saveRecord({ ok: [...r.ok.filter((x) => x !== id), id], off: r.off.filter((x) => !sameEngine(x, id)) });
}

/** The browser said it can't listen in this language. */
export function noteCantListen(id: SpokenId) {
  const r = voiceRecord();
  if (r.off.includes(id)) return;
  saveRecord({ ok: r.ok, off: [...r.off, id] });
}

const serverRecord = () => EMPTY;
const serverSaved = () => null;

/** This visit's record, read after hydration (the server renders an empty one). */
export function useVoiceRecord(): VoiceRecord {
  return useSyncExternalStore(subscribe, voiceRecord, serverRecord);
}

/**
 * The language to listen in: this screen's own pick, else the one remembered here, else
 * `fallback` (from the app language). `saved` is null until a pick has heard words here.
 */
export function useSpokenPick(fallback: SpokenId): { spoken: Spoken; saved: SpokenId | null; pick: (id: SpokenId) => void } {
  const [picked, setPicked] = useState<SpokenId | null>(null);
  const saved = useSyncExternalStore(subscribe, savedSpoken, serverSaved);
  const pick = useCallback((id: SpokenId) => setPicked(id), []);
  return { spoken: spokenById(picked ?? saved ?? fallback), saved, pick };
}
