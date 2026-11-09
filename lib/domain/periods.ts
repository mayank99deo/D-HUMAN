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

