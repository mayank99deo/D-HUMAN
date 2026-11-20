// The fixed words of Fuel's Say card and Ask's mic (voice UX spec, 2026-11-20, §3 and §7).
// English, like every button in the app for now; language names show in their own script.
// Pure, so the copy can be tested without a browser.
import { spokenById, type Spoken, type SpokenId } from "@/lib/domain/speech";
import { LISTENS_WIDELY } from "./listen-state";

export const SAY_COPY = {
  title: "Say what you ate",
  speakingIn: "Speaking in",
  change: "Change",
  done: "Done",
  close: "Close",

  starting: "Getting your mic…",
  startingSlow: "Still getting your mic…",
  promptLine: "Your browser will ask to use the microphone. Choose Allow.",
  slowLine: "If nothing happens, try again or type it.",
  ready: "Speak now",
  readyHint: "Tap when you're done",
  keyHint: ", or press Space",
  placeholder: "Say what you ate, like 2 rotis, dal and a bowl of curd.",
  quietLine: "Still listening. Speak a little louder, or check the language at the top.",
  hearing: "Listening",
  counting: "Logging this meal",
  countHint: "Tap to log now",
  sayMore: "Say more to add to it.",
  review: "Ready to log",
  reviewHint: "Tap to keep talking",
  nothing: "We didn't hear anything",
  retryHint: "Tap to try again",
  nothingLine: "Check the language at the top, and hold the phone a little closer.",
  blocked: "Your mic is blocked",
  blockedLine: "Allow the microphone for this site in your browser's settings, then try again. Or type what you ate.",
  dictationOff: "Listening is off on this device",
  dictationLine: "On iPhone, turn on Dictation in Settings, then General, then Keyboard. Or type what you ate.",
  offline: "You're offline",
  offlineLine: "This browser needs a connection to turn speech into words. Type what you ate, and log it when you're back online.",
  noMic: "We couldn't find a microphone",
  noMicLine: "Try again, or type what you ate.",
  stopped: "Listening stopped",
  stoppedLine: "Try again, or type what you ate.",

  typeInstead: "Type instead",
  edit: "Edit",
  keepTalking: "Keep talking",
  tryAgain: "Try again",
  logMeal: "Log this meal",
  talkAgain: "Talk again",
  privacy: "Your browser turns your voice into words; some browsers use their maker's servers for this. We only receive the words.",

  // The big control's name, for each state.
  squareStarting: "Getting your mic",
  squareDone: "Done speaking",
  squareLog: "Log now",
  squareKeep: "Keep talking",
  squareRetry: "Try again",
  squareOff: "Mic off",

  // Screen readers. Short, and never the transcript: the mic can hear what's read out.
  sayStarting: "Getting your mic.",
  sayLive: "Listening. Speak now.",
  sayCounting: "Logging this meal in 3 seconds. Choose Keep talking or Edit to stop it.",
  sayReview: "Ready to log.",
} as const;

export const ASK_MIC_COPY = {
  label: "Speak your question",
  labelLive: "Done speaking",
  labelStarting: "Getting your mic",
  starting: "Getting your mic…",
  slow: "Still getting your mic. Tap it to stop, or type your question.",
  live: (s: Spoken) => `Listening in ${s.label}. Tap the mic when you're done.`,
  check: "Check your question, then tap Ask.",
  nothing: "Didn't hear anything. Try again, or type it.",
  blocked: "Your mic is blocked for this site. Type your question instead.",
  dictationOff: "Listening is off on this device. Type your question instead.",
  offline: "You're offline. Type your question, and ask when you're back online.",
  stopped: "Listening stopped. Try again, or type it.",
  noMic: "We couldn't find a microphone. Type your question instead.",
  change: "Change",
} as const;

/** "This browser can't listen in தமிழ்": the language as people see it in the chips. */
export const cantListenIn = (s: Spoken) => `This browser can't listen in ${s.label}`;

const sameEngine = (a: SpokenId, b: SpokenId) => a === b || (LISTENS_WIDELY.includes(a) && a !== "en" && LISTENS_WIDELY.includes(b) && b !== "en");

/**
 * The languages to offer when one can't listen: English and Hindi, never the one that
 * failed (Hinglish and Hindi listen the same way, so one failing rules out both), and
 * none this browser already said it can't do.
 */
export function listenInstead(failed: SpokenId, off: readonly SpokenId[] = []): SpokenId[] {
  return (["en", "hi"] as const).filter((id) => !sameEngine(id, failed) && !off.includes(id));
}

/** "Speak in English or Hindi instead, or type in Tamil. Replies come back in the language you type." */
export function languageLine(failed: Spoken, off: readonly SpokenId[] = []): string {
  const names = listenInstead(failed.id, off).map((id) => spokenById(id).name);
  const speak = names.length ? `Speak in ${names.join(" or ")} instead, or type in ${failed.name}.` : `Type in ${failed.name} instead.`;
  return `${speak} Replies come back in the language you type.`;
}

/** Nothing heard in a language few browsers listen in: say it may be the language. */
export const mayNotListen = (s: Spoken) => (LISTENS_WIDELY.includes(s.id) ? null : `If you were speaking ${s.label}, this browser may not listen in it.`);

/** Ask's line when its mic can't listen in the language: "This browser can't listen in தமிழ்." */
export const askCantListen = (s: Spoken) => `${cantListenIn(s)}.`;
