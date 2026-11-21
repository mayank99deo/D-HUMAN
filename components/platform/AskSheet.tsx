"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ASK_LIMITS, askLinkOf, type AskAboutRequest, type AskLink, type AskReadLanguage, type AskRegion } from "@/lib/ask/types";
import { WAIT_FOR_LANDING_MS, acceptConsent, askQuestion, clearThread, getThread } from "./ask-api";
import { ASK_COPY, ASK_ERROR_WORDS, announceAnswer, counterText, limitLine } from "./ask-copy";
import { jumpTargets } from "./ask-jump";
import type { OpenRequest } from "./ask-open";
import { askReducer, canSend, charCount, initialAskState, newKey, questionFor, refetchAfter, type AskState, type Question } from "./ask-state";
import { isReadLanguage, pickStarters, starterText, type AboutChip, type Starter } from "./ask-starters";
import { AskMicButton, AskMicLineView, useAskMic } from "./AskMic";
import { AboutChipView, ConsentNotice, Disclosure, EmptyState, ErrorLine, JumpRow, PendingTurn, PinnedLines, TurnView } from "./AskParts";
import { lockPage } from "./lock-page";

export type SheetProps = {
  open: boolean;
  /** The latest request to open, with any "Ask about this" prefill. */
  request: OpenRequest | null;
  onClose: () => void;
  /** The signed-in person's id: drafts are kept per person in this tab. */
  who: string;
  /** From the profile, until the thread says. */
  region: AskRegion;
  readLanguage: AskReadLanguage;
};

/** "Still working on it…" after this long. */
const SLOW_AFTER_MS = 8_000;
const draftKey = (who: string) => `dh-ask-draft:${who}`;

const ABOUT_TYPES = new Set(["marker", "meal", "stack_item", "gaps"]);

/** A draft kept in this tab (sign-in, a dead zone, closing the sheet), rebuilt field by field. */
function readDraft(who: string): AskState["draft"] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(draftKey(who)) ?? "null") as { text?: unknown; about?: { request?: Record<string, unknown>; name?: unknown; status?: unknown } } | null;
    const text = typeof raw?.text === "string" ? raw.text.slice(0, ASK_LIMITS.questionMaxChars * 2) : "";
    const r = raw?.about?.request;
    const request =
      r && ABOUT_TYPES.has(String(r.type))
        ? r.type === "gaps"
          ? { type: "gaps" }
          : r.type === "stack_item"
            ? typeof r.nutrient === "string" && { type: "stack_item", nutrient: r.nutrient }
            : typeof r.id === "string" && { type: r.type, id: r.id }
        : null;
    const name = raw?.about?.name;
    const about = request && typeof name === "string" ? ({ request: request as AskAboutRequest, name, status: (raw?.about?.status as AboutChip["status"]) ?? null } satisfies AboutChip) : null;
    return { text, about };
  } catch {
    return { text: "", about: null };
  }
}

function saveDraft(who: string, draft: AskState["draft"]) {
  try {
    if (!draft.text && !draft.about) sessionStorage.removeItem(draftKey(who));
    else sessionStorage.setItem(draftKey(who), JSON.stringify(draft));
  } catch {
    /* private mode or blocked storage: the draft just doesn't survive a reload */
  }
}

const coarse = () => window.matchMedia("(pointer: coarse)").matches;
const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Ask: short answers on food, training, health and the app, as a native modal <dialog>.
 * Full screen on phones and tablets, a panel on the right on laptops. Talks to the server
 * only over HTTP (ask-api.ts); its state is a pure reducer (ask-state.ts).
 */
