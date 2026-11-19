import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EmailTap } from "@/components/platform/EmailTap";
import { Onboarding, type Draft } from "@/components/platform/Onboarding";
import { onboardingNext } from "@/lib/auth/next-path";
import { requireUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/platform/profile";

export const metadata: Metadata = { title: "Set up | D-Human", robots: { index: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

// ?next= is the screen sign-in was heading for (an email link, a blog's "Try it"): the
// finish screen leads there, and someone already set up goes straight to it.
async function Flow({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const [p, { next: raw }] = await Promise.all([getProfile(user.id), searchParams]);
  const next = onboardingNext(raw);
  if (p?.onboardedAt) redirect(next ?? "/home");
  const initial: Partial<Draft> = {
    name: p?.name ?? "",
    birthYear: p?.birthYear ? String(p.birthYear) : "",
    sex: p?.sex ?? null,
    heightCm: p?.heightCm ? String(p.heightCm) : "",
    weightKg: p?.weightKg ? String(p.weightKg) : "",
    city: p?.city ?? "",
    activities: p?.activities ?? [],
    primaryActivity: p?.primaryActivity ?? null,
    level: p?.level ?? null,
    sessionsPerWeek: p?.sessionsPerWeek ?? null,
    goals: p?.goals ?? [],
    eventInMind: p?.eventInMind ?? "",
    diet: p?.diet ?? null,
    conditions: p?.conditions ?? [],
    medications: p?.medications ?? "",
    currentSupplements: p?.currentSupplements ?? "",
    language: p?.language ?? "en",
    // Someone coming back finds their earlier agreement ticked; nothing else changes.
    consent: !!p?.consentAt,
  };
  return <Onboarding initial={initial} next={next} />;
}

export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <>
      <Suspense fallback={<main className="min-h-dvh" />}>
        <Flow searchParams={searchParams} />
      </Suspense>
      {/* The "didn't finish setting up" email links here with ?e=. */}
      <Suspense fallback={null}>
        <EmailTap />
      </Suspense>
    </>
  );
}
