import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StackClient } from "@/components/platform/Stack";
import { aiMode } from "@/lib/ai/client";
import type { StackPlan } from "@/lib/ai/schemas";
import { db, schema } from "@/lib/db";
import { markerDef } from "@/lib/domain/markers";
import { asFlag } from "@/lib/domain/safety";
import { requireMember } from "@/lib/platform/member";
import { latestReadyReport, latestStack } from "@/lib/platform/stack";
import { PageLoading } from "@/components/platform/PageLoading";

export const metadata: Metadata = { title: "Stack" };

async function Stack() {
  const { user, profile } = await requireMember();
  const report = await latestReadyReport(user.id);
  if (!report) {
    return (
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
        <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Your stack starts with a test.</h1>
        <p className="mt-4 max-w-prose text-lg text-graphite">
          D-Human only suggests a supplement when a marker or a real gap in your food points to it. Upload a blood report and we&apos;ll build it from there.
        </p>
        <Link href="/upload" className="button-primary mt-8 h-13">
          Upload a blood report
        </Link>
      </main>
    );
  }
  const stack = await latestStack(user.id);
  const stale = !!stack && stack.reportId !== report.id;
  const names = Object.fromEntries(
    ((stack?.plan as StackPlan | null)?.items ?? []).flatMap((i) => i.markers).map((k) => [k, markerDef(k)?.name ?? k]),
  );
  // Results the safety floor kept out of the stack, from the report the stack was built on:
  // named in a small card at the end, or, when urgent, in one line at the top.
  const d = await db();
  const markers = await d.select({ key: schema.markers.key, name: schema.markers.name, flag: schema.markers.flag }).from(schema.markers).where(eq(schema.markers.reportId, stack?.reportId ?? report.id));
  const flagged = markers.flatMap((m) => {
    const flag = asFlag(m.flag);
    return flag ? [{ name: markerDef(m.key)?.name ?? m.name, urgent: flag === "urgent" }] : [];
  });
  const hold = flagged.some((f) => f.urgent) ? "urgent" : profile.conditions.includes("pregnant") ? "pregnant" : null;
  return (
    <StackClient
      aiOff={aiMode() === "off"}
      stack={stack ? { id: stack.id, status: stack.status, error: stack.error, plan: stack.plan as StackPlan | null, demo: stack.model === "mock", made: stack.createdAt.toISOString() } : null}
      stale={stale}
      markerNames={names}
      budget={profile.supplementBudget}
      flagged={flagged}
      hold={hold}
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
