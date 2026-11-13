import type { Metadata } from "next";
import { Suspense } from "react";
import { WrapsClient, type PeriodCard } from "@/components/platform/Wraps";
import { aiMode } from "@/lib/ai/client";
import { requireMember } from "@/lib/platform/member";
import { localDate } from "@/lib/platform/profile";
import { hasAnyLogs, listWraps, periodLabel, periodRange, type Period } from "@/lib/platform/wraps";
import { PageLoading } from "@/components/platform/PageLoading";

export const metadata: Metadata = { title: "Wraps" };

const SLOTS: { period: Period; offset: number; name: string }[] = [
  { period: "week", offset: 0, name: "This week" },
  { period: "week", offset: -1, name: "Last week" },
  { period: "month", offset: 0, name: "This month" },
  { period: "month", offset: -1, name: "Last month" },
  { period: "year", offset: 0, name: "This year" },
];

async function Wraps() {
  const { user, profile, persona } = await requireMember();
  const today = localDate(profile.timezone);
  const all = await listWraps(user.id);
  const cards: PeriodCard[] = await Promise.all(
    SLOTS.map(async (s) => {
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
  return <WrapsClient cards={cards} firstName={persona.firstName} aiOff={aiMode() === "off"} />;
}

export default function WrapsPage() {
  return (
    <Suspense fallback={<PageLoading title="Wraps" />}>
      <Wraps />
    </Suspense>
  );
}
