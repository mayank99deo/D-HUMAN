import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { FuelLogger } from "@/components/platform/FuelLogger";
import { aiMode } from "@/lib/ai/client";
import type { Day } from "@/lib/ai/schemas";
import { db, schema } from "@/lib/db";
import { MICROS, targetsFor } from "@/lib/domain/nutrition";
import { dietPicture, logsBetween, totalsOf } from "@/lib/platform/food";
import { requireMember } from "@/lib/platform/member";
import { localDate } from "@/lib/platform/profile";

export const metadata: Metadata = { title: "Fuel" };

async function Fuel() {
  const { user, profile, persona } = await requireMember();
  const today = localDate(profile.timezone);
  const logs = await logsBetween(user.id, today, today);
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  const totals = totalsOf(logs);
  const picture = await dietPicture(user.id, profile);
  const d = await db();
  const [base] = await d.select().from(schema.dietBaselines).where(eq(schema.dietBaselines.userId, user.id)).limit(1);

  return (
    <FuelLogger
      aiOff={aiMode() === "off"}
      targets={{ kcal: targets.kcal, proteinG: targets.proteinG, carbsG: targets.carbsG, fatG: targets.fatG, fibreG: targets.fibreG, basis: targets.basis, estimated: targets.estimated }}
      totals={{ kcal: totals.kcal, proteinG: totals.proteinG, carbsG: totals.carbsG, fatG: totals.fatG, fibreG: totals.fibreG }}
      micros={MICROS.map((m) => ({ label: m.label, pct: Math.round((totals.micros[m.key] / targets.micros[m.key]) * 100) }))}
      logs={logs.map((l) => ({
        id: l.id,
        meal: l.meal,
        title: l.title,
        source: l.source,
        kcal: l.kcal,
        proteinG: l.proteinG,
        confidence: l.confidence,
        tip: (l.micros as { tip?: string | null }).tip ?? null,
        items: (l.items as { name: string; portion: string }[]).map((i) => `${i.name}, ${i.portion}`),
        demo: l.model === "mock",
      }))}
      typical={base ? { description: base.description, patterns: (base.estimate as Day).patterns } : null}
      gaps={picture.source === "none" ? [] : picture.gaps.slice(0, 4).map((g) => ({ label: g.label, pct: g.pct }))}
      gapSource={picture.source}
      language={profile.language}
    />
  );
}

export default function FuelPage() {
  return (
    <Suspense fallback={<main className="min-h-[60dvh]" />}>
      <Fuel />
    </Suspense>
  );
}
