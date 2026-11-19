// Settings → Emails, the part that can be tested in Node: what the switches show and how a
// change is saved through /api/email/prefs (components/platform/EmailSettings.tsx).

export type EmailSwitches = { weekly: boolean; questions: boolean; weeklyPaused: boolean };
export type EmailSwitch = "weekly" | "questions";

/** Whether a switch shows on. A paused weekly email shows off: turning it on restarts it. */
export function switchOn(prefs: EmailSwitches, key: EmailSwitch): boolean {
  return key === "weekly" ? prefs.weekly && !prefs.weeklyPaused : prefs[key];
}

type Post = (url: string, init: { body: unknown }) => Promise<{ ok: boolean; offline: boolean; data: Partial<EmailSwitches> & { error?: string } }>;

export type SaveResult = { ok: true; prefs: EmailSwitches } | { ok: false; message: string };

/**
 * Turns one email on or off. The settings come back from the server, so the screen shows
 * what is saved, never a guess; on any failure it says so and the screen keeps what it had.
 */
export async function saveSwitch(post: Post, key: EmailSwitch, on: boolean): Promise<SaveResult> {
  const r = await post("/api/email/prefs", { body: { [key]: on } });
  const { weekly, questions, weeklyPaused } = r.data;
  if (r.ok && typeof weekly === "boolean" && typeof questions === "boolean") {
    return { ok: true, prefs: { weekly, questions, weeklyPaused: Boolean(weeklyPaused) } };
  }
  return { ok: false, message: r.offline ? "Not saved. No connection; check your signal and try again." : "Not saved. Try again in a minute." };
}
