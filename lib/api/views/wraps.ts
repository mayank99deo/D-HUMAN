import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { aiMode } from "@/lib/ai/client";
import { db, schema } from "@/lib/db";
import type { Profile } from "@/lib/db/schema";
import { markerDef } from "@/lib/domain/markers";
import { weekFromParam } from "@/lib/domain/periods";
import { asFlag } from "@/lib/domain/safety";
import { localDate } from "@/lib/platform/profile";
import { hasAnyLogs, listWraps, periodLabel, periodRange, type Period, type WrapRow } from "@/lib/platform/wraps";

// The apps' Wraps (lib/api/schemas.ts WrapsResponse): the same period cards the web's /wraps page
// lists, from the same loaders. The page carries no health words of its own, so it stays as it
// is. Two additions for the apps: ?period=week lists weeks only (gap G5, v1's Wraps tab), and
// each marker card says whether it names a result flagged for a doctor (gap G12), so the app can
// leave it out. The web's wraps are unchanged.

type Slot = { period: Period; offset: number; name: string };

/** The web page's slots (app/(platform)/(app)/wraps/page.tsx), in its order and words. */
const SLOTS: Slot[] = [
  { period: "week", offset: 0, name: "This week" },
  { period: "week", offset: -1, name: "Last week" },
  { period: "month", offset: 0, name: "This month" },
  { period: "month", offset: -1, name: "Last month" },
  { period: "year", offset: 0, name: "This year" },
];

export async function wrapsData(userId: string, profile: Profile, o: { weeksOnly: boolean; week: string | null }, now = new Date()) {
  const today = localDate(profile.timezone, now);
  const d = await db();
  // Results flagged for a doctor in any of the person's reports, for G12, beside the wraps.
  const [all, flagged] = await Promise.all([
    listWraps(userId),
    d
      .select({ key: schema.markers.key, name: schema.markers.name, flag: schema.markers.flag, at: schema.reports.createdAt })
      .from(schema.markers)
      .innerJoin(schema.reports, eq(schema.reports.id, schema.markers.reportId))
      .where(and(eq(schema.markers.userId, userId), isNotNull(schema.markers.flag)))
      .orderBy(desc(schema.reports.createdAt)),
  ]);
  const asked = weekFromParam(o.week, today);
  const base = o.weeksOnly ? SLOTS.filter((s) => s.period === "week") : SLOTS;
  const slots = asked && !base.some((s) => s.period === "week" && s.offset === asked.offset) ? [{ period: "week" as const, offset: asked.offset, name: "Earlier week" }, ...base] : base;
  const cards = await Promise.all(
    slots.map(async (s) => {
      const { start, end } = periodRange(s.period, today, s.offset);
      const wrap = all.find((w) => w.period === s.period && w.startsOn === start) ?? null;
      return { slot: s, start, end, wrap, hasData: wrap ? true : await hasAnyLogs(userId, start, end) };
    }),
  );
  return { today, cards, flagged: flagged.flatMap((m) => (asFlag(m.flag) ? [{ names: [m.name, markerDef(m.key)?.name, markerDef(m.key)?.short].filter((x): x is string => !!x), flag: asFlag(m.flag)! }] : [])), aiOff: aiMode() === "off" };
}

type WrapsData = Awaited<ReturnType<typeof wrapsData>>;

/** A marker card's flag: the worst flag among the flagged results whose name the card's words use. */
function cardFlag(card: { big: string; label: string; line: string }, flagged: WrapsData["flagged"]): "doctor" | "urgent" | null {
  const words = `${card.big} ${card.label} ${card.line}`.toLowerCase();
  const hits = flagged.filter((f) => f.names.some((n) => n.length >= 2 && words.includes(n.toLowerCase())));
  return hits.some((h) => h.flag === "urgent") ? "urgent" : hits.length ? "doctor" : null;
}

const storyJson = (w: WrapRow, flagged: WrapsData["flagged"]) => ({
  id: w.id,
  title: w.story.title,
  cards: w.story.cards.map((c) => ({ kind: c.kind, big: c.big, label: c.label, line: c.line, flag: c.kind === "marker" ? cardFlag(c, flagged) : null })),
  oneThing: w.story.one_thing,
  demo: w.model === "mock",
  made: w.createdAt.toISOString(),
});

/** GET /api/wraps: each period's card as the web lists it, with its story when made. */
export function wrapsJson(data: WrapsData) {
  return {
    day: data.today,
    cards: data.cards.map(({ slot, start, end, wrap, hasData }) => ({
      key: `${slot.period}:${slot.offset}`,
      period: slot.period,
      offset: slot.offset,
      name: slot.name,
      label: periodLabel(slot.period, start, end),
      start,
      end,
      ongoing: end >= data.today,
      hasData,
      wrap: wrap ? storyJson(wrap, data.flagged) : null,
    })),
    aiOff: data.aiOff,
  };
}
