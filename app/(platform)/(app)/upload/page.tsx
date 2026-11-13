import type { Metadata } from "next";
import { Suspense } from "react";
import { Uploader } from "@/components/platform/Uploader";
import { aiMode } from "@/lib/ai/client";
import { factsFor } from "@/lib/domain/facts";
import { targetEvent } from "@/lib/platform/events";
import { currentPlan } from "@/lib/platform/plan-state";
import { requireMember } from "@/lib/platform/member";
import { PageLoading } from "@/components/platform/PageLoading";

export const metadata: Metadata = { title: "Upload a report" };

async function Upload({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const { user, profile, persona } = await requireMember();
  const { report } = await searchParams;
  const [target, plan] = await Promise.all([targetEvent(user.id, profile, persona), currentPlan(user.id, profile.timezone)]);
  return (
    <Uploader
      facts={factsFor(persona.archetype)}
      noun={persona.noun}
      target={target?.name ?? null}
      watchId={report ?? null}
      aiOff={aiMode() === "off"}
      plan={plan}
    />
  );
}

export default function UploadPage({ searchParams }: PageProps<"/upload">) {
  return (
    <Suspense fallback={<PageLoading title="Upload a blood report." main="max-w-2xl lg:pt-14" />}>
      <Upload searchParams={searchParams as Promise<{ report?: string }>} />
    </Suspense>
  );
}
