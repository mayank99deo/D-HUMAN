"use client";

// Fuel's Say card (voice UX spec, 2026-11-20): one big control in a native <dialog>.
// The control is filled white only while the recogniser is really live, "Speak now" shows
// only once the browser says it's listening, and a tap on the control always does the
// next obvious thing: done, then log now. Words are never lost: Close, Edit, Type instead,
// errors and a hidden tab leave them in Fuel's box.
//
// useSay runs one card: the recogniser (useRecognizer.ts), the auto-log countdown
// (autolog.ts) and the dialog. What the card shows comes from sayView (say-view.ts).
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { MEAL_WORDS_MAX, spokenById, type Spoken, type SpokenId } from "@/lib/domain/speech";
import { IDLE, stepAutoLog, type AutoEvent, type AutoLog } from "./autolog";
import { heardInScript, heardText, joinWords, REPEAT_TAP_MS, type Heard } from "./listen-state";
import { lockPage } from "./lock-page";
import { sayView, type SayButton, type SayView } from "./say-view";
import { rememberSpoken, useVoiceRecord } from "./spoken-pick";
import { SpokenChips } from "./SpokenChips";
import { useOnline, useRecognizer } from "./useRecognizer";
import { SAY_COPY as C } from "./voice-copy";
import { MicGlyph } from "./VoiceMeter";
import { VoiceRing } from "./VoiceRing";

const clock = () => Date.now();
const NONE: Heard = { final: "", interim: "" };

/** One short buzz where phones allow it (Android Chrome); iPhones ignore it. */
function buzz() {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* not allowed here */
  }
}

/** How the card was left: "close" keeps focus on Say; "edit" and "type" focus Fuel's box. */
export type SayLeave = "close" | "edit" | "type";

export type SayOptions = {
  /** Fuel's box. The card adds what it hears after what's there. */
  words: string;
  setWords: (words: string) => void;
  /** The language to listen in, and how to change it. */
  spoken: Spoken;
  pickSpoken: (id: SpokenId) => void;
  /** No "Speaking in" pick has heard words in this browser yet: the chips open unfolded. */
  firstTime: boolean;
  /** A meal may log itself (a meal log left today, food reading on). Otherwise taps lead to Ready to log. */
  allowed: boolean;
  /** Log these words now. The card has already closed, so the meal orbit can take over. */
  onLog: (words: string, heardIn: SpokenId | null) => void;
  /**
   * The card closed, with the language the words were heard in. For "edit" and "type", focus
   * Fuel's box in this same call: iPhone opens the keyboard only inside the tap.
   */
  onLeave: (how: SayLeave, heardIn: SpokenId | null) => void;
};

type SayElements = {
  dialog: RefObject<HTMLDialogElement | null>;
  panel: RefObject<HTMLDivElement | null>;
  square: RefObject<HTMLButtonElement | null>;
};

