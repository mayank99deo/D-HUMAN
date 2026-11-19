import type { Metadata } from "next";
import { Suspense } from "react";
import { WrapsClient, type PeriodCard, type WeekLink } from "@/components/platform/Wraps";
import { aiMode } from "@/lib/ai/client";
import { weekFromParam } from "@/lib/domain/periods";
import { requireMember } from "@/lib/platform/member";
import { localDate } from "@/lib/platform/profile";
import { loggedDays } from "@/lib/platform/wrap-viewer";
import { hasAnyLogs, listWraps, periodLabel, periodRange, type Period } from "@/lib/platform/wraps";
import { PageLoading } from "@/components/platform/PageLoading";

export const metadata: Metadata = { title: "Wraps" };

type Slot = { period: Period; offset: number; name: string };

const SLOTS: Slot[] = [
  { period: "week", offset: 0, name: "This week" },
  { period: "week", offset: -1, name: "Last week" },
  { period: "month", offset: 0, name: "This month" },
  { period: "month", offset: -1, name: "Last month" },
  { period: "year", offset: 0, name: "This year" },
];

type Search = Promise<Record<string, string | string[] | undefined>>;

// /wraps?week=2026-11-16 (the weekly email's "Play my wrap") opens that week's story at
// once: played if it's made, made first if not. A week older than last week gets its own
// card at the top, so closing the story lands on it.
async function Wraps({ searchParams }: { searchParams: Search }) {
  const { user, profile, persona } = await requireMember();
  const today = localDate(profile.timezone);
  const [all, { week }] = await Promise.all([listWraps(user.id), searchParams]);
  const asked = weekFromParam(week, today);
  const slots = asked && !SLOTS.some((s) => s.period === "week" && s.offset === asked.offset) ? [{ period: "week" as const, offset: asked.offset, name: "Earlier week" }, ...SLOTS] : SLOTS;
  const cards: PeriodCard[] = await Promise.all(
    slots.map(async (s) => {
      const { start, end } = periodRange(s.period, today, s.offset);
      const wrap = all.find((w) => w.period === s.period && w.startsOn === start) ?? null;
      return {
        key: `${s.period}:${s.offset}`,
        period: s.period,
        offset: s.offset,
        name: s.name,
        label: periodLabel(s.period, start, end),
        ongoing: end >= today,
        hasData: wrap ? true : await hasAnyLogs(user.id, start, end),
        wrap: wrap ? { id: wrap.id, title: wrap.story.title, cards: wrap.story.cards, oneThing: wrap.story.one_thing, demo: wrap.model === "mock", made: wrap.createdAt.toISOString() } : null,
      };
    }),
  );
  const askedCard = asked ? cards.find((c) => c.key === `week:${asked.offset}`) : undefined;
  // The days with meals, for the "Wrapping…" screen: only needed when there's a wrap to make.
  const link: WeekLink | null =
    asked && askedCard ? { key: askedCard.key, days: !askedCard.wrap && askedCard.hasData ? await loggedDays(user.id, asked.start) : [] } : null;
  return <WrapsClient cards={cards} firstName={persona.firstName} aiOff={aiMode() === "off"} link={link} />;
}

export default function WrapsPage({ searchParams }: PageProps<"/wraps">) {
  return (
    <Suspense fallback={<PageLoading title="Wraps" />}>
      <Wraps searchParams={searchParams} />
    </Suspense>
  );
}
