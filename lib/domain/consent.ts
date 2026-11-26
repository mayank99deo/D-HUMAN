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
