"use client";

// The browser's speech recogniser for one listening control: Fuel's Say card and Ask's mic
// share it. It owns the recogniser's lifetime and turns its events into the session state
// in listen-state.ts. Each start makes a fresh recogniser, and only the current one may
// write: one replaced, stopped or dropped stays quiet.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Spoken } from "@/lib/domain/speech";
import { MIC_OFF, heardOf, micEffect, micProblemOf, micStep, ruledOut, type Heard, type Mic, type MicEvent, type MicOptions, type MicProblem } from "./listen-state";
import { noteCantListen, noteListened, voiceRecord } from "./spoken-pick";
import { VoiceActivity } from "./VoiceMeter";

// Minimal typing for the browser's speech recognition, which TypeScript doesn't ship.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};
type RecognitionCtor = new () => Recognition;

/** Longest wait for an old recogniser to let go of the mic before a new one starts. */
const HANDOVER_MS = 400;

const noop = () => () => {};
// Handlers and timers read the time through this; never during render.
const clock = () => Date.now();
const ctor = () => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};
const hasSpeech = () => !!ctor();

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

export type RecognizerEvents = {
  /** The recogniser started listening (its `start` or `audiostart`). */
  onLive?: (at: number) => void;
  /** New words in this session. `final`: the newest result is settled. */
  onHeard?: (heard: Heard, e: { final: boolean; at: number }) => void;
  onSpeechEnd?: (at: number) => void;
  /** The recogniser ended (after a stop, or by itself). Not called after an error or abort. */
  onEnded?: (at: number) => void;
  /** Listening stopped for a reason that isn't the person's own choice. */
  onProblem?: (problem: MicProblem) => void;
  /** The session is over, however it ended; `problem` is null when nothing went wrong. */
  onOff?: (problem: MicProblem | null) => void;
};

