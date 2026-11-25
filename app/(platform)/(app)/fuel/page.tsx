import type { Metadata } from "next";
import { Suspense } from "react";
import { FuelLogger } from "@/components/platform/FuelLogger";
import { requireMember } from "@/lib/platform/member";
import { fuelData, fuelView } from "@/lib/platform/views/fuel";
import { PageLoading } from "@/components/platform/PageLoading";

export const metadata: Metadata = { title: "Fuel" };

async function Fuel({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, profile, persona } = await requireMember();
  // ?usual=1 (from the Stack screen): open at "How you usually eat".
  const usual = (await searchParams).usual === "1";
  // What Fuel shows is worked out by fuelView, which the apps' GET /api/fuel sends too
  // (lib/platform/views/fuel.ts), so the two can't drift.
  const v = fuelView({ profile, persona }, await fuelData({ user, profile }));

  return (
    <FuelLogger
      aiOff={v.aiOff}
      targets={v.targets}
      totals={v.totals}
      micros={v.micros}
      logs={v.logs}
      typical={v.typical}
      gaps={v.gaps}
      gapSource={v.gapSource}
      language={v.language}
      facts={v.facts}
      categories={v.categories}
      plan={v.plan}
      stackReady={v.stackReady}
      focusUsual={usual}
      ask={v.ask}
      founder={v.founder}
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
