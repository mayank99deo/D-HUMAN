import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/platform/PageLoading";
import { PastMeals } from "@/components/platform/PastMeals";
import { dayLabel } from "@/lib/domain/meals";
import { targetsFor } from "@/lib/domain/nutrition";
import { mealHistory } from "@/lib/platform/food";
import { requireMember } from "@/lib/platform/member";

export const metadata: Metadata = { title: "Past meals" };

async function Past() {
  const { user, profile, persona } = await requireMember();
  const { today, days } = await mealHistory(user.id, profile.timezone);
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  return (
    <PastMeals
      days={days.map((d) => ({ ...d, label: dayLabel(d.date, today) }))}
      target={{ kcal: targets.kcal, proteinG: targets.proteinG }}
    />
  );
}

export default function PastMealsPage() {
  return (
    <Suspense fallback={<PageLoading title="Past meals" />}>
      <Past />
    </Suspense>
  );
}
