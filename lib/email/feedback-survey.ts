// The feedback survey's words and order (UX spec §5), shared by the /feedback page, the
// API that saves answers and the copy sent to the Google Sheet. Pure and client-safe: no
// database, no secrets. The answers allowed per question live in FEEDBACK_QUESTIONS
// (lib/email/types.ts); the email's own labels for its question are ANSWER_LABELS in
// lib/email/templates/feedback.ts, and tests/feedback.test.ts keeps the two the same.

import { FEEDBACK_PATHS, FEEDBACK_QUESTIONS, FEEDBACK_TEXT_MAX, type FeedbackPath, type FeedbackQuestion } from "./types.ts";

/** The order people see. The first question of each path is the one asked in the email. */
export const FLOW: Record<FeedbackPath, readonly FeedbackQuestion[]> = {
  used: ["feel", "use", "build", "nps", "text"],
  barely: ["gotinway", "build", "text"],
};

/** Feedback from Settings (no email, no path): any question, under this survey id. */
export const OPEN_SURVEY = "open";

export type ChoiceQuestion = Exclude<FeedbackQuestion, "text">;

export const QUESTION_TEXT: Record<FeedbackQuestion, string> = {
  feel: "How would you feel if you could no longer use D-Human?",
  use: "What do you use most?",
  build: "What should we build next? Pick one.",
  nps: "How likely are you to recommend D-Human to a friend?",
  gotinway: "What got in the way?",
  text: "Anything else?",
};

/** A line under the question, where one helps. */
export const QUESTION_NOTE: Partial<Record<FeedbackQuestion, string>> = {
  build: "Picking one doesn't mean we'll build it; it helps us choose.",
  text: "A feature you want, something that annoyed you, anything at all.",
};

/**
 * Every option's words. "feel" and "gotinway" match the email exactly. "I ran out of meal
 * logs", not "My free meal logs ran out": the copy rule keeps "free" for "Free to start".
 */
export const ANSWER_TEXT: Record<ChoiceQuestion, Record<string, string>> = {
  feel: {
    very: "Very disappointed",
    somewhat: "Somewhat disappointed",
    not: "Not disappointed",
    not_used: "I haven't used it much",
  },
  use: {
    meals: "Logging meals",
    report: "My blood report read",
    stack: "My supplement stack",
    wraps: "Weekly wraps",
    nothing: "Nothing much yet",
  },
  build: {
    tests: "Blood tests booked through D-Human",
    phone_signin: "Sign in with your phone number or WhatsApp",
    languages: "The whole app in Hindi and other Indian languages",
    retest_reminder: "A reminder when it's time to retest",
    wearables: "Connect a watch or fitness app",
    other: "Something else",
  },
  nps: Object.fromEntries(FEEDBACK_QUESTIONS.nps.map((n) => [n, n])),
  gotinway: {
    too_slow: "Logging meals took too long",
    numbers_off: "The meal numbers looked off",
    logs_ran_out: "I ran out of meal logs",
    no_report: "I don't have a blood report to upload",
    not_yet: "I haven't got to it yet",
    other: "Something else",
  },
};

export const TEXT_PLACEHOLDER = "Type here. Please leave out health details; we don't need them here.";
export const CONTACT_LABEL = "You can email me about this.";
/** The counter shows from here (UX spec: from 800 of 1,000). */
export const TEXT_COUNTER_FROM = 800;

export const isQuestion = (q: unknown): q is FeedbackQuestion => typeof q === "string" && Object.hasOwn(FEEDBACK_QUESTIONS, q);
export const isPath = (p: unknown): p is FeedbackPath => typeof p === "string" && (FEEDBACK_PATHS as readonly string[]).includes(p);

/** The path a question from the email implies: the must-have question for "used", what got in the way for "barely". */
export function pathOfEmailQuestion(q: unknown): FeedbackPath | null {
  if (q === FLOW.used[0]) return "used";
  if (q === FLOW.barely[0]) return "barely";
  return null;
}

/** Whether `answer` is one of `question`'s options (choice questions only). */
export function isOption(question: FeedbackQuestion, answer: unknown): answer is string {
  const options = FEEDBACK_QUESTIONS[question];
  return options !== null && typeof answer === "string" && (options as readonly string[]).includes(answer);
}

// Control characters other than tab and newline: they'd only garble the Sheet.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** The typed note as saved: control characters gone, Windows line ends unified, trimmed. Empty means nothing to save. */
export function cleanText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim();
}

export type CheckedAnswer = { ok: true; answer: string } | { ok: false; error: "bad_answer" | "empty" | "too_long" };

/** The answer as it will be saved, or why it can't be. */
export function checkAnswer(question: FeedbackQuestion, raw: unknown): CheckedAnswer {
  if (question !== "text") return isOption(question, raw) ? { ok: true, answer: raw } : { ok: false, error: "bad_answer" };
  if (typeof raw !== "string") return { ok: false, error: "bad_answer" };
  const text = cleanText(raw);
  if (!text) return { ok: false, error: "empty" };
  // Counted in characters as people see them, as the page's counter does.
  if ([...text].length > FEEDBACK_TEXT_MAX) return { ok: false, error: "too_long" };
  return { ok: true, answer: text };
}

/** What comes after `question` on this path: the text box for "Something else", else the next question; null when done. */
export function nextQuestion(path: FeedbackPath, question: FeedbackQuestion, answer?: string | null): FeedbackQuestion | null {
  if (question === "build" && answer === "other") return "text";
  const flow = FLOW[path];
  const i = flow.indexOf(question);
  return i === -1 || i === flow.length - 1 ? null : flow[i + 1];
}

/** How the Sheet shows an answer: the option's words, the score, or the typed note. */
export function answerLabel(question: FeedbackQuestion, answer: string): string {
  if (question === "text") return answer;
  return ANSWER_TEXT[question][answer] ?? answer;
}
