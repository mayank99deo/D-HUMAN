// The Ask sheet's state, as a pure reducer (UX spec §7, contract §16.2), so every state
// can be tested without a browser: sending, answers, the limit, the timeout check, a retry
// that keeps its key, a new day, clearing, consent, paused and off.
import { ASK_LIMITS, type AskErrorCode, type AskThread, type AskTurn } from "@/lib/ask/types";
import type { SpokenId } from "@/lib/domain/speech";
import type { AskOutcome } from "./ask-api";
import { RETRYABLE } from "./ask-copy";
import type { AboutChip } from "./ask-starters";

/** A question as sent: the key (and the "Speaking in" pick, when the mic wrote it) go with it on every "Try again". */
export type Question = { clientKey: string; question: string; about: AboutChip | null; spoken?: SpokenId };

/** What GET says beyond the turns and the day. */
export type Facts = Omit<AskThread, "turns" | "pending" | "left" | "day" | "resetsAt" | "consentNeeded">;

export type UiErrorCode = AskErrorCode | "offline";
export type UiError = { code: UiErrorCode; retry: Question | null };
export type AskStatus = "cleared" | "clear_failed" | "consent_failed" | null;

export type AskState = {
  load: "idle" | "loading" | "ready" | "failed";
  facts: Facts | null;
  consentNeeded: boolean;
  day: string | null;
  left: number | null;
  resetsAt: string | null;
  /** Today's answered turns, oldest first. */
  turns: AskTurn[];
  /** This browser's question in flight. */
  sending: (Question & { at: number }) | null;
  /** A question in flight from elsewhere (another tab, or before a reload). */
  elsewhere: AskThread["pending"];
  error: UiError | null;
  /** A line after "Clear now" or "Got it": done, or it didn't go through. */
  status: AskStatus;
  draft: { text: string; about: AboutChip | null };
  /** The last question handed back: sending the same words again reuses its key. */
  handedBack: Question | null;
  /** Bumps whenever a reply changed the thread, so a GET that started earlier can't undo it. */
  version: number;
  /** The version when the current GET started. */
  loadingAt: number;
  /** The turn that just landed, to scroll to and read out. */
  landed: string | null;
};

export const initialAskState = (draft: AskState["draft"] = { text: "", about: null }): AskState => ({
  load: "idle",
  facts: null,
  consentNeeded: false,
  day: null,
  left: null,
  resetsAt: null,
  turns: [],
  sending: null,
  elsewhere: null,
  error: null,
  status: null,
  draft,
  handedBack: null,
  version: 0,
  loadingAt: 0,
  landed: null,
});

export type AskAction =
  | { type: "prefill"; text: string; about: AboutChip | null }
  | { type: "type"; text: string }
  | { type: "drop_about" }
  | { type: "load" }
  | { type: "loaded"; thread: AskThread }
  | { type: "load_failed"; error: UiErrorCode }
  | { type: "send"; question: Question; at: number }
  | { type: "settled"; question: Question; outcome: AskOutcome }
  | { type: "cleared"; left: number | null }
  | { type: "clear_failed" }
  | { type: "consented" }
  | { type: "consent_failed" }
  | { type: "dismiss" };

const sameAbout = (a: AboutChip | null, b: AboutChip | null) => JSON.stringify(a?.request ?? null) === JSON.stringify(b?.request ?? null);

/** The key for what's in the box: the handed-back question's key when it's the same question, else a new one. */
export function keyFor(draft: AskState["draft"], handedBack: Question | null, makeKey: () => string) {
  return handedBack && handedBack.question === draft.text.trim() && sameAbout(handedBack.about, draft.about) ? handedBack.clientKey : makeKey();
}

