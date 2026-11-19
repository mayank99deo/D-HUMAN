// Ask's fixed words in the browser: the UX spec's section 10, with the build contract's
// §7.2 and §7.4 where they differ (docs/team/specs/2026-11-19-ask-build.md). Code owns every
// word here; the model never writes them. English, like every button in the app for now.
// Pure, so the copy can be tested without a browser.
import { ASK_LIMITS, type AskErrorCode, type AskNotice, type AskRegion } from "@/lib/ask/types";
import type { MarkerStatus } from "@/lib/domain/markers";

const PER_DAY = ASK_LIMITS.perDay;

export const ASK_COPY = {
  // Entry
  control: "Ask",
  controlWide: "Ask about food, training or the app",
  controlName: "Ask a question about food, training, health or the app",
  keyHint: "/",
  aboutThis: "Ask about this",
  aboutMeal: "Ask about this meal",
  aboutGaps: "Ask how to close these",
  gapsChip: "your food gaps",

  // The sheet
  title: "Ask",
  close: "Close",
  leadReport: "Short answers on food, training and health, using your profile, meals and report. Or ask where something is in the app.",
  leadNoReport: "Short answers on food, training and health, using your profile and meals. Or ask where something is in the app.",
  doesntUse: "Questions don't use your meal logs or report reads.",
  tryOne: "Try one",
  reading: "Your report is still being read. Answers use it once it's done.",
  placeholder: "Ask about food, training or the app",
  placeholderLimit: "Find a screen, like Past meals",
  boxLabel: "Your question",
  send: "Ask",
  sending: "Asking…",
  tooLong: `Keep it under ${ASK_LIMITS.questionMaxChars} characters.`,
  eyebrow: "AI answer",
  demoEyebrow: "Demo answer: AI is off on this machine.",
  working: "Working on it…",
  workingSlow: "Still working on it. A slow connection can add a few seconds.",
  jumpTo: "Jump to",
  footer: "Questions clear after today.",
  clear: "Clear now",
  cleared: "Cleared. Questions you've used still count today.",
  clearFailed: "Couldn't clear them just now. Try again.",
  loading: "Loading today's questions…",
  loadFailed: "Couldn't load today's questions.",
  retry: "Try again",
  removed: "Answer removed with the report it used.",
  stale: "Asked before your latest report or stack. It may not fit them now.",
  threadLabel: "Today's questions",

  // The one-time notice for people who agreed to Claude before Ask existed (contract §7.2).
  consent:
    "Ask sends your question to Claude, an AI model made by Anthropic, with what it needs to answer for you: your profile answers (including medicines and pregnancy), today's meals, your stack and your latest report's results. That processing happens outside India. Answers are AI, not medical advice. Questions clear after the day.",
  consentButton: "Got it",
  consentFailed: "Couldn't save that. Try again.",

  // Pinned lines and their buttons
  manageReports: "Manage reports",
  signIn: "Sign in",
  finishSetup: "Finish setting up",

  // Screen readers
  announceWorking: "Working on your answer.",
} as const;

// ── Errors ─────────────────────────────────────────────────────────────────

const SERVER = "Couldn't answer that just now. It didn't count. Try again.";
const STILL = "Still answering your last question.";

/** What each error says. None of them count against the day. */
export const ASK_ERROR_WORDS: Record<AskErrorCode | "offline", string> = {
  invalid: SERVER,
  too_large: SERVER,
  bad_type: SERVER,
  bad_origin: SERVER,
  error: SERVER,
  failed: SERVER,
  empty: "Add a few more words.",
  too_long: ASK_COPY.tooLong,
  signed_out: "You've been signed out. Sign in to ask.",
  not_allowed: "Ask isn't available on this account.",
  not_onboarded: "Finish setting up first, so answers fit you.",
  // Not shown: the one-time notice takes the box's place instead.
  consent_needed: "Read the note on how Ask works first.",
  busy: STILL,
  rate_limited: STILL,
  report_deleted: "Your report was deleted while we answered. It didn't count; ask again.",
  refused: "Couldn't answer that one. Try asking another way. It didn't count.",
  too_many_tries: "Ask couldn't answer several times today. Try again after midnight (IST).",
  timeout: "That took too long. It didn't count. Try again.",
  ai_off: "Ask is switched off for now.",
  paused: "Ask is resting until midnight (IST). Your questions for today aren't used up.",
  offline: "No connection. Your question is still here; send it when you're back. It didn't count.",
};

