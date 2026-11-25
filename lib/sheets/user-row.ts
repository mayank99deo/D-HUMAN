import { createHash } from "node:crypto";
import { isOwnerEmail } from "@/lib/auth/owners";
import { ACTIVITIES, DIETS, GOALS, LANGUAGES, LEVELS, SEXES, labelOf } from "@/lib/domain/options";
import { DEFAULT_EMAIL_PREFS } from "@/lib/email/types";
import type { UserSheetRow } from "@/lib/waitlist/sheets";

// One account's row in the founders' Google Sheet (the Users tab, google-apps-script/Code.gs).
// Pure, so the tests can check exactly what leaves the database.
//
// In the Sheet: a short User ID, founder or not, name, email, when they signed up, finished
// onboarding and were last active (Indian time), language, city, age, sex, main activity
// and level, goals, diet, plan, number of payments, meals logged, reports uploaded, and
// whether the weekly email is on.
//
// Never in the Sheet: weight, height, medicines, health conditions (pregnancy among them),
// current supplements, the "Fix a known deficiency" goal (it says the person has one),
// blood report markers, reads and stacks, meal contents, Ask questions and answers,
// feedback answers or the respondent code that would link them to a name, payment and
// order IDs and amounts. Those are health or sensitive data. lib/sheets/users.ts selects
// only the columns UserFacts names, so the rest never leaves the database.

/** What one row is built from: lib/sheets/users.ts reads these, and only these. */
export type UserFacts = {
  id: string;
  email: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  name: string | null;
  birthYear: number | null;
  sex: string | null;
  city: string | null;
  language: string | null;
  primaryActivity: string | null;
  level: string | null;
  goals: string[] | null;
  diet: string | null;
  onboardedAt: Date | null;
  profileUpdatedAt: Date | null;
  weekly: boolean | null; // null: no email_prefs row, so the default
  weeklyPausedAt: Date | null;
  meals: number;
  lastMealAt: Date | null;
  reports: number;
  lastReportAt: Date | null;
  payments: number; // paid passes, in the current Razorpay mode
  passActive: boolean;
  passUntil: Date | null; // the end of the furthest paid pass, a queued one included
};

/** The fields of the row, in the Sheet's column order (Code.gs's USER_COLUMNS). */
export const USER_SHEET_FIELDS = [
  "id",
  "founder",
  "name",
  "email",
  "signedUp",
  "onboarded",
  "lastActive",
  "language",
  "city",
  "age",
  "sex",
  "activity",
  "level",
  "goals",
  "diet",
  "plan",
  "payments",
  "meals",
  "reports",
  "weeklyEmail",
  "synced",
] as const satisfies readonly (keyof UserSheetRow)[];

/** Profile fields shown in the Sheet: a Settings change to one of these updates the row at once. */
export const SHEET_PROFILE_FIELDS = ["name", "birthYear", "sex", "city", "language", "primaryActivity", "level", "goals", "diet"] as const;

/** Goals left out of the Sheet because they say something about the person's health. */
const HEALTH_GOALS = new Set(["deficiency"]);

export const USER_KEY = /^u_[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-([0-9a-f]{12})$/i;

/**
 * The account's ID in the Sheet: "u_" and the last 12 hex characters of its UUID (48 random
 * bits, so two accounts sharing one is about a 1 in 50,000 chance at 100,000 accounts). Find
 * the account with `where id like '%<those 12>'`. Not the feedback respondent code, which
 * stays unlinkable to a name. An id that isn't a UUID gets 12 characters of its SHA-256.
 */
export function userKey(id: string): string {
  const m = UUID.exec(id);
  return `u_${m ? m[1].toLowerCase() : createHash("sha256").update(id).digest("hex").slice(0, 12)}`;
}

// India has one time zone and no daylight saving: IST is always UTC+5:30.
const IST_OFFSET_MS = 330 * 60_000;
const istIso = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString();
/** "2026-11-25 14:30" in Indian time, or "" without a moment. */
export const istStamp = (d: Date | null | undefined): string => (d ? istIso(d).slice(0, 16).replace("T", " ") : "");
/** The Indian calendar day, "2026-11-25". */
export const istDay = (d: Date): string => istIso(d).slice(0, 10);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "04 Dec 2026", the Indian calendar day. */
export function istDate(d: Date): string {
  const [y, m, day] = istDay(d).split("-");
  return `${day} ${MONTHS[Number(m) - 1]} ${y}`;
}

const latest = (dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((best, d) => (d && (!best || d > best) ? d : best), null);

const label = (list: Parameters<typeof labelOf>[0], id: string | null | undefined) => (id ? labelOf(list, id) : "");

/** True when a profile save changed something the Sheet shows. */
export function sheetFieldsChanged(before: Partial<Record<(typeof SHEET_PROFILE_FIELDS)[number], unknown>> | null, after: Record<(typeof SHEET_PROFILE_FIELDS)[number], unknown>): boolean {
  if (!before) return true;
  return SHEET_PROFILE_FIELDS.some((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

/**
 * The row for one account. "Last active" is their latest sign-in, meal, report upload or
 * profile save: the app doesn't record plain visits. Age comes from the birth year alone,
 * so it can be a year high until their birthday. `owners` is BLOG_OWNER_EMAILS (the founders).
 */
export function userSheetRow(f: UserFacts, now: Date, owners?: string): UserSheetRow {
  const weekly = f.weekly ?? DEFAULT_EMAIL_PREFS.weekly;
  return {
    id: userKey(f.id),
    founder: isOwnerEmail(f.email, owners) ? "Yes" : "No",
    name: f.name?.trim() ?? "",
    email: f.email,
    signedUp: istStamp(f.createdAt),
    onboarded: istStamp(f.onboardedAt),
    lastActive: istStamp(latest([f.createdAt, f.lastSeenAt, f.lastMealAt, f.lastReportAt, f.profileUpdatedAt])),
    language: label(LANGUAGES, f.language),
    city: f.city?.trim() ?? "",
    age: f.birthYear ? Math.max(0, Number(istDay(now).slice(0, 4)) - f.birthYear) : null,
    sex: label(SEXES, f.sex),
    activity: label(ACTIVITIES, f.primaryActivity),
    level: label(LEVELS, f.level),
    goals: (f.goals ?? [])
      .filter((g) => !HEALTH_GOALS.has(g))
      .map((g) => labelOf(GOALS, g))
      .join(", "),
    diet: label(DIETS, f.diet),
    plan: f.passActive && f.passUntil ? `Pass until ${istDate(f.passUntil)}` : "Free",
    payments: f.payments,
    meals: f.meals,
    reports: f.reports,
    weeklyEmail: !weekly ? "Off" : f.weeklyPausedAt ? "Paused" : "On",
    synced: istStamp(now),
  };
}
