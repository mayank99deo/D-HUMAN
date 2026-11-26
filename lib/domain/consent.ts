// The consent wording's version, and whether someone agreed to it. Pure, so the web's layout
// (lib/platform/views/me.ts), the apps' answers and their write gate all read the same rule.

/**
 * The consent wording's version: the day the current text went live (it added "and
 * questions" for Ask). Someone who agreed before it is asked again in the app. When the
 * app's own consent step names more (Apple's speech service), its new date goes here.
 */
export const CONSENT_VERSION = "2026-11-20";
const CONSENT_SINCE = Date.parse(`${CONSENT_VERSION}T00:00:00+05:30`);

/** Agreed to the current wording: on or after the day it went live. */
export const consentCurrent = (at: Date | null | undefined) => !!at && at.getTime() >= CONSENT_SINCE;

/**
 * The consent step's lines and the day each went live, so the apps can mark the ones added since
 * the person agreed as "New" when they ask again. The ids are the apps' to key their words on.
 */
export const CONSENT_LINES = [
  { id: "health_data", since: "2026-11-09" }, // health answers, reports and meals are stored to give the reads, stacks and wraps
  { id: "ai_processing", since: "2026-11-11" }, // read by Claude, by Anthropic, which may process them outside India
  { id: "ask_questions", since: "2026-11-20" }, // and the questions asked in Ask
] as const;

/** The lines that went live after the person agreed (all of them when they never have). */
export function newConsentLines(agreedAt: Date | null | undefined): string[] {
  return CONSENT_LINES.filter((l) => !agreedAt || agreedAt.getTime() < Date.parse(`${l.since}T00:00:00+05:30`)).map((l) => l.id);
}
