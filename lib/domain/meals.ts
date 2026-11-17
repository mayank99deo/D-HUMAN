// Logged meals as the screens show them: the shape Fuel, Past meals and Home get,
// the order meals sit in a day, and how far back the history goes.
import { addDays } from "./periods";

export type MealView = {
  id: string;
  meal: string;
  title: string;
  source: string;
  kcal: number;
  proteinG: number;
  confidence: string | null;
  tip: string | null;
  items: string[];
  demo: boolean;
  /** When it was logged, on the person's clock ("8:40 am"). Only where the screen shows it. */
  time?: string;
  /** The language the title and tip are written in, as an HTML lang tag. */
  lang?: string;
};

export const MEAL_ORDER = ["breakfast", "lunch", "snack", "dinner"];

/** Past meals reach back this many days before today. Older logs stay, and still count in wraps. */
export const HISTORY_DAYS = 28;

/** "Yesterday", else "Sat, 14 Nov", for a YYYY-MM-DD date in the person's calendar. */
export function dayLabel(day: string, today: string): string {
  if (day === addDays(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}
