import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StackClient } from "@/components/platform/Stack";
import { aiMode } from "@/lib/ai/client";
import { askGate } from "@/lib/ask/types";
import type { StackPlan } from "@/lib/ai/schemas";
import { db, schema } from "@/lib/db";
import type { Profile } from "@/lib/db/schema";
import { markerDef } from "@/lib/domain/markers";
import type { Persona } from "@/lib/domain/persona";
import { asFlag } from "@/lib/domain/safety";
import { dietPicture } from "@/lib/platform/food";
import { requireMember } from "@/lib/platform/member";
import { inputsChanged, latestReadyReport, latestStack } from "@/lib/platform/stack";
import { PageLoading } from "@/components/platform/PageLoading";

export const metadata: Metadata = { title: "Stack" };

// "24, 175 cm, 70 kg, regular lifter": what a meals-only stack's targets were set from.
function bodyLine(profile: Profile, persona: Persona) {
  return [
    persona.age != null ? String(persona.age) : null,
    // Non-breaking spaces, so "71 kg" never splits across lines.
    profile.heightCm ? `${Math.round(profile.heightCm)}\u00a0cm` : null,
    profile.weightKg ? `${Math.round(profile.weightKg)}\u00a0kg` : null,
    persona.label.toLowerCase(),
  ]
    .filter(Boolean)
    .join(", ");
}

// No report and nothing to go on in their food yet: the two ways to start. A usual day too
// light to count says so, and asks for the rest of the day.
function StartWithFood({ fullDays, usualDayShort }: { fullDays: number; usualDayShort: boolean }) {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Your stack starts with your food.</h1>
      <p className="mt-4 max-w-prose text-lg text-graphite">
        {usualDayShort ? "We build it from three logged days, or from a usual day that covers everything you eat." : "Log what you eat on three days, or describe a normal day once."}{" "}
        We&apos;ll suggest only what your food runs short of, measured against your body and training. A blood report adds what food can&apos;t show.
      </p>
      {usualDayShort && (
        <p className="mt-4 font-semibold">
          Your usual day looks lighter than a full day&apos;s food. Add everything you eat and drink across the day, snacks and chai included, or log meals on three days.
        </p>
      )}
      {fullDays > 0 && (
        <p className="mt-4 font-semibold">
          {fullDays} of 3 days logged. A day counts once most of what you ate is in.
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/fuel" className="button-primary h-13">
          Log a meal
        </Link>
        <Link href="/upload" className="button-ghost h-13">
          Upload a blood report
        </Link>
      </div>
      <Link href="/fuel?usual=1" className="link-quiet mt-6 inline-flex min-h-11 items-center">
        {usualDayShort ? "Add to my usual day" : "Short on time? Describe a normal day instead"}
      </Link>
    </main>
  );
}

async function Stack() {
  const { user, profile, persona } = await requireMember();
  const [report, stack] = await Promise.all([latestReadyReport(user.id), latestStack(user.id)]);
  // Before any report, the stack comes from meals alone (lib/platform/stack.ts).
  if (!report) {
    const picture = await dietPicture(user.id, profile);
    if (!stack && picture.source === "none") return <StartWithFood fullDays={picture.fullDays} usualDayShort={picture.usualDayShort} />;
  }
  // A stack built from meals has no report; once a report is read, it's out of date.
  const basis = stack ? (stack.reportId ? "report" : "meals") : report ? "report" : "meals";
  // Out of date: a newer report than the one it was built from (or the first, for a stack
  // from meals), or changed health answers (diet, medicines, conditions) since it was built.
  const staleReason =
    report && stack && stack.reportId !== report.id ? "report" : stack?.status === "ready" && inputsChanged(stack.plan, profile) ? "profile" : null;
  const names = Object.fromEntries(
    ((stack?.plan as StackPlan | null)?.items ?? []).flatMap((i) => i.markers).map((k) => [k, markerDef(k)?.name ?? k]),
  );
  // Results the safety floor keeps out of a stack, from the newest report (not the one the
  // stack was built on, which may be older or none at all, for a stack from meals): named
  // in a small card at the end, or, when urgent, in one line at the top with the stack held.
  const fromReport = report?.id ?? stack?.reportId ?? null;
  const d = await db();
  const markers = fromReport
    ? await d.select({ key: schema.markers.key, name: schema.markers.name, flag: schema.markers.flag }).from(schema.markers).where(eq(schema.markers.reportId, fromReport))
    : [];
  const flagged = markers.flatMap((m) => {
    const flag = asFlag(m.flag);
    return flag ? [{ name: markerDef(m.key)?.name ?? m.name, urgent: flag === "urgent" }] : [];
  });
  const hold = flagged.some((f) => f.urgent) ? "urgent" : profile.conditions.includes("pregnant") ? "pregnant" : null;
  return (
    <StackClient
      aiOff={aiMode() === "off"}
      stack={stack ? { id: stack.id, status: stack.status, error: stack.error, plan: stack.plan as StackPlan | null, demo: stack.model === "mock", made: stack.createdAt.toISOString() } : null}
      staleReason={staleReason}
      basis={basis}
      hasReport={!!report}
      body={bodyLine(profile, persona)}
      markerNames={names}
      budget={profile.supplementBudget}
      flagged={flagged}
      hold={hold}
      ask={askGate({ email: user.email, onboardedAt: profile.onboardedAt, birthYear: profile.birthYear }) === "ok"}
    />
  );
}

export default function StackPage() {
  return (
    <Suspense fallback={<PageLoading title="Your stack" />}>
      <Stack />
    </Suspense>
  );
}
