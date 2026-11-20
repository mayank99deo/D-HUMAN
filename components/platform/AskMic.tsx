"use client";

// Ask's mic (voice UX spec §7): it dictates into the box in the "Speaking in" language and
// never sends, because questions count against the day. It stops after 3 s of silence
// once there are words, or on a tap, and leaves the words to check, edit or send. Same
// recogniser as Fuel's Say card (useRecognizer.ts).
import { useEffect, useRef, useState } from "react";
import { spokenById, spokenForAppLanguage, type SpokenId } from "@/lib/domain/speech";
import { askMicLine, type AskMicNote } from "./ask-mic";
import { heardText, joinWords, micBusy, REPEAT_TAP_MS } from "./listen-state";
import { rememberSpoken, useSpokenPick, useVoiceRecord } from "./spoken-pick";
import { SpokenChips } from "./SpokenChips";
import { useRecognizer } from "./useRecognizer";
import { ASK_MIC_COPY as C } from "./voice-copy";
import { MicGlyph, VoiceMeter } from "./VoiceMeter";

/** Ask stops listening after this much silence once it has words: people think mid-question. */
export const ASK_SILENCE_MS = 3000;

const clock = () => Date.now();

function buzz() {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* not allowed here */
  }
}

export type AskMicOptions = {
  /** The box's words now. What the mic hears goes after them. */
  draft: string;
  /** Put these words in the box (the same path as typing). */
  onWords: (text: string) => void;
  /** The read language, for the first pick ("hi" listens in हिंदी, "hinglish" in Hinglish). */
  readLanguage: string;
  /** Longest question, in characters. Listening stops there. */
  max: number;
  /** It stopped with new words: put focus where one more tap sends (Ask on touch, the box on keyboards). */
  onStopped: () => void;
};

export function useAskMic(o: AskMicOptions) {
  const { spoken, pick } = useSpokenPick(spokenForAppLanguage(o.readLanguage));
  const record = useVoiceRecord();
  const [note, setNote] = useState<AskMicNote>(null);
  const [chips, setChips] = useState(false);
  const [stopped, setStopped] = useState(0);
  const opts = useRef(o);
  const base = useRef("");
  const heard = useRef(false);
  /** The person (or the sheet) dropped the session: no line about how it ended. */
  const dropping = useRef(false);
  const lastTap = useRef(0);
  const sessionLang = useRef(spoken);
  useEffect(() => {
    opts.current = o;
  });

  const rec = useRecognizer(
    {
      onLive: () => buzz(),
      onHeard: (h) => {
        const said = heardText(h);
        const { text, full } = joinWords(base.current, said, opts.current.max);
        if (said) {
          heard.current = true;
          rememberSpoken(sessionLang.current.id);
        }
        opts.current.onWords(text);
        // The box is full: stop, and the existing "Keep it under …" line says why.
        if (full) rec.stop();
      },
      onOff: (problem) => {
        setChips(false);
        if (dropping.current) return void (dropping.current = false);
        if (problem) return setNote(problem);
        if (!heard.current) return setNote("nothing_heard");
        buzz();
        setNote("check");
        setStopped((n) => n + 1);
      },
    },
    { stopAfterSilenceMs: ASK_SILENCE_MS },
  );

  // After it stops with words, once the Ask button is usable again.
  useEffect(() => {
    if (stopped) opts.current.onStopped();
  }, [stopped]);

  function listen(id: SpokenId = spoken.id) {
    const s = spokenById(id);
    base.current = opts.current.draft;
    heard.current = false;
    dropping.current = false;
    sessionLang.current = s;
    setNote(null);
    rec.start(s);
  }

  /** The mic button: listen, or "I'm done". Inside the tap, as iPhone needs. */
  function tap() {
    const now = clock();
    if (now - lastTap.current < REPEAT_TAP_MS) return;
    lastTap.current = now;
    if (rec.mic.kind === "live") return rec.stop();
    // A start that hasn't come through: a tap stops it, and the next one tries afresh.
    if (rec.mic.kind === "starting") {
      dropping.current = true;
      return rec.abort();
    }
    if (rec.mic.kind === "off") listen();
  }

  function pickLanguage(id: SpokenId) {
    pick(id);
    setChips(false);
    listen(id);
  }

  /** Their typing wins, and a question sent, a link followed or the sheet closed ends it: drop what's on its way. */
  function quiet() {
    setNote(null);
    setChips(false);
    if (!micBusy(rec.mic)) return;
    dropping.current = true;
    rec.abort();
  }

  // A hidden tab stops listening, keeping the words.
  const busy = micBusy(rec.mic);
  useEffect(() => {
    if (!busy) return;
    const onHide = () => document.hidden && rec.stop();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [busy, rec]);

  return {
    supported: rec.supported,
    mic: rec.mic,
    busy,
    activity: rec.activity,
    spoken,
    note,
    off: record.off,
    chips,
    setChips,
    tap,
    pickLanguage,
    quiet,
  };
}

export type AskMicState = ReturnType<typeof useAskMic>;

/** The 44 px mic beside the box. Filled white only while it really listens. */
export function AskMicButton({ mic }: { mic: AskMicState }) {
  const live = mic.mic.kind === "live" || mic.mic.kind === "stopping";
  const starting = mic.mic.kind === "starting";
  return (
    <button
      type="button"
      onClick={mic.tap}
      aria-label={live ? C.labelLive : starting ? C.labelStarting : C.label}
      aria-busy={starting || undefined}
      className={`grid h-11 w-11 shrink-0 place-items-center border ${live ? "border-paper bg-paper text-ink" : "border-line-strong text-paper active:bg-lift"}`}
    >
      <MicGlyph className="h-5 w-5" />
    </button>
  );
}

/** The line above the box while the mic is busy, or about how it last stopped. */
export function AskMicLineView({ mic, limit }: { mic: AskMicState; limit: boolean }) {
  const line = askMicLine({ mic: mic.mic, note: mic.note, spoken: mic.spoken, off: mic.off, limit });
  if (line.kind === "none") return null;
  return (
    <div className="mb-2">
      {line.kind === "live" ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0">
            <VoiceMeter active activity={mic.activity} />
          </span>
          <p className="min-w-0 flex-1">{line.text}</p>
          <button type="button" className="link-quiet inline-flex min-h-11 min-w-11 shrink-0 items-center justify-end" aria-expanded={mic.chips} onClick={() => mic.setChips(!mic.chips)}>
            {C.change}
          </button>
        </div>
      ) : (
        <p role={line.kind === "note" && line.mark ? "alert" : undefined} className={`flex flex-wrap items-center gap-x-3 text-sm ${line.kind === "note" && line.mark ? "error-mark" : ""}`}>
          <span>{line.text}</span>
          {line.kind === "note" &&
            line.listen.map((id) => (
              <button key={id} type="button" className="link-quiet inline-flex min-h-11 items-center gap-1" onClick={() => mic.pickLanguage(id)}>
                <span>Listen in</span>
                <span lang={id === "hi" ? "hi" : "en"}>{spokenById(id).label}</span>
              </button>
            ))}
        </p>
      )}
      {mic.chips && <SpokenChips name="ask-spoken" spoken={mic.spoken} onPick={mic.pickLanguage} className="mt-1" />}
    </div>
  );
}