export function AskSheet({ open, request, onClose, who, region: regionHint, readLanguage: langHint }: SheetProps) {
  const router = useRouter();
  const path = usePathname();
  const [s, dispatch] = useReducer(askReducer, who, (w) => initialAskState(readDraft(w)));
  const latest = useRef(s);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const askButton = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const crisis = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const unlock = useRef<(() => void) | null>(null);
  /** The last open request acted on. */
  const applied = useRef(0);
  const [slowFor, setSlowFor] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [consenting, setConsenting] = useState(false);

  const facts = s.facts;
  const region = facts?.region ?? regionHint;
  const lang: AskReadLanguage = facts?.readLanguage ?? (isReadLanguage(langHint) ? langHint : "en");

  useLayoutEffect(() => {
    latest.current = s;
  });

  const load = useCallback(async () => {
    dispatch({ type: "load" });
    const r = await getThread();
    dispatch(r.ok ? { type: "loaded", thread: r.thread } : { type: "load_failed", error: r.error });
  }, []);

  /** Touch: no keyboard over the screen, so the title (or Ask, after a prefill). Keyboards: the box. */
  const focusFor = useCallback((prefilled: boolean) => {
    requestAnimationFrame(() => {
      if (coarse()) {
        const button = askButton.current;
        (prefilled && button && !button.disabled ? button : title.current)?.focus({ preventScroll: true });
        return;
      }
      const b = box.current;
      if (!b) return title.current?.focus({ preventScroll: true });
      b.focus({ preventScroll: true });
      b.setSelectionRange(b.value.length, b.value.length);
    });
  }, []);

  // Open as a modal: the page behind goes inert and stops scrolling, and today's thread is
  // fetched again (Next keeps screens mounted while hidden, so nothing in memory is trusted).
  // Each new request applies its prefill. It fills the box and never sends.
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!open) {
      if (d.open) d.close();
      return;
    }
    if (!d.open) {
      opener.current = request?.opener ?? null;
      d.showModal();
      unlock.current = lockPage();
      void load();
    }
    if (request && request.nonce !== applied.current) {
      applied.current = request.nonce;
      const p = request.prefill;
      if (p) dispatch({ type: "prefill", text: starterText(p.starter, lang), about: p.about });
      focusFor(!!p);
    }
  }, [open, request, load, lang, focusFor]);

  // Leaving for good (sign-out reloads the page; this is for safety).
  useEffect(
    () => () => {
      unlock.current?.();
      unlock.current = null;
    },
    [],
  );

  // The iPhone keyboard doesn't shrink the layout, so the sheet sizes itself to what's
  // visible, and the input row rides on top of the keyboard. Written to the DOM directly.
  useEffect(() => {
    const vv = window.visualViewport;
    const p = panel.current;
    if (!open || !vv || !p) return;
    let keyboardWas = false;
    const apply = () => {
      p.style.setProperty("--ask-h", `${Math.round(vv.height)}px`);
      p.style.setProperty("--ask-top", `${Math.round(vv.offsetTop)}px`);
      const keyboard = window.innerHeight - vv.height > 120;
      p.toggleAttribute("data-keyboard", keyboard);
      // Sideways with the keyboard up: only the header, the thread and the box.
      p.toggleAttribute("data-compact", keyboard && vv.height < 260);
      // When the keyboard opens, keep the newest turn in view.
      if (keyboard && !keyboardWas && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
      keyboardWas = keyboard;
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, [open]);

  // Back to this tab: the thread may have changed (a report deleted, another device).
  useEffect(() => {
    if (!open) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [open, load]);

  // A question in flight from elsewhere: wait for it, asking every 2 s, up to 45 s after it was asked.
  useEffect(() => {
    if (!open || !s.elsewhere || s.sending) return;
    if (!(Date.now() - Date.parse(s.elsewhere.at) < WAIT_FOR_LANDING_MS)) return;
    const t = window.setTimeout(() => void load(), ASK_LIMITS.pollEveryMs);
    return () => window.clearTimeout(t);
  }, [open, s.elsewhere, s.sending, load]);

  // "Still working on it" after 8 s.
  const sendingKey = s.sending?.clientKey ?? null;
  useEffect(() => {
    if (!sendingKey) return;
    const t = window.setTimeout(() => setSlowFor(sendingKey), SLOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [sendingKey]);

  // A question on its way sits at the end of the thread: keep it in view.
  useEffect(() => {
    if (sendingKey && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [sendingKey]);

  // An answer landed: bring its question's top into view, so it reads from the start. A
  // crisis reply takes focus, so a screen reader is on it at once.
  const landedTurn = s.landed ? (s.turns.find((t) => t.id === s.landed) ?? null) : null;
  useEffect(() => {
    if (!s.landed) return;
    const li = scroller.current?.querySelector(`[data-turn="${CSS.escape(s.landed)}"]`);
    li?.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
    crisis.current?.focus({ preventScroll: true });
  }, [s.landed]);

  useEffect(() => saveDraft(who, s.draft), [who, s.draft]);

  // The mic beside the box: it fills the box in the "Speaking in" language and never sends.
  const mic = useAskMic({
    draft: s.draft.text,
    onWords: (text) => dispatch({ type: "type", text }),
    readLanguage: lang,
    max: ASK_LIMITS.questionMaxChars,
    onStopped: () => focusFor(true),
  });

  // The box grows from one line to four, then scrolls. Measured again whenever its width
  // changes too ("Asking…" widens the button, and the placeholder can wrap). That second
  // measure waits for the next frame: resizing the box inside its own observer's callback
  // makes Safari report "ResizeObserver loop completed with undelivered notifications".
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    const fit = () => {
      b.style.height = "auto";
      b.style.height = `${Math.min(b.scrollHeight + 2, 24 * 4 + 22)}px`;
    };
    fit();
    let width = b.clientWidth;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (b.clientWidth === width) return;
      width = b.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    ro.observe(b);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [s.draft.text, open, s.consentNeeded, s.left]);

  function onDialogClose() {
    mic.quiet();
    unlock.current?.();
    unlock.current = null;
    onClose();
    const o = opener.current;
    opener.current = null;
    if (o?.isConnected) o.focus({ preventScroll: true });
  }

  const close = () => dialog.current?.close();

  /** A link into the app: close, then go. Already there: just close, and scroll to the anchor. */
  function go(e: MouseEvent<HTMLAnchorElement> | null, href: string) {
    if (e && (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    e?.preventDefault();
    mic.quiet();
    unlock.current?.();
    unlock.current = null;
    close();
    const url = new URL(href, window.location.href);
    if (url.pathname === window.location.pathname && url.search === window.location.search) {
      if (url.hash) document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ block: "start" });
      return;
    }
    router.push(href);
  }

  async function submit(retry?: Question, anyway = false) {
    const st = latest.current;
    if (st.sending || st.consentNeeded) return;
    if (!retry && !anyway && !canSend(st)) return;
    // Words the mic wrote carry the "Speaking in" pick: it decides the answer's language
    // (हिंदी gets Devanagari, Hinglish Latin letters), whatever script the browser wrote them in.
    // Words handed back by a failed send go again with that send's key and pick.
    const q: Question = retry ?? questionFor(st.draft, st.handedBack, mic.spokenFor(), newKey);
    if (charCount(q.question) < ASK_LIMITS.questionMinChars) return;
    mic.quiet();
    dispatch({ type: "send", question: q, at: Date.now() });
    const outcome = await askQuestion({ clientKey: q.clientKey, question: q.question, ...(q.about ? { about: q.about.request } : {}), ...(q.spoken ? { spoken: q.spoken } : {}) });
    dispatch({ type: "settled", question: q, outcome });
    if (outcome.type === "error" && refetchAfter(outcome.error)) void load();
  }

  const limit = s.left === 0;
  const jumps: AskLink[] = jumpTargets(s.draft.text).map((id) => ({ id, href: askLinkOf(id).path }));

  function onBoxKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Their typing wins over the mic. Enter while it listens only stops it: a half-heard question would count.
    if (mic.busy) {
      mic.quiet();
      if (e.key === "Enter") return void e.preventDefault();
    }
    // Indian-language keyboards use Enter to pick a word: never send while composing.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (!limit) return void submit();
    // At the limit Enter jumps to the first screen that matches. With none, the question
    // still goes: the server answers crisis and emergency questions even at the limit.
    if (jumps[0]) return go(null, jumps[0].href);
    void submit(undefined, true);
  }

  function takeStarter(st: Starter) {
    dispatch({ type: "prefill", text: st.text, about: null });
    focusFor(true);
  }

  async function clearNow() {
    setClearing(true);
    const r = await clearThread();
    setClearing(false);
    dispatch(r.ok ? { type: "cleared", left: r.data.left } : { type: "clear_failed" });
    if (r.ok) title.current?.focus({ preventScroll: true });
  }

  async function consent() {
    setConsenting(true);
    const r = await acceptConsent();
    setConsenting(false);
    dispatch(r.ok ? { type: "consented" } : { type: "consent_failed" });
    if (r.ok) focusFor(false);
  }

  const urgentPinned = facts?.pinned.urgent ?? [];
  const starters = facts && !limit ? pickStarters({ path, facts: facts.starters, report: facts.report, urgent: urgentPinned.length > 0, lang }) : [];
  const withReport = !!facts && (facts.report === "ready" || !!facts.starters.flagged || !!facts.starters.foodMarker);
  const service = facts?.state === "off" ? ASK_ERROR_WORDS.ai_off : facts?.state === "paused" ? ASK_ERROR_WORDS.paused : null;
  const busyTurn = s.sending ?? s.elsewhere;
  const slow = !!s.sending && slowFor === s.sending.clientKey;
  const loud = landedTurn && (landedTurn.kind === "urgent" || landedTurn.kind === "crisis");
  const polite = s.sending ? ASK_COPY.announceWorking : landedTurn && !loud ? announceAnswer(landedTurn, s.left) : "";
  const assertive = landedTurn && loud ? announceAnswer(landedTurn, s.left) : "";
  const tooLong = charCount(s.draft.text) >= ASK_LIMITS.questionMaxChars;
  const micShown = mic.supported && !service;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="ask-title"
      onClose={onDialogClose}
      className="fixed inset-0 m-0 size-auto max-h-none max-w-none overflow-hidden border-0 bg-transparent p-0 text-paper outline-none backdrop:bg-transparent"
    >
      {/* Laptops: the page shows under a scrim, and a click on it closes Ask. */}
      <div aria-hidden className="absolute inset-0 hidden bg-ink/60 lg:block" onClick={close} />
      <div
        ref={panel}
        className="group/ask ask-in absolute inset-x-0 flex flex-col bg-ink lg:left-auto lg:w-[26rem] lg:border-l lg:border-line-strong xl:w-[28rem]"
        style={{ top: "var(--ask-top, 0px)", height: "var(--ask-h, 100dvh)" }}
      >
        <header className="shrink-0 border-b border-line pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-3 px-4 short:h-11 lg:max-w-none">
            <h2 id="ask-title" ref={title} tabIndex={-1} className="text-lg font-bold semiwide outline-none">
              {ASK_COPY.title}
            </h2>
            <p className="ml-auto text-sm text-graphite">{counterText(s.left)}</p>
            <button type="button" onClick={close} className="-mr-2 grid min-h-11 min-w-11 place-items-center px-2 text-sm">
              {ASK_COPY.close}
            </button>
          </div>
        </header>

        {facts && (urgentPinned.length > 0 || facts.pinned.printedFor) && (
          <div className="mx-auto w-full max-w-xl shrink-0 px-4 group-data-[compact]/ask:hidden lg:max-w-none">
            <PinnedLines urgent={urgentPinned} printedFor={facts.pinned.printedFor} onGo={go} />
          </div>
        )}

        {/* relative: hidden labels in the thread (a marker's "Below range:") are absolutely placed;
            without it they escape this scroller, stretch the dialog, and scrolling an answer into
            view then moves the whole sheet up. */}
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-xl px-4 pb-4 lg:max-w-none">
            {!facts && s.load !== "failed" && !s.turns.length && !busyTurn && (
              <p role="status" className="py-5 text-sm text-graphite">
                {ASK_COPY.loading}
              </p>
            )}
            {s.load === "failed" && !s.error && (
              <div className="pt-4 text-sm">
                <p>{ASK_COPY.loadFailed}</p>
                <button type="button" onClick={() => void load()} className="link-quiet inline-flex min-h-11 items-center">
                  {ASK_COPY.retry}
                </button>
              </div>
            )}
            {s.turns.length > 0 || busyTurn ? (
              <>
                <ol aria-label={ASK_COPY.threadLabel}>
                  {s.turns.map((t) => (
                    <TurnView key={t.id} turn={t} onGo={go} noticeRef={t.id === s.landed && t.kind === "crisis" ? crisis : undefined} />
                  ))}
                  {busyTurn && <PendingTurn question={busyTurn.question} slow={slow} />}
                </ol>
                {s.turns.length > 0 && (
                  <p className="border-t border-line pt-4 text-sm text-graphite">
                    {ASK_COPY.footer}{" "}
                    <button type="button" onClick={clearNow} disabled={clearing} className="link-quiet inline-flex min-h-11 items-center">
                      {ASK_COPY.clear}
                    </button>
                  </p>
                )}
              </>
            ) : (
              facts && <EmptyState withReport={withReport} reading={facts.report === "reading"} service={service} starters={starters} onStarter={takeStarter} />
            )}
            {s.status === "cleared" && (
              <p role="status" className="text-sm">
                {ASK_COPY.cleared}
              </p>
            )}
            {s.status === "clear_failed" && (
              <p role="alert" className="error-mark text-sm">
                {ASK_COPY.clearFailed}
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-line pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 group-data-[keyboard]/ask:pb-3">
          <div className="mx-auto w-full max-w-xl px-4 lg:max-w-none">
            {s.consentNeeded ? (
              <ConsentNotice onAccept={consent} busy={consenting} failed={s.status === "consent_failed"} />
            ) : (
              <>
                {s.error && <ErrorLine error={s.error} path={path} onRetry={() => s.error?.retry && void submit(s.error.retry)} />}
                {limit && <p className="mb-2 text-sm">{limitLine(region, s.resetsAt)}</p>}
                {s.draft.about && (
                  <AboutChipView
                    about={s.draft.about}
                    onRemove={() => {
                      dispatch({ type: "drop_about" });
                      box.current?.focus({ preventScroll: true });
                    }}
                  />
                )}
                <JumpRow links={jumps} onGo={go} />
                {tooLong && <p className="error-mark mb-2 text-sm">{ASK_COPY.tooLong}</p>}
                {micShown && <AskMicLineView mic={mic} limit={limit} />}
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <textarea
                    ref={box}
                    rows={1}
                    value={s.draft.text}
                    onChange={(e) => {
                      mic.quiet();
                      dispatch({ type: "type", text: e.target.value });
                    }}
                    onCompositionStart={() => mic.quiet()}
                    onKeyDown={onBoxKey}
                    enterKeyHint={limit ? "go" : "send"}
                    dir="auto"
                    maxLength={ASK_LIMITS.questionMaxChars}
                    aria-label={ASK_COPY.boxLabel}
                    placeholder={limit ? ASK_COPY.placeholderLimit : ASK_COPY.placeholder}
                    className="field min-h-11 resize-none py-2.5 leading-6"
                  />
                  {micShown && <AskMicButton mic={mic} />}
                  {!limit && (
                    // While the mic listens a half-heard question would use one of today's questions.
                    <button ref={askButton} type="submit" disabled={!canSend(s) || mic.busy} className="button-primary h-11 shrink-0 px-5">
                      {s.sending ? ASK_COPY.sending : ASK_COPY.send}
                    </button>
                  )}
                </form>
              </>
            )}
            <Disclosure region={region} />
          </div>
        </div>

        {/* Hidden live regions: the thread itself isn't one, so opening it doesn't read everything out. */}
        <p className="sr-only" role="status">
          {polite}
        </p>
        <p className="sr-only" aria-live="assertive">
          {assertive}
        </p>
      </div>
    </dialog>
  );
}