function useSay(o: SayOptions, { dialog, panel, square }: SayElements) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const [chips, setChips] = useState(false);
  const [heard, setHeard] = useState<Heard>(NONE);
  /** The words in the box before this listening session, for the transcript. */
  const [before, setBefore] = useState("");
  const [autoView, setAutoView] = useState<AutoLog>(IDLE);
  const online = useOnline();
  const record = useVoiceRecord();
  // Callbacks outlive the render that made them: they read these refs.
  const opts = useRef(o);
  const auto = useRef<AutoLog>(IDLE);
  const words = useRef(o.words);
  /** The words in the box before this listening session; what it hears goes after them. */
  const base = useRef("");
  /** The language of the session that's listening, and the last one that heard words. */
  const sessionLang = useRef<Spoken>(o.spoken);
  const heardIn = useRef<SpokenId | null>(null);
  const lastTap = useRef(0);
  const unlock = useRef<(() => void) | null>(null);
  /** Esc already handled on keydown, so a dialog cancel that may follow is ignored. */
  const escHandled = useRef(false);
  const driveRef = useRef<(e: AutoEvent) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    opts.current = o;
    words.current = o.words;
  });

  function drive(e: AutoEvent) {
    const before = auto.current;
    const next = stepAutoLog(before, e, { allowed: opts.current.allowed });
    if (next === before) return;
    auto.current = next;
    setAutoView(next);
    // The countdown ran out: log it, as if they'd tapped the control.
    if (next.kind === "logging" && e.type === "tick") log();
  }

  const rec = useRecognizer({
    onLive: () => buzz(),
    onHeard: (raw, e) => {
      // English and Hinglish show and log Latin letters, even from a browser that wrote Devanagari.
      const h = heardInScript(raw, sessionLang.current);
      const said = heardText(h);
      const { text, full } = joinWords(base.current, said, MEAL_WORDS_MAX);
      setHeard(h);
      words.current = text;
      opts.current.setWords(text);
      if (said) {
        heardIn.current = sessionLang.current.id;
        // Only a pick that has heard words becomes the default next time.
        rememberSpoken(sessionLang.current.id);
      }
      drive({ type: "result", at: e.at, final: e.final, spoke: said !== "", words: text });
      // The box is full: stop here, and they log or edit what's there.
      if (full) rec.stop();
    },
    onSpeechEnd: (at) => drive({ type: "speechend", at }),
    onEnded: (at) => drive({ type: "ended", at }),
    // Errors disarm the countdown; the words stay, and the card shows the way on.
    onProblem: () => drive({ type: "hold" }),
  });

  /** Listen (again) in `spoken`, adding to the words. Called inside the tap that asks for it. */
  function listen(spoken: Spoken) {
    base.current = words.current;
    setBefore(words.current);
    sessionLang.current = spoken;
    setHeard(NONE);
    drive({ type: "start", at: clock(), words: words.current });
    rec.start(spoken);
  }

  /** Close the dialog without the native return of focus fighting a focus that follows. */
  function closeDialog() {
    const d = dialog.current;
    if (d?.open) d.close();
  }

  function log() {
    const w = words.current.trim();
    if (!w) return;
    drive({ type: "submit" });
    rec.abort();
    closeDialog();
    opts.current.onLog(w, heardIn.current);
    drive({ type: "done" });
  }

  /** Open the card and start listening, inside the Say tap. */
  function openCard() {
    const d = dialog.current;
    if (!d) return;
    setChips(opts.current.firstTime);
    setOpen(true);
    lastTap.current = clock();
    if (!d.open) {
      d.showModal();
      unlock.current = lockPage();
    }
    // Keyboards: Space or Enter on the control is "done". Touch: no keyboard opens for a button.
    square.current?.focus({ preventScroll: true });
    listen(opts.current.spoken);
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((s) => setPrompt(s.state === "prompt"))
      .catch(() => setPrompt(false));
  }

  /** Leave the card. The words stay in Fuel's box; Edit and Type instead focus it in this same tap. */
  function leave(how: SayLeave) {
    rec.abort();
    drive({ type: "hold" });
    closeDialog();
    opts.current.onLeave(how, heardIn.current);
  }

  function pick(id: SpokenId) {
    opts.current.pickSpoken(id);
    setChips(false);
    listen(spokenById(id));
  }

  // The view, and what each control does in it.
  const view = sayView({ mic: rec.mic, auto: autoView, words: o.words, spoken: o.spoken, online, prompt, off: record.off });

  function onSquare() {
    const now = clock();
    if (now - lastTap.current < REPEAT_TAP_MS) return;
    lastTap.current = now;
    if (view.square.action === "finish") {
      if (!words.current.trim()) return void rec.abort("nothing_heard");
      buzz();
      // stop, not abort: the last words still land, and update what's logged.
      rec.stop();
      drive({ type: "finish", at: now, words: words.current });
    } else if (view.square.action === "log") log();
    else if (view.square.action === "listen") listen(o.spoken);
  }

  function onButton(b: SayButton) {
    switch (b.id) {
      case "type":
      case "edit":
        return leave(words.current.trim() ? "edit" : "type");
      case "log":
        return log();
      case "retry":
        return listen(o.spoken);
      case "listen_en":
        return pick("en");
      case "listen_hi":
        return pick("hi");
      case "keep":
        // After a pause the mic is still on: just carry on. After a tap, listen again.
        if (rec.mic.kind === "live") return drive({ type: "start", at: clock(), words: words.current });
        return listen(o.spoken);
    }
  }

  // Esc during the countdown stops it and keeps the card open at Ready to log; otherwise it closes.
  function onCancel(e: SyntheticEvent<HTMLDialogElement>) {
    if (escHandled.current) {
      escHandled.current = false;
      e.preventDefault();
      return;
    }
    if (auto.current.kind === "counting") {
      e.preventDefault();
      toReview();
      return;
    }
    e.preventDefault();
    leave("close");
  }
  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape" && auto.current.kind === "counting") {
      e.preventDefault();
      escHandled.current = true;
      setTimeout(() => (escHandled.current = false), 0);
      toReview();
    }
  }
  function toReview() {
    rec.stop();
    drive({ type: "hold" });
  }

  // However the dialog closed: let the page scroll, and make sure nothing keeps listening.
  function onClose() {
    unlock.current?.();
    unlock.current = null;
    setOpen(false);
    setChips(false);
    rec.abort();
    if (auto.current.kind !== "logging") drive({ type: "hold" });
  }

  // A tap on the dimmed strip around the card is Close.
  function onDialogClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) leave("close");
  }

  useLayoutEffect(() => {
    driveRef.current = drive;
    stopRef.current = toReview;
  });

  // A clock for the pause and the countdown, only while one could be running.
  const ticking = autoView.kind === "listening" || autoView.kind === "counting";
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => driveRef.current({ type: "tick", at: clock() }), 100);
    return () => clearInterval(id);
  }, [ticking]);

  // A hidden tab stops listening and the countdown, keeping the words: they come back to Ready to log.
  useEffect(() => {
    if (!open) return;
    const onHide = () => document.hidden && stopRef.current();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [open]);

  // Phones: the sheet is sized from what's visible, so iOS in-app browsers can't cover its top.
  useEffect(() => {
    const vv = window.visualViewport;
    const p = panel.current;
    if (!open || !vv || !p) return;
    const apply = () => {
      p.style.setProperty("--say-h", `${Math.round(vv.height)}px`);
      p.style.setProperty("--say-top", `${Math.round(vv.offsetTop)}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, [open, panel]);

  // Leaving the page for good: give the scroll back.
  useEffect(
    () => () => {
      unlock.current?.();
      unlock.current = null;
    },
    [],
  );

  return {
    open: openCard,
    close: () => leave("close"),
    isOpen: open,
    view,
    heard,
    before,
    chips,
    setChips,
    pick,
    onSquare,
    onButton,
    dialogProps: { onCancel, onClose, onKeyDown, onClick: onDialogClick },
    activity: rec.activity,
    endsAt: autoView.kind === "counting" ? autoView.endsAt : null,
    spoken: o.spoken,
    words: o.words,
  };
}

type Say = ReturnType<typeof useSay>;

/** What Fuel can do to the card: open it inside the Say tap. */
export type SayHandle = { open: () => void };

function buttonLabel(id: SayButton["id"]): ReactNode {
  switch (id) {
    case "type":
      return C.typeInstead;
    case "edit":
      return C.edit;
    case "keep":
      return C.keepTalking;
    case "retry":
      return C.tryAgain;
    case "log":
      return C.logMeal;
    case "listen_en":
      return "Listen in English";
    case "listen_hi":
      return (
        <>
          Listen in <span lang="hi">हिंदी</span>
        </>
      );
  }
}

/** Under the chips: the pick decides the script of the words and the meal, so show what each writes. */
function ScriptHint() {
  return (
    <p className="mt-2 text-sm text-graphite">
      Hinglish writes{" "}
      <span lang="hi-Latn" className="text-paper">
        do roti aur dal
      </span>
      . <span lang="hi">हिंदी</span> writes{" "}
      <span lang="hi" className="text-paper">
        दो रोटी और दाल
      </span>
      .
    </p>
  );
}

/** The transcript: settled words in white, the tail still being guessed in grey. It follows the newest line unless scrolled up. */
function Transcript({ view, before, heard, words, spoken }: { view: SayView; before: string; heard: Heard; words: string; spoken: Spoken }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    if (pinned.current) b.scrollTop = b.scrollHeight;
    b.toggleAttribute("data-clipped", b.scrollTop > 2);
  });
  if (view.words === "none") return null;
  const hasSession = !!(heard.final || heard.interim);
  const settled = hasSession ? [before, heard.final.trim()].filter(Boolean).join(" ") : words;
  const tail = hasSession ? heard.interim.trim() : "";
  const long = [...words].length > 160;
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const b = e.currentTarget;
        pinned.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24;
        b.toggleAttribute("data-clipped", b.scrollTop > 2);
      }}
      className="say-words mt-3 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]"
      dir="auto"
      lang={spoken.translateFrom ?? "en"}
    >
      {view.words === "placeholder" && !words.trim() ? (
        <p className={`text-graphite ${long ? "text-lg" : "text-xl"} leading-[1.45]`}>{C.placeholder}</p>
      ) : (
        <p className={`${long ? "text-lg" : "text-xl"} leading-[1.45]`}>
          {settled}
          {tail && <span className="text-graphite">{settled ? " " : ""}{tail}</span>}
        </p>
      )}
    </div>
  );
}

/** The card. Rendered closed with Fuel's form; Fuel opens it through `handle`, inside the Say tap. */
export function SayCard({ handle, ...o }: SayOptions & { handle: Ref<SayHandle> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const square = useRef<HTMLButtonElement>(null);
  const say: Say = useSay(o, { dialog, panel, square });
  useImperativeHandle(handle, () => ({ open: say.open }));
  const { view, spoken } = say;
  const inert = view.square.action === "none";
  return (
    <dialog
      ref={dialog}
      {...say.dialogProps}
      aria-labelledby="say-title"
      className="fixed inset-0 m-0 size-auto max-h-none max-w-none overflow-hidden border-0 bg-transparent p-0 text-paper outline-none backdrop:bg-black/60"
    >
      <div ref={panel} className="say-panel say-in" data-kind={view.kind}>
        <h2 id="say-title" className="sr-only">
          {C.title}
        </h2>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
          <p className="min-w-0 truncate text-sm text-graphite">
            {C.speakingIn}{" "}
            <span lang={spoken.translateFrom ?? "en"} className="font-semibold text-paper">
              {spoken.label}
            </span>
          </p>
          <button type="button" className="link-quiet min-h-11 min-w-11 shrink-0 px-1 text-sm" aria-expanded={say.chips} onClick={() => say.setChips(!say.chips)}>
            {say.chips ? C.done : C.change}
          </button>
          <button type="button" onClick={say.close} className="-mr-2 ml-auto grid min-h-11 min-w-11 shrink-0 place-items-center px-2 text-sm">
            {C.close}
          </button>
        </div>
        {say.chips && (
          <div className="shrink-0 border-b border-line px-4 py-3">
            <SpokenChips name="say-spoken" spoken={spoken} onPick={say.pick} />
            <ScriptHint />
          </div>
        )}

        <div className="say-body">
          <div className="[grid-area:head]">
            {view.note && <p className={`text-sm ${view.note.mark ? "error-mark" : ""}`}>{view.note.text}</p>}
            <p className={`text-[1.75rem] font-bold leading-tight semiwide ${view.mark ? "error-mark" : ""}`}>
              {view.headline}
            </p>
          </div>
          <div className="say-area flex flex-col [grid-area:words]">
            <Transcript view={view} before={say.before} heard={say.heard} words={say.words} spoken={spoken} />
            {view.line && <p className="mt-3 text-sm text-graphite">{view.line}</p>}
          </div>
          <div className="say-dial [grid-area:ring]">
            <VoiceRing mode={view.ring} activity={say.activity} endsAt={say.endsAt} className="absolute inset-0 h-full w-full" />
            <button
              ref={square}
              type="button"
              onClick={say.onSquare}
              aria-label={view.square.label}
              aria-disabled={inert || undefined}
              data-live={view.live ? "" : undefined}
              data-muted={inert ? "" : undefined}
              className="say-square"
            >
              {view.square.number != null ? <span className="display-num text-5xl">{view.square.number}</span> : <MicGlyph className="h-10 w-10" />}
            </button>
          </div>
          <p className="[grid-area:hint] min-h-5 text-center text-sm text-graphite">
            {view.hint}
            {view.hint && view.keyHint && <span className="hidden [@media(pointer:fine)]:inline">{C.keyHint}</span>}
          </p>
          <div className="[grid-area:buttons] flex flex-wrap gap-3">
            {view.buttons.map((b) => (
              <button key={b.id} type="button" disabled={b.disabled} onClick={() => say.onButton(b)} className={b.primary ? "button-primary h-12 px-6" : "button-ghost h-11"}>
                {buttonLabel(b.id)}
              </button>
            ))}
          </div>
          {/* In the scrolling body, so on a small phone nothing is cut off mid-line. */}
          <p className="[grid-area:foot] pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs text-graphite short:hidden">{C.privacy}</p>
        </div>

        <p role="status" className="sr-only">
          {say.isOpen ? view.announce : ""}
        </p>
      </div>
    </dialog>
  );
}
