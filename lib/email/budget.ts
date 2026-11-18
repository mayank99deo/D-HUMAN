import { EMAIL_BUDGET } from "./types";

// The daily budget for lifecycle email on Resend's free plan (100 emails a day, shared
// with sign-in codes; Mayank, 2026-11-18). Pure, so tests and the jobs lane can use it
// without a database; send.ts does the counting under a lock.
//
//   allowed today = min(EMAIL_DAILY_CAP or 70, 100 − max(sign-in codes today, 30))
//   left now      = allowed today − lifecycle sends today
//
// So lifecycle email never takes more than 70, codes always keep at least 30, and a busy
// sign-in day shrinks lifecycle email rather than codes. Days are UTC days: an assumption
// about how Resend counts its daily limit (its docs say "per day"). What doesn't fit rolls
// to the next run. Codes are never checked against this budget and never wait on it.
//
// Not counted: email sent outside the ledger and login_codes (the waitlist welcome, blog
// review requests, the founders' alert). At a handful a day the 30 kept for codes absorbs them.

/** EMAIL_DAILY_CAP when it's a whole number from 0 up, else 70. */
export function dailyCap(raw: string | undefined = process.env.EMAIL_DAILY_CAP): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return EMAIL_BUDGET.dailyCapDefault;
  return Number(value);
}

export type BudgetInput = {
  codesToday: number;
  lifecycleToday: number;
  cap?: number;
  resendDailyLimit?: number;
  signInReserve?: number;
};

/** Lifecycle sends allowed for the whole UTC day, before subtracting what has gone. */
export function dailyAllowance({ codesToday, cap = dailyCap(), resendDailyLimit = EMAIL_BUDGET.resendDailyLimit, signInReserve = EMAIL_BUDGET.signInReserve }: Omit<BudgetInput, "lifecycleToday">): number {
  return Math.max(0, Math.min(cap, resendDailyLimit - Math.max(codesToday, signInReserve)));
}

/** Lifecycle sends still allowed right now. */
export function lifecycleLeft(input: BudgetInput): number {
  return Math.max(0, dailyAllowance(input) - input.lifecycleToday);
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
