import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Onboarding, type Draft } from "@/components/platform/Onboarding";
import { requireUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/platform/profile";

export const metadata: Metadata = { title: "Set up | D-Human", robots: { index: false } };

async function Flow() {
  const user = await requireUser();
  const p = await getProfile(user.id);
  if (p?.onboardedAt) redirect("/home");
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
  };
  return <Onboarding initial={initial} />;
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <Flow />
    </Suspense>
  );
}
