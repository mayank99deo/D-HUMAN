// Calendar periods for wraps, in plain YYYY-MM-DD strings (the person's own dates).
export type Period = "week" | "month" | "year";

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Weeks run Monday to Sunday. `offset` 0 is the current period, -1 the one before.
export function periodRange(period: Period, today: string, offset = 0) {
  const [y, m] = today.split("-").map(Number);
  if (period === "week") {
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const start = addDays(today, -dow + offset * 7);
    return { start, end: addDays(start, 6) };
  }
  if (period === "month") {
    const first = new Date(Date.UTC(y, m - 1 + offset, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
  }
  return { start: `${y + offset}-01-01`, end: `${y + offset}-12-31` };
}

export function periodLabel(period: Period, start: string, end: string) {
  const f = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { ...o, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  if (period === "week") return `${f(start, { day: "numeric", month: "short" })} – ${f(end, { day: "numeric", month: "short" })}`;
  if (period === "month") return f(start, { month: "long", year: "numeric" });
  return start.slice(0, 4);
}

/** How far back a link can open a week's wrap: the wraps API makes wraps up to 60 periods ago. */
export const OLDEST_WEEK_OFFSET = -60;

/**
 * The week a link asks for (/wraps?week=2026-11-16, the Monday it starts, from the weekly
 * email), as a range and an offset from `today`'s week (0 this week, -1 last week), or null
 * when `raw` isn't a real date, is in a week still to come, or is too far back. Any day
 * of a week stands for that week.
 */
export function weekFromParam(raw: unknown, today: string): { start: string; end: string; offset: number } | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const at = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== raw) return null; // e.g. 2026-02-30
  const { start, end } = periodRange("week", raw, 0);
  const offset = Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${periodRange("week", today, 0).start}T00:00:00Z`)) / (7 * 86400000));
  if (offset > 0 || offset < OLDEST_WEEK_OFFSET) return null;
  return { start, end, offset };
}

