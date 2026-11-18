// The weekly wrap email (UX spec §4, with Mayank's timing): sent on Sunday evening for
// Monday to Sunday so far, so it says "your week so far", never "your week is wrapped".
// Three versions, chosen by the job (data.version):
//   full    3 or more days logged: the seven squares, one big number, two small ones
//   light   1 or 2 days logged: the squares and the days logged
//   report  a report read and no meals: a count of reports, never what one said
// No calories, no weight, no markers, no streaks, and nothing that goes down: "up from"
// shows only when this week is higher. The subject and preheader carry no food data.

import type { RenderedEmail, WeeklyData } from "../types.ts";
import {
  TYPE,
  band,
  bigStat,
  brandify,
  button,
  card,
  clip,
  cleanName,
  dateSpan,
  esc,
  footer,
  hero,
  link,
  page,
  para,
  plural,
  statTiles,
  storyBar,
  textOf,
  weekSquares,
  type TemplateFrame,
  type Tile,
} from "./parts.ts";

/** What the contract leaves out and the job may add. Both default to off. */
export type WeeklyExtras = {
  /** Show "Logging a meal takes…" in the light version; leave it off when free meal logs are used up (UX decision 6). */
  canLogMore?: boolean;
  /** The first weekly email this person gets: one "New:" line in the footer (UX decision 1). */
  firstOfKind?: boolean;
};

export const WEEKLY_SUBJECT = "Your week so far";
export const WEEKLY_PREHEADER = "What you ate, what went well, and one thing to try in the week ahead.";

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

/** A tile, and how the plain-text part says it. */
type Said = Tile & { say: string };

const BY: Record<NonNullable<WeeklyData["loggedMostlyBy"]>, Said> = {
  photo: { value: "Photo", label: "how you logged most meals", say: "Logged mostly by photo." },
  voice: { value: "Voice", label: "how you logged most meals", say: "Logged mostly by voice." },
  text: { value: "Typed", label: "how you logged most meals", say: "Logged mostly by typing." },
  mixed: { value: "Mixed", label: "how you logged meals", say: "Logged by a mix of photo, voice and typing." },
};

