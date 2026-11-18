import { EMAIL_BUDGET } from "./types";

// The daily budget for lifecycle email on Resend's free plan (100 emails a day, shared
// with sign-in codes; Mayank, 2026-11-18). Pure, so tests and the jobs lane can use it
// without a database; send.ts re-reads the counts under a lock before every send.
//
//   left now = min( EMAIL_DAILY_CAP (70) − lifecycle today,
//                   (100 − 30) − (codes today + lifecycle today + other email today) )
//
// "Other email" is everything else that uses the 100: the waitlist welcome and the
// founders' alert (email_daily_counts). So a lifecycle email goes only while at least 30
// of the day's 100 are still free for sign-in codes, counting the codes already sent:
// late-day codes keep their room as far as the day allows.
//
// The edge that remains: lifecycle email can't see codes that haven't been asked for yet.
// If a run fills the day up to 70 and more than 30 codes are asked for after it, the codes
// past 100 bounce off Resend's limit. Codes are never checked against this budget and never
// wait on it. Days are UTC days: an assumption about how Resend counts "a day".

/** EMAIL_DAILY_CAP when it's a whole number from 0 up, else 70. */
export function dailyCap(raw: string | undefined = process.env.EMAIL_DAILY_CAP): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return EMAIL_BUDGET.dailyCapDefault;
  return Number(value);
}

export type BudgetInput = {
  codesToday: number;
  lifecycleToday: number;
  /** Waitlist welcomes and founders' alerts sent today. */
  otherToday?: number;
  cap?: number;
  resendDailyLimit?: number;
  signInReserve?: number;
};

/** Lifecycle sends allowed right now. */
export function lifecycleLeft({
  codesToday,
  lifecycleToday,
  otherToday = 0,
  cap = dailyCap(),
  resendDailyLimit = EMAIL_BUDGET.resendDailyLimit,
  signInReserve = EMAIL_BUDGET.signInReserve,
}: BudgetInput): number {
  const underCap = cap - lifecycleToday;
  const roomForCodes = resendDailyLimit - signInReserve - (codesToday + lifecycleToday + otherToday);
  return Math.max(0, Math.min(underCap, roomForCodes));
}

/** The founders' "weekly list is nearing the cap" alert: 56 people at the default cap of 70. */
export function alertThreshold(cap = dailyCap()): number {
  // The tiny margin keeps float noise (cap × 0.8 = 56.000…01) from pushing it to the next person.
  return Math.ceil(cap * EMAIL_BUDGET.alertAt - 1e-9);
}

export function shouldAlert(weeklyDue: number, cap = dailyCap()): boolean {
  return cap > 0 && weeklyDue >= alertThreshold(cap);
}

/** Midnight UTC at the start of `now`'s UTC day: the budget's day. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The budget's day as YYYY-MM-DD (email_daily_counts.day). */
export const utcDay = (now: Date) => utcDayStart(now).toISOString().slice(0, 10);
