"use client";

// The browser's speech recogniser for one listening control: Fuel's Say card and Ask's mic
// share it. The recogniser's lifetime lives in voice-engine.ts (tested in Node); this hook
// gives it the browser, a clock while a session can change by itself, and React state.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Spoken } from "@/lib/domain/speech";
import { MIC_OFF, type Mic, type MicOptions, type MicProblem } from "./listen-state";
import { noteCantListen, noteListened, voiceRecord } from "./spoken-pick";
import { VoiceEngine, type RecognitionCtor, type RecognizerEvents, type VoiceEnv } from "./voice-engine";
import { VoiceActivity } from "./VoiceMeter";

export type { RecognizerEvents } from "./voice-engine";

const noop = () => () => {};
const ctor = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};
const hasSpeech = () => !!ctor();

/** The engine's browser. Everything is read when it's used, never during render. */
const browser: VoiceEnv = {
  ctor,
  online: () => navigator.onLine,
  now: () => Date.now(),
  after: (fn, ms) => void window.setTimeout(fn, ms),
  record: { read: voiceRecord, listened: noteListened, cantListen: noteCantListen },
};

/** Whether this browser has speech recognition. The server renders as if it does. */
export function useSpeechSupported() {
  return useSyncExternalStore(noop, hasSpeech, () => true);
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
/** navigator.onLine, read after hydration. */
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Whether the browser will ask for the microphone (permissions.query says "prompt"). False where it can't tell. */
async function willAsk(): Promise<boolean> {
  try {
    const s = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return s?.state === "prompt";
  } catch {
    return false;
  }
}

export function useRecognizer(events: RecognizerEvents, opts: MicOptions = {}) {
  const supported = useSpeechSupported();
  const [activity] = useState(() => new VoiceActivity());
  const [view, setView] = useState<Mic>(MIC_OFF);
  const [prompt, setPrompt] = useState(false);
  const [engine] = useState(() => new VoiceEngine(browser, activity, setView));
  // Callbacks outlive the render that made them: the engine runs the latest.
  useEffect(() => engine.setHandlers(events, opts));

  /** Start listening in `spoken`. Call it inside the tap that asks for it, so the first permission prompt can show. */
  const start = useCallback(
    (spoken: Spoken) => {
      engine.start(spoken);
      void willAsk().then(setPrompt);
    },
    [engine],
  );
  /** Stop listening and keep the last words, which can arrive just after. */
  const stop = useCallback((problem: MicProblem | null = null) => engine.stop(problem), [engine]);
  /** Stop listening and drop anything still on its way. */
  const abort = useCallback((problem: MicProblem | null = null) => engine.abort(problem), [engine]);

  // A clock while the session can change by itself: slow start, quiet, nothing heard, the cap.
  const ticking = view.kind !== "off";
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => engine.tick(), 250);
    return () => clearInterval(id);
  }, [ticking, engine]);

  // Leaving for good drops the recogniser.
  useEffect(() => () => engine.dispose(), [engine]);

  return { supported, mic: view, prompt, activity, start, stop, abort };
}

export type Recognizer = ReturnType<typeof useRecognizer>;
