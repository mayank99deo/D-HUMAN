import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays } from "@/lib/domain/periods";
import { sendFounderAlert } from "@/lib/email/send";
import { localDate } from "@/lib/platform/profile";
import { appRefusal } from "./errors";

// Cost guards for the apps (QA's review of lane 1A, finding 1; the mobile repo's docs/API.md §9).
// An app token can set off paid calls the web's own screens rarely do: an event search (about
// $0.13 each) on every change of city, sport or named event, and three usual-day estimates on
// every save. These count them per person, and all app-set-off calls together, in the database
// (app_rate_counts), and refuse past the cap with 429 and Retry-After. Web cookie requests never
// come here: Mayank's call is no cost guards on the web for now.

/** After onboarding, an app may set off this many event searches a person a week (onboarding's own doesn't count). */
export const EVENT_SEARCHES_PER_WEEK = 3;
/**
 * Usual-day saves an app may make a person a day. Five: one description, then room for the
 * corrections the "add amounts" step asks for. Each save is three estimates (about $0.01), so a
 * person can't cost more than about $0.05 a day here. A resend of the same words within 3 minutes
 * reads the saved estimate and isn't counted.
 */
export const USUAL_DAYS_PER_DAY = 5;
/** All app-set-off paid calls in an IST day, across everyone: APP_AI_DAILY_MAX when it's a whole number from 0 up, else this. */
export const APP_AI_DAILY_DEFAULT = 2000;

export const appAiDailyMax = (raw: string | undefined = process.env.APP_AI_DAILY_MAX) => (raw && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : APP_AI_DAILY_DEFAULT);

const IST = "Asia/Kolkata";
const istDay = (now: Date) => localDate(IST, now);
/** The Monday that starts this IST week. */
export function istWeekStart(now: Date): string {
  const day = istDay(now);
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}
const secondsUntil = (day: string, now: Date) => Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00+05:30`) - now.getTime()) / 1000));

/** One more in this subject's window, unless that would pass `max`. Atomic: parallel claims can't pass the cap. */
async function claim(subject: string, window: string, max: number): Promise<boolean> {
  if (max <= 0) return false;
  const d = await db();
  const t = schema.appRateCounts;
  const rows = await d
    .insert(t)
    .values({ subject, window, count: 1 })
    .onConflictDoUpdate({ target: [t.subject, t.window], set: { count: sql`${t.count} + 1`, updatedAt: sql`now()` }, setWhere: sql`${t.count} < ${max}` })
    .returning({ count: t.count });
  return rows.length > 0;
}

/** Tells the founders, once an IST day, that the apps' breaker is refusing paid calls. */
async function breakerAlert(day: string, max: number, now: Date) {
  const marker = `alert:app-ai-cap:${day}`;
  const d = await db();
  const [won] = await d.insert(schema.jobRuns).values({ job: marker, lastStartedAt: now }).onConflictDoNothing().returning({ job: schema.jobRuns.job });
  if (!won) return;
  const outcome = await sendFounderAlert(
    {
      key: `app-ai-cap:${day}`,
      subject: "D-Human: the apps reached today's limit for paid AI calls",
      text: [
        `The apps have set off ${max} paid AI calls today (IST day ${day}): event searches and usual-day saves. The limit, APP_AI_DAILY_MAX, is ${max} a day across everyone.`,
        "Until midnight IST, app requests that would make one more get 429. Meals, reads and the web are not affected.",
        "If this is real use, raise APP_AI_DAILY_MAX in Vercel and redeploy.",
        "",
        "Sent once a day by the app backend. Counts only.",
      ].join("\n"),
    },
    now,
  ).catch(() => ({ status: "failed" as const }));
  if (outcome.status !== "sent") await d.delete(schema.jobRuns).where(eq(schema.jobRuns.job, marker));
}

/** The everyone-together breaker for app-set-off paid calls. Null when allowed, else the 429 to send. */
async function globalBreaker(now: Date): Promise<Response | null> {
  const day = istDay(now);
  const max = appAiDailyMax();
  if (await claim("app-ai", day, max)) return null;
  await breakerAlert(day, max, now).catch((e) => console.error("[app-limits] alert failed:", e instanceof Error ? e.message : e));
  return appRefusal("paused", 429, { message: "This is resting for everyone until midnight. Try again tomorrow.", retryAfter: secondsUntil(addDays(day, 1), now) });
}

/** An app save that would set off an event search: null when allowed, else the 429 to send. */
export async function claimEventSearch(userId: string, now = new Date()): Promise<Response | null> {
  const week = istWeekStart(now);
  if (!(await claim(`events:${userId}`, week, EVENT_SEARCHES_PER_WEEK)))
    return appRefusal("rate_limited", 429, {
      message: "You've changed your city, sport or event a few times this week. Try that change again next week.",
      retryAfter: secondsUntil(addDays(week, 7), now),
    });
  return globalBreaker(now);
}

/** An app usual-day save that will call the AI: null when allowed, else the 429 to send. */
export async function claimUsualDay(userId: string, now = new Date()): Promise<Response | null> {
  const day = istDay(now);
  if (!(await claim(`usual:${userId}`, day, USUAL_DAYS_PER_DAY)))
    return appRefusal("rate_limited", 429, { message: "That's a lot of usual-day saves today. Try again tomorrow.", retryAfter: secondsUntil(addDays(day, 1), now) });
  return globalBreaker(now);
}