export function useRecognizer(events: RecognizerEvents, opts: MicOptions = {}) {
  const supported = useSpeechSupported();
  const engine = useRef<Recognition | null>(null);
  const mic = useRef<Mic>(MIC_OFF);
  const [view, setView] = useState<Mic>(MIC_OFF);
  const [activity] = useState(() => new VoiceActivity());
  const on = useRef(events);
  const options = useRef(opts);
  useEffect(() => {
    on.current = events;
    options.current = opts;
  });

  /** One step of the session, and what it asks of the engine. */
  const step = useCallback((e: MicEvent) => {
    const before = mic.current;
    const after = micStep(before, e, options.current);
    if (after === before) return after;
    mic.current = after;
    setView(after);
    // Ticks can end a session (nothing heard, too long, a stop never confirmed): do it to the engine too.
    if (e.type === "tick") {
      const effect = micEffect(before, after);
      if (effect === "stop") engine.current?.stop();
      if (effect === "abort") {
        const r = engine.current;
        engine.current = null;
        r?.abort();
      }
    }
    if (after.kind === "off" && before.kind !== "off") {
      if (after.problem) on.current.onProblem?.(after.problem);
      on.current.onOff?.(after.problem);
    }
    return after;
  }, []);

  /**
   * Start listening in `spoken`, in a fresh recogniser. Call it inside the tap that asks for
   * it, so the first permission prompt can show. When another recogniser is still holding
   * the mic (a language changed mid-sentence), the new one starts only once the old one has
   * ended, or after HANDOVER_MS: WebKit's server queues work for "the current recogniser" on
   * an old one's end (SpeechRecognitionServer.cpp, handleRequest), and a new one started in
   * the same moment can receive it and then ignore stop and abort.
   */
  const start = useCallback(
    (spoken: Spoken) => {
      const Ctor = ctor();
      // The old one goes quiet: its late events fail the `mine` check below.
      const old = engine.current;
      const oldBusy = !!old && mic.current.kind !== "off";
      engine.current = null;
      old?.abort();
      step({ type: "begin", at: clock() });
      // Known not to work here this visit, or no connection: say so without asking the engine.
      // An iPhone handed a language it can't transcribe has been seen to stop answering.
      // Hinglish failing rules out English too: both listen in en-IN.
      if (ruledOut(spoken.id, voiceRecord().off)) return void step({ type: "error", problem: "language" });
      if (!navigator.onLine) return void step({ type: "error", problem: "offline" });
      if (!Ctor) return void step({ type: "error", problem: "stopped" });

      const r = new Ctor();
      r.lang = spoken.speech;
      r.interimResults = true;
      r.continuous = true;
      const mine = () => engine.current === r;
      activity.reset();
      const live = () => {
        if (!mine()) return;
        activity.note("audiostart");
        const wasStarting = mic.current.kind === "starting";
        const after = step({ type: "live", at: clock() });
        if (wasStarting && after.kind === "live") {
          noteListened(spoken.id);
          on.current.onLive?.(clock());
        }
      };
      r.onstart = live;
      r.onaudiostart = live;
      r.onsoundstart = r.onspeechstart = () => mine() && activity.note("speechstart");
      r.onspeechend = () => {
        if (!mine()) return;
        activity.note("speechend");
        on.current.onSpeechEnd?.(clock());
      };
      r.onresult = (e) => {
        if (!mine()) return;
        const heard = heardOf(e.results);
        const at = clock();
        activity.note("result");
        const latest = e.results[e.results.length - 1];
        if ((heard.final + heard.interim).trim()) step({ type: "heard", at });
        on.current.onHeard?.(heard, { final: !!latest?.isFinal, at });
      };
      r.onerror = (e) => {
        if (!mine()) return;
        const problem = micProblemOf(e.error, { lang: spoken.id, workedIn: voiceRecord().ok });
        if (problem === "language") noteCantListen(spoken.id);
        if (e.error === "audio-capture") activity.captureFailed();
        activity.note("end");
        // Final: Safari never sends `end` after an error, so nothing waits for one.
        engine.current = null;
        step({ type: "error", problem });
      };
      r.onend = () => {
        if (!mine()) return;
        activity.note("end");
        engine.current = null;
        const after = step({ type: "end" });
        if (after.kind === "off" && !after.problem) on.current.onEnded?.(clock());
      };
      engine.current = r;
      const launch = () => {
        if (!mine()) return;
        try {
          r.start();
        } catch {
          // An engine that throws (a recogniser already running elsewhere): a clear "stopped", never a silent one.
          if (mine()) {
            engine.current = null;
            step({ type: "error", problem: "stopped" });
          }
        }
      };
      if (!oldBusy || !old) return launch();
      let launched = false;
      const once = () => {
        if (launched) return;
        launched = true;
        old.removeEventListener?.("end", once);
        old.removeEventListener?.("error", once);
        launch();
      };
      old.addEventListener?.("end", once);
      old.addEventListener?.("error", once);
      setTimeout(once, HANDOVER_MS);
    },
    [activity, step],
  );

  /** Stop listening and keep the last words, which can arrive just after. */
  const stop = useCallback(
    (problem: MicProblem | null = null) => {
      const r = engine.current;
      step({ type: "stop", at: clock(), problem });
      r?.stop();
    },
    [step],
  );

  /** Stop listening and drop anything still on its way. */
  const abort = useCallback(
    (problem: MicProblem | null = null) => {
      const r = engine.current;
      engine.current = null;
      r?.abort();
      activity.note("end");
      step({ type: "abort", problem });
    },
    [activity, step],
  );

  // A clock while the session can change by itself: slow start, quiet, nothing heard, the cap.
  const ticking = view.kind !== "off";
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => step({ type: "tick", at: clock() }), 250);
    return () => clearInterval(id);
  }, [ticking, step]);

  // Leaving for good drops the recogniser.
  useEffect(
    () => () => {
      const r = engine.current;
      engine.current = null;
      r?.abort();
    },
    [],
  );

  return { supported, mic: view, activity, start, stop, abort };
}

export type Recognizer = ReturnType<typeof useRecognizer>;