/** Errors that offer "Try again", which sends the same question with the same key. */
export const RETRYABLE: ReadonlySet<AskErrorCode | "offline"> = new Set(["invalid", "too_large", "bad_type", "bad_origin", "error", "failed", "timeout"]);

// ── Lines that depend on the day or the place ─────────────────────────────

/** The header's counter; nothing before the thread has loaded. */
export function counterText(left: number | null): string | null {
  if (left == null) return null;
  if (left >= PER_DAY) return `${PER_DAY} questions a day`;
  if (left <= 0) return "None left today";
  return `${left} left today`;
}

/** "10:30 pm", in the browser's own time zone (or the one given, for tests). */
export function localTime(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(new Date(iso)).toLowerCase();
}

/** Said in place of the Ask button once the day's questions are used. */
export function limitLine(region: AskRegion, resetsAt: string | null, timeZone?: string) {
  const when = region === "in" || !resetsAt ? "midnight" : localTime(resetsAt, timeZone);
  return `That's your ${PER_DAY} questions for today. ${PER_DAY} more at ${when}.`;
}

/** The line under the box, always the same; 112 only for India. */
export function disclosure(region: AskRegion) {
  return region === "in" ? "AI answers, not medical advice. Emergency? Call 112." : "AI answers, not medical advice. In an emergency, call your local emergency number.";
}

/** India by the profile's time zone, or when there's none (contract §3.3). The thread's own `region` wins once it loads. */
export function askRegionOf(timezone: string | null | undefined): AskRegion {
  return !timezone || timezone === "Asia/Kolkata" || timezone === "Asia/Calcutta" ? "in" : "other";
}

/** "A", "A and B", "A, B and C". */
export function nameList(names: string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The pinned urgent line, without its "!" (the error-mark glyph draws it). Contract §7.2. */
export function urgentPinned(names: string[]) {
  const many = names.length > 1;
  return `${nameList(names)} ${many ? "need" : "needs"} medical advice today. Until a doctor has seen ${many ? "them" : "it"}, Ask only answers questions about using the app and logging meals.`;
}

export const printedForPinned = (name: string) => `Your latest report is printed for ${name}. Answers about markers treat it as yours.`;

export const chipText = (name: string) => `About: ${name}`;
export const chipRemove = (name: string) => `Remove ${name} from this question`;
export const callLabel = (n: string) => `Call ${n}`;

/** What a screen reader hears when an answer lands: the notice first, as on screen. */
export function announceAnswer(turn: { notice: AskNotice | null; answer: string | null }, left: number | null) {
  return ["Answer.", ...(turn.notice?.lines ?? []), turn.answer ?? "", counterText(left) ?? ""].filter(Boolean).join(" ");
}

/** A marker's status glyph class. Same as Markers.tsx's statusGlyph, kept here so the sheet's
 *  chunk doesn't pull in the marker catalogue. */
export function glyphFor(status: MarkerStatus | string | null | undefined) {
  if (status === "in_range") return "glyph-in";
  if (status === "edge_low" || status === "edge_high") return "glyph-edge";
  if (status === "low" || status === "high") return "glyph-out";
  return "glyph-unknown";
}

export function statusText(status: MarkerStatus | string | null | undefined) {
  return (
    { in_range: "In range", edge_low: "Low end of range", edge_high: "High end of range", low: "Below range", high: "Above range" }[status ?? ""] ?? "No range printed"
  );
}
