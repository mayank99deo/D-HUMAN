// How an on/off switch in Vercel's environment is read: one rule for the daily job
// (lib/email/jobs.ts) and the founders' status page (/write/status), so the page can't
// say "on" while the job reads "off". Pure.

/** "1", "true", "yes" or "on", in any case, with spaces around ignored. Anything else is off. */
export const isOn = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");

/**
 * For the status page: "unrecognised" when a value is set but doesn't read as on (a typo,
 * or quotes typed into Vercel's field). It names the problem without showing the value.
 */
export type SwitchState = "on" | "off" | "unrecognised";

export function switchState(value: string | undefined): SwitchState {
  if (!value?.trim()) return "off";
  return isOn(value) ? "on" : "unrecognised";
}
