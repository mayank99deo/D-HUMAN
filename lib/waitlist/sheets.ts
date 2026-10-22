import "server-only";

// Talks to the Google Apps Script web app in google-apps-script/Code.gs.
// The script appends one row per email and updates that row with the
// optional follow-up answers.

export class SheetsConfigError extends Error {}

type SheetResponse =
  | { ok: true; status: "created" | "exists" | "updated" }
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

async function callSheet(action: "join" | "update", payload: JoinRow | DetailsRow) {
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
    body: JSON.stringify({ secret, action, ...payload }),
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
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
  if (!result.ok) throw new Error(`Sheets webhook refused "${action}": ${result.error}`);
  return result.status;
}

export function appendSignup(row: JoinRow) {
  return callSheet("join", row) as Promise<"created" | "exists">;
}

export function updateSignup(row: DetailsRow) {
  return callSheet("update", row) as Promise<"updated">;
}
