import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { FuelLogger } from "@/components/platform/FuelLogger";
import { aiMode } from "@/lib/ai/client";
import type { Day } from "@/lib/ai/schemas";
import { db, schema } from "@/lib/db";
import { foodFactsFor } from "@/lib/domain/food-facts";
import { MICROS, inIuOnly, targetsFor } from "@/lib/domain/nutrition";
import { dietPicture, logsBetween, mealView, totalsOf } from "@/lib/platform/food";
import { requireMember } from "@/lib/platform/member";
import { latestReadyReport, latestStack } from "@/lib/platform/stack";
import { currentPlan } from "@/lib/platform/plan-state";
import { localDate } from "@/lib/platform/profile";
import { PageLoading } from "@/components/platform/PageLoading";

export const metadata: Metadata = { title: "Fuel" };

async function Fuel({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, profile, persona } = await requireMember();
  // ?usual=1 (from the Stack screen): open at "How you usually eat".
  const usual = (await searchParams).usual === "1";
  const today = localDate(profile.timezone);
  const logs = await logsBetween(user.id, today, today);
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  const totals = totalsOf(logs);
  const [picture, plan, report, stack] = await Promise.all([
    dietPicture(user.id, profile),
    currentPlan(user.id, profile.timezone),
    latestReadyReport(user.id),
    latestStack(user.id),
  ]);
  // No report and no stack, but their food is now enough to build one from meals.
  const stackReady = !report && !stack && picture.source !== "none";
  const d = await db();
  const [base] = await d.select().from(schema.dietBaselines).where(eq(schema.dietBaselines.userId, user.id)).limit(1);
  // Facts for the waiting screen, picked by age, height and weight bands, diet and sex. No AI involved.
  const { facts, categories } = foodFactsFor({ age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg, sex: profile.sex, diet: profile.diet });

  return (
    <FuelLogger
      aiOff={aiMode() === "off"}
      targets={{ kcal: targets.kcal, proteinG: targets.proteinG, carbsG: targets.carbsG, fatG: targets.fatG, fibreG: targets.fibreG, basis: targets.basis, estimated: targets.estimated }}
      totals={{ kcal: totals.kcal, proteinG: totals.proteinG, carbsG: totals.carbsG, fatG: totals.fatG, fibreG: totals.fibreG }}
      // Vitamin D in IU, never as a share: most of it comes from sun, not food (inIuOnly).
      micros={MICROS.map((m) =>
        inIuOnly(m.key) ? { label: m.label, iu: Math.round(totals.micros[m.key]) } : { label: m.label, pct: Math.round((totals.micros[m.key] / targets.micros[m.key]) * 100) },
      )}
      logs={logs.map(mealView)}
      typical={base ? { description: base.description, patterns: (base.estimate as Day).patterns } : null}
      gaps={picture.source === "none" ? [] : picture.gaps.filter((g) => !inIuOnly(g.key)).slice(0, 4).map((g) => ({ label: g.label, pct: g.pct }))}
      gapSource={picture.source}
      language={profile.language}
      facts={facts}
      categories={categories}
      plan={plan}
      stackReady={stackReady}
      focusUsual={usual}
    />
  );
}

export default function FuelPage({ searchParams }: PageProps<"/fuel">) {
  return (
    <Suspense fallback={<PageLoading title="Fuel" main="max-w-3xl lg:max-w-6xl lg:pt-12" />}>
      <Fuel searchParams={searchParams} />
    </Suspense>
  );
}
