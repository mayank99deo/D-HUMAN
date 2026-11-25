import "server-only";

// Talks to the Google Apps Script web app in google-apps-script/Code.gs, authorised by
// GOOGLE_SHEETS_WEBHOOK_SECRET in the body.
// - Waitlist tab: "join" appends one row per email; "update" adds the optional follow-up answers.
// - Feedback tab: "feedback" adds or updates answer rows by Answer ID; "forget" deletes
//   every Feedback and Replies row for one respondent code (account deletion).
// - Users tab (lib/sheets/users.ts): "users" adds or updates account rows by User ID,
//   "users-forget" deletes rows by User ID (account deletion), and "users-ids" lists the
//   IDs in the tab, so the daily job can remove rows of accounts that no longer exist.

export class SheetsConfigError extends Error {}

/**
 * The deployed script predates the Users tab: it treats an action it doesn't know as a
 * waitlist call without an email ("missing_email"), or answers "unknown_action". Mayank
 * pastes the new Code.gs and deploys a new version; until then the site retries each run.
 */
export class SheetsOutdatedError extends Error {}

type SheetResponse =
  | {
      ok: true;
      status: "created" | "exists" | "updated" | "saved" | "forgotten" | "listed";
      saved?: number;
      added?: number;
      deleted?: number;
      ids?: unknown;
    }
  | { ok: false; error: string };

export type JoinRow = {
  email: string;
  source: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
};

export type DetailsRow = {
  email: string;
  firstName?: string;
  city?: string;
  plan?: string;
  training?: string;
  whatsapp?: string;
};

/**
 * One row of the Feedback tab. No health data beyond what someone types, and no email
 * address unless they ticked "You can email me about this" (then `email` is set).
 */
export type FeedbackSheetRow = {
  answerId: string; // feedback_answers.id; the script updates the row with this ID or appends one
  receivedAt: string; // ISO time of the first answer
  updatedAt: string; // ISO time of the latest change
  survey: string;
  respondent: string; // r_ + 12 hex, from lib/email/feedback.ts
  path: string; // used | barely | "" (Settings)
  question: string;
  answer: string; // the option's words, the score, or the typed note
  plan: "free" | "pass";
  daysSinceOnboarding: number | null;
  daysWithMeals: number;
  language: string;
  source: string; // email_tap | page | settings
  email: string; // "" unless they agreed to be contacted
};

/**
 * One row of the Users tab. lib/sheets/user-row.ts builds it; its comment lists what never
 * goes in. Dates are Indian time as "YYYY-MM-DD HH:MM", or "" when there's none.
 */
export type UserSheetRow = {
  id: string; // "u_" + 12 hex characters of the account's id (userKey)
  founder: "Yes" | "No";
  name: string;
  email: string;
  signedUp: string;
  onboarded: string;
  lastActive: string;
  language: string;
  city: string;
  age: number | null;
  sex: string;
  activity: string;
  level: string;
  goals: string;
  diet: string;
  plan: string; // "Free" or "Pass until 04 Dec 2026"
  payments: number;
  meals: number;
  reports: number;
  weeklyEmail: "On" | "Off" | "Paused";
  synced: string;
};

type SheetPayload =
  | ({ action: "join" } & JoinRow)
  | ({ action: "update" } & DetailsRow)
  | { action: "feedback"; rows: FeedbackSheetRow[] }
  | { action: "forget"; respondent: string }
  | { action: "users"; rows: UserSheetRow[] }
  | { action: "users-forget"; ids: string[] }
  | { action: "users-ids" };

/** Whether the web app's URL and secret are set (locally they usually aren't). */
export const sheetsConfigured = () => Boolean(process.env.GOOGLE_SHEETS_WEBHOOK_URL && process.env.GOOGLE_SHEETS_WEBHOOK_SECRET);

async function callSheet(payload: SheetPayload, timeoutMs = 10_000): Promise<Extract<SheetResponse, { ok: true }>> {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) {
    throw new SheetsConfigError(
      "GOOGLE_SHEETS_WEBHOOK_URL and GOOGLE_SHEETS_WEBHOOK_SECRET must be set",
    );
  }

  // Apps Script answers a POST with a 302 to googleusercontent.com, which
  // fetch follows as a GET to read the script's JSON output.
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, ...payload }),
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let result: SheetResponse;
  try {
    result = JSON.parse(text) as SheetResponse;
  } catch {
    throw new Error(
      `Sheets webhook returned ${response.status} with a non-JSON body: ${text.slice(0, 200)}`,
    );
  }
  if (!result.ok) {
    if (payload.action.startsWith("users") && (result.error === "missing_email" || result.error === "unknown_action")) {
      throw new SheetsOutdatedError(`The deployed Apps Script doesn't know "${payload.action}" yet (${result.error})`);
    }
    throw new Error(`Sheets webhook refused "${payload.action}": ${result.error}`);
  }
  return result;
}

export async function appendSignup(row: JoinRow) {
  return (await callSheet({ action: "join", ...row })).status as "created" | "exists";
}

export async function updateSignup(row: DetailsRow) {
  return (await callSheet({ action: "update", ...row })).status as "updated";
}

/** Adds or updates answer rows in the Feedback tab. Resolves once the Sheet has them; throws otherwise. */
export async function appendFeedback(rows: FeedbackSheetRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await callSheet({ action: "feedback", rows });
  return result.saved ?? rows.length;
}

/** Deletes every Feedback and Replies row for a respondent code. Returns how many went. */
export async function forgetRespondent(respondent: string): Promise<number> {
  const result = await callSheet({ action: "forget", respondent });
  return result.deleted ?? 0;
}

/** A batch of up to 200 rows takes the script a few seconds, and a cold start adds more. */
const USERS_TIMEOUT_MS = 25_000;

/** Adds or updates rows in the Users tab by User ID. Resolves once the Sheet has them; throws otherwise. */
export async function upsertUsers(rows: UserSheetRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await callSheet({ action: "users", rows }, USERS_TIMEOUT_MS);
  return result.saved ?? rows.length;
}

/** Deletes every Users row with one of these User IDs. Returns how many rows went. */
export async function forgetUsers(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await callSheet({ action: "users-forget", ids }, USERS_TIMEOUT_MS);
  return result.deleted ?? 0;
}

/** Every User ID in the Users tab. Throws when the Sheet doesn't answer with a list. */
export async function listUserIds(): Promise<string[]> {
  const result = await callSheet({ action: "users-ids" }, USERS_TIMEOUT_MS);
  if (!Array.isArray(result.ids)) throw new Error('Sheets webhook answered "users-ids" without a list');
  return result.ids.filter((id): id is string => typeof id === "string");
}