export function weeklyEmail(data: WeeklyData & WeeklyExtras, frame: TemplateFrame): RenderedEmail {
  const name = cleanName(frame.firstName);
  const span = dateSpan(data.weekStart, data.weekEnd);
  const wrap = link(frame, data.wrapUrl);
  const target = data.proteinTargetG != null && data.proteinTargetG > 0 ? Math.round(data.proteinTargetG) : null;
  const days = Math.max(0, Math.min(7, data.daysLogged));
  const reached = Math.max(0, Math.min(days, data.proteinReachedDays));
  const version = data.version;

  const headline =
    version === "report"
      ? name ? `${name}, your week had a report in it.` : "Your week had a report in it."
      : version === "light"
        ? name ? `${name}, here's your week so far.` : "Here's your week so far."
        : name ? `${name}, your week so far.` : "Your week so far.";

  const summary =
    reached > 0
      ? `Logged on ${plural(days, "day", "days")} so far. Protein aim reached on ${reached}.`
      : `Logged on ${plural(days, "day", "days")} so far.`;

  // ── The card ────────────────────────────────────────────────────────────
  const html: string[] = [];
  const text: (string | string[])[] = [];
  const play = button("Play my wrap", wrap);
  const playText = `Play my wrap: ${wrap}`;
  const AFTER_PLAY = "About half a minute, card by card. The last card is one thing to try in the week ahead.";

  if (version === "report") {
    const reports = Math.max(1, data.reportsRead);
    const body = "Your wrap puts it next to your week. Log a few meals in the coming days, and next Sunday's wrap has your food in it too.";
    html.push(bigStat(plural(reports, "report", "reports"), "read this week"), para(esc(body), { margin: "12px 0 0" }), play);
    text.push([plural(reports, "report", "reports"), "read this week"], body, playText);
  } else if (version === "light") {
    const word = NUMBER_WORDS[days] ?? String(days);
    const body = `${word} ${days === 1 ? "day is" : "days is"} enough for a wrap: what you ate, your protein on ${days === 1 ? "that day" : "those days"}, and one thing to try.`;
    const more = data.canLogMore ? "Logging a meal takes a photo, a sentence or a few typed words." : null;
    html.push(bigStat(plural(days, "day", "days"), "logged so far this week"), para(esc(body), { margin: "12px 0 0" }));
    if (more) html.push(para(esc(more), { margin: "8px 0 0" }));
    html.push(play);
    text.push([plural(days, "day", "days"), "logged so far this week"], body, more ?? "", playText);
  } else {
    // Full: the big number, in the UX spec's order.
    if (reached > 0) {
      const label = `logged days you reached your protein aim${target ? ` of ${target} g` : ""}`;
      html.push(bigStat(`${reached} of ${days}`, label));
      text.push([`${reached} of ${days}`, label]);
    } else {
      html.push(bigStat(plural(days, "day", "days"), "logged this week"));
      text.push([plural(days, "day", "days"), "logged this week"]);
      if (target && data.avgProteinG != null && data.avgProteinG > 0) {
        const line = `Protein averaged ${Math.round(data.avgProteinG)} g on those days; your aim is ${target} g. Your wrap has an idea for that.`;
        html.push(para(esc(line), { margin: "8px 0 0" }));
        text.push(line);
      }
    }
    if (data.upFromDays != null && data.upFromDays >= 1 && data.upFromDays < days) {
      const up = `Up from ${plural(data.upFromDays, "logged day", "logged days")} the week before.`;
      html.push(para(esc(up), { margin: "6px 0 0" }));
      text.push(up);
    }

    const meals = Math.max(0, data.mealsLogged);
    const mealsLabel = meals === 1 ? "meal logged" : "meals logged";
    const tiles: Said[] = [{ value: String(meals), label: mealsLabel, say: `${meals} ${mealsLabel}.` }];
    if (data.topFood && data.topFood.times >= 2 && data.topFood.title.trim()) {
      const title = clip(data.topFood.title);
      const times = data.topFood.times;
      tiles.push({ value: title, label: `most logged, ${times} times`, lang: data.topFood.lang, say: `Most logged: ${title}, ${times} times.` });
    } else if (data.loggedMostlyBy) {
      tiles.push(BY[data.loggedMostlyBy]);
    }
    html.push(statTiles(tiles), play);
    text.push(tiles.map((t) => t.say), playText);
  }
  html.push(para(esc(AFTER_PLAY), { type: TYPE.note, margin: "14px 0 0" }));
  text.push(AFTER_PLAY);

  // ── Footer ──────────────────────────────────────────────────────────────
  const why =
    version === "report"
      ? "You're getting this because D-Human read a report for you this week. Wraps come on Sunday evenings, only after a week with something in it."
      : "You're getting this because you logged meals in D-Human this week. Wraps come on Sunday evenings, only after a week with something in it.";
  const foot = footer({
    frame,
    top: data.firstOfKind ? ["New: your week by email, on Sunday evenings. Not for you? The stop link is just below."] : [],
    stopLabel: "Stop weekly wraps",
    why,
    aiNote: version === "report" ? "Report reads are by AI and aren't a diagnosis." : "Meal numbers are AI estimates from what you logged.",
  });

  const rows = [
    hero({ headline, sub: brandify(esc(span)), above: storyBar() }),
    version === "report" ? "" : band(weekSquares(data.days, summary)),
    card(html.join("\n")),
    foot.html,
  ].filter(Boolean);

  return {
    subject: WEEKLY_SUBJECT,
    preheader: WEEKLY_PREHEADER,
    html: page({ subject: WEEKLY_SUBJECT, preheader: WEEKLY_PREHEADER, frame, rows }),
    text: textOf([[headline, span], version === "report" ? null : summary, ...text, foot.text]),
  };
}
