import type { Metadata } from "next";
import { Suspense } from "react";
import { Settings } from "@/components/platform/Settings";
import { getPrefs } from "@/lib/email/prefs";
import { requireMember } from "@/lib/platform/member";
import { paidPasses } from "@/lib/platform/plan";
import { currentPlan } from "@/lib/platform/plan-state";
import { PageLoading } from "@/components/platform/PageLoading";

export const metadata: Metadata = { title: "Settings" };

async function Content() {
  const { user, profile } = await requireMember();
  const [plan, passes, emails] = await Promise.all([
    currentPlan(user.id, profile.timezone, { reconcile: true }),
    paidPasses(user.id, profile.timezone),
    getPrefs(user.id),
  ]);
  return (
    <Settings
      email={user.email}
      plan={plan}
      passes={passes}
      emails={{ weekly: emails.weekly, questions: emails.questions, weeklyPaused: Boolean(emails.weeklyPausedAt) }}
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
    <Suspense fallback={<PageLoading title="You" main="max-w-2xl lg:pt-12" />}>
      <Content />
    </Suspense>
  );
}
