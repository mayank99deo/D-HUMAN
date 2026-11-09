import type { Metadata } from "next";
import { Suspense } from "react";
import { Settings } from "@/components/platform/Settings";
import { requireMember } from "@/lib/platform/member";

export const metadata: Metadata = { title: "Settings" };

async function Content() {
  const { user, profile } = await requireMember();
  return (
    <Settings
      email={user.email}
      profile={{
        name: profile.name ?? "",
        birthYear: profile.birthYear ? String(profile.birthYear) : "",
        sex: profile.sex,
        heightCm: profile.heightCm ? String(profile.heightCm) : "",
        weightKg: profile.weightKg ? String(profile.weightKg) : "",
        city: profile.city ?? "",
        activities: profile.activities,
        primaryActivity: profile.primaryActivity,
        level: profile.level,
        sessionsPerWeek: profile.sessionsPerWeek,
        goals: profile.goals,
        eventInMind: profile.eventInMind ?? "",
        diet: profile.diet,
        conditions: profile.conditions,
        medications: profile.medications ?? "",
        currentSupplements: profile.currentSupplements ?? "",
        language: profile.language,
      }}
    />
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<main className="min-h-[60dvh]" />}>
      <Content />
    </Suspense>
  );
}
