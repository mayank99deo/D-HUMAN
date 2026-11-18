import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { readStopToken } from "./tokens";
import { DEFAULT_EMAIL_PREFS, KIND_CATEGORY, type EmailCategory, type EmailKind, type PrefsUpdatedVia, type StopTokenPayload } from "./types";

// Who gets which lifecycle email. No email_prefs row means the defaults: both on
// (Mayank, 2026-11-18). Sign-in codes and payment receipts aren't covered: they always go.

const prefs = schema.emailPrefs;

export type EmailPrefs = Record<EmailCategory, boolean> & { weeklyPausedAt: Date | null };
export type PrefChanges = Partial<Record<EmailCategory, boolean>>;

const defaults = (): EmailPrefs => ({ ...DEFAULT_EMAIL_PREFS, weeklyPausedAt: null });
const toPrefs = (row: { weekly: boolean; questions: boolean; weeklyPausedAt: Date | null }): EmailPrefs => ({
  weekly: row.weekly,
  questions: row.questions,
  weeklyPausedAt: row.weeklyPausedAt,
});

/** Whether `kind` may go to someone with these settings. One-off welcomes always may. */
export function kindAllowed(p: EmailPrefs, kind: EmailKind): boolean {
  const category = KIND_CATEGORY[kind];
  if (!category) return true;
  if (category === "weekly") return p.weekly && !p.weeklyPausedAt;
  return p[category];
}

export async function getPrefs(userId: string): Promise<EmailPrefs> {
  const d = await db();
  const [row] = await d.select().from(prefs).where(eq(prefs.userId, userId)).limit(1);
  return row ? toPrefs(row) : defaults();
}

// A foreign-key violation: the person was deleted. Drizzle wraps driver errors, so look one level down too.
function isMissingPerson(error: unknown): boolean {
  const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined);
  return code(error) === "23503" || code((error as { cause?: unknown })?.cause) === "23503";
}

/**
 * Changes someone's settings and returns the new ones, or null if the account no longer
 * exists. Turning the weekly email on clears a pause. Safe to repeat.
 */
export async function setPrefs(userId: string, changes: PrefChanges, via: PrefsUpdatedVia, now = new Date()): Promise<EmailPrefs | null> {
  const d = await db();
  const set: Partial<typeof prefs.$inferInsert> = { updatedVia: via, updatedAt: now };
  if (typeof changes.weekly === "boolean") set.weekly = changes.weekly;
  if (typeof changes.questions === "boolean") set.questions = changes.questions;
  if (changes.weekly === true) set.weeklyPausedAt = null;
  try {
    const [row] = await d
      .insert(prefs)
      .values({ userId, ...set })
      .onConflictDoUpdate({ target: prefs.userId, set })
      .returning();
    return toPrefs(row);
  } catch (error) {
    if (isMissingPerson(error)) return null;
    throw error;
  }
}

/** After several weekly emails in a row went untapped (jobs lane). Keeps the first pause time. */
export async function pauseWeekly(userId: string, now = new Date()): Promise<void> {
  const d = await db();
  try {
    await d
      .insert(prefs)
      .values({ userId, weeklyPausedAt: now })
      .onConflictDoUpdate({ target: prefs.userId, set: { weeklyPausedAt: sql`coalesce(${prefs.weeklyPausedAt}, excluded.weekly_paused_at)` } });
  } catch (error) {
    if (!isMissingPerson(error)) throw error;
  }
}

export type StopLinkState =
  | { status: "invalid" }
  | { status: "gone"; category: EmailCategory }
  | { status: "ok"; token: StopTokenPayload; prefs: EmailPrefs };

/**
 * What the stop page shows for a link. Reads only: opening a link must never change
 * anything, because mail scanners open every link (some run its JavaScript too). The
 * email stops only when the person taps the page's button.
 */
export async function stopLinkState(token: unknown): Promise<StopLinkState> {
  const payload = readStopToken(token);
  if (!payload) return { status: "invalid" };
  const d = await db();
  const [row] = await d
    .select({ id: schema.users.id, weekly: prefs.weekly, questions: prefs.questions, weeklyPausedAt: prefs.weeklyPausedAt })
    .from(schema.users)
    .leftJoin(prefs, eq(prefs.userId, schema.users.id))
    .where(eq(schema.users.id, payload.u))
    .limit(1);
  if (!row) return { status: "gone", category: payload.k };
  const p = row.weekly === null || row.questions === null ? defaults() : toPrefs({ weekly: row.weekly, questions: row.questions, weeklyPausedAt: row.weeklyPausedAt });
  return { status: "ok", token: payload, prefs: p };
}
