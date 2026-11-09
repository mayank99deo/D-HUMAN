import type { Metadata } from "next";
import { Suspense } from "react";
import { Uploader } from "@/components/platform/Uploader";
import { aiMode } from "@/lib/ai/client";
import { factsFor } from "@/lib/domain/facts";
import { dashboard } from "@/lib/platform/dashboard";
import { requireMember } from "@/lib/platform/member";

export const metadata: Metadata = { title: "Upload a report" };

async function Upload({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const { user, profile, persona } = await requireMember();
  const { report } = await searchParams;
  const data = await dashboard(user.id, profile, persona);
  return (
    <Uploader
      facts={factsFor(persona.archetype)}
      noun={persona.noun}
      target={data.target?.name ?? null}
      watchId={report ?? null}
      aiOff={aiMode() === "off"}
    />
  );
}

export default function UploadPage({ searchParams }: PageProps<"/upload">) {
  return (
    <Suspense fallback={<main className="min-h-[60dvh]" />}>
      <Upload searchParams={searchParams as Promise<{ report?: string }>} />
    </Suspense>
  );
}