/** A new question's key: a v4 UUID, also on plain-http pages where randomUUID is missing. */
export function newKey(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Characters as people count them (code points), as the server does. */
export const charCount = (text: string) => [...text.trim()].length;

/** Whether the box may send now. Limit, consent and an answer in flight all stop it. */
export function canSend(s: AskState) {
  const n = charCount(s.draft.text);
  return !s.sending && !s.elsewhere && !s.consentNeeded && s.left !== 0 && n >= ASK_LIMITS.questionMinChars && n <= ASK_LIMITS.questionMaxChars;
}

/** 409s and 404s mean the thread changed elsewhere: GET it again (threats D14). */
export const refetchAfter = (code: UiErrorCode) => code === "busy" || code === "report_deleted" || code === "consent_needed";

/** A new day drops the old turns from view before anything else changes. */
function withDay(s: AskState, f: { left?: number; day?: string; resetsAt?: string }): AskState {
  const newDay = !!f.day && !!s.day && f.day !== s.day;
  return {
    ...s,
    turns: newDay ? [] : s.turns,
    elsewhere: newDay ? null : s.elsewhere,
    left: f.left ?? s.left,
    day: f.day ?? s.day,
    resetsAt: f.resetsAt ?? s.resetsAt,
  };
}

function upsert(turns: AskTurn[], turn: AskTurn) {
  const i = turns.findIndex((t) => t.id === turn.id || t.clientKey === turn.clientKey);
  return i < 0 ? [...turns, turn] : turns.map((t, j) => (j === i ? turn : t));
}

function applyThread(s: AskState, thread: AskThread, keepTurns: boolean): AskState {
  const { turns, pending, left, day, resetsAt, consentNeeded, ...facts } = thread;
  const dayed = withDay(s, { left, day, resetsAt });
  return {
    ...dayed,
    facts,
    consentNeeded,
    turns: keepTurns ? dayed.turns : turns,
    // Our own question in flight is already on screen.
    elsewhere: pending && pending.clientKey !== s.sending?.clientKey ? pending : null,
  };
}

/** The question goes back in the box, unless they've typed something new meanwhile. */
function handBack(s: AskState, q: Question, error: UiError | null): AskState {
  return { ...s, draft: s.draft.text.trim() ? s.draft : { text: q.question, about: q.about }, handedBack: q, error };
}

export function askReducer(s: AskState, a: AskAction): AskState {
  switch (a.type) {
    case "prefill":
      // Tapping a starter or "Ask about this" replaces what's in the box. It never sends.
      return { ...s, draft: { text: a.text, about: a.about }, status: null };
    case "type":
      return { ...s, draft: { ...s.draft, text: a.text } };
    case "drop_about":
      return { ...s, draft: { ...s.draft, about: null } };
    case "load":
      return { ...s, load: s.load === "ready" ? "ready" : "loading", loadingAt: s.version };
    case "loaded":
      // A reply landed after this GET started: keep what's on screen, take only the facts.
      return { ...applyThread(s, a.thread, s.loadingAt !== s.version), load: "ready" };
    case "load_failed":
      if (a.error === "consent_needed") return { ...s, consentNeeded: true, load: "ready" };
      // Signed out, not set up, or not allowed: say so, as a send would.
      return a.error === "signed_out" || a.error === "not_onboarded" || a.error === "not_allowed"
        ? { ...s, load: "failed", error: { code: a.error, retry: null } }
        : { ...s, load: s.load === "ready" ? "ready" : "failed" };
    case "send": {
      const sent = s.draft.text.trim() === a.question.question && sameAbout(s.draft.about, a.question.about);
      return {
        ...s,
        sending: { ...a.question, at: a.at },
        // The box clears and stays usable; a retry from the error line leaves new typing alone.
        draft: sent ? { text: "", about: null } : s.draft,
        error: null,
        status: null,
        landed: null,
      };
    }
    case "settled": {
      const { question: q, outcome: o } = a;
      const base: AskState = { ...s, sending: s.sending?.clientKey === q.clientKey ? null : s.sending, version: s.version + 1 };
      switch (o.type) {
        case "ok": {
          const next = withDay(base, o.reply);
          if (o.reply.kind === "limit") return handBack(next, q, null);
          const turn = o.reply.turn!;
          return { ...next, turns: upsert(next.turns, turn), handedBack: null, error: null, landed: turn.id };
        }
        case "landed": {
          const next = applyThread(base, o.thread, false);
          return { ...next, turns: upsert(next.turns, o.turn), handedBack: null, error: null, landed: o.turn.id };
        }
        case "error": {
          const next = withDay(base, o.body);
          if (o.error === "consent_needed") return handBack({ ...next, consentNeeded: true }, q, null);
          return handBack(next, q, { code: o.error, retry: RETRYABLE.has(o.error) ? q : null });
        }
        case "offline":
          return handBack(base, q, { code: "offline", retry: null });
        case "timeout": {
          const next = o.thread ? applyThread(base, o.thread, false) : base;
          return handBack(next, q, { code: "timeout", retry: q });
        }
      }
      return base;
    }
    case "cleared":
      return { ...s, turns: [], left: a.left ?? s.left, status: "cleared", error: null, version: s.version + 1, landed: null };
    case "clear_failed":
    case "consent_failed":
      return { ...s, status: a.type };
    case "consented":
      return { ...s, consentNeeded: false, error: null, status: null };
    case "dismiss":
      return { ...s, error: null };
  }
}
