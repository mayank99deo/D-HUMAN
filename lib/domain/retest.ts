// The retest as a date that gets closer: "Retest due 4 Feb, in 12 weeks".
// Counted from the day the blood was taken (or the upload day when the report
// doesn't print one) plus the weeks the read asked for.

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export type Retest = { dueOn: string; days: number; label: string; when: string };

export function retestFrom(from: string, weeks: number, today: string): Retest {
  const due = new Date(parse(from) + Math.round(weeks * 7) * DAY).toISOString().slice(0, 10);
  const days = Math.round((parse(due) - parse(today)) / DAY);
  const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(Math.abs(days) > 300 ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(parse(due)));
  const when =
    days >= 14
      ? `in ${Math.round(days / 7)} weeks`
      : days > 1
        ? `in ${days} days`
        : days === 1
          ? "tomorrow"
          : days === 0
            ? "today"
            : days === -1
              ? "yesterday"
              : days > -14
                ? `${-days} days ago`
                : `${Math.round(-days / 7)} weeks ago`;
  const label = days < 0 ? `Retest was due ${date}, ${when}` : days === 0 ? `Retest due today, ${date}` : `Retest due ${date}, ${when}`;
  return { dueOn: due, days, label, when };
}
