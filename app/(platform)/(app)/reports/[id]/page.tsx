import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DeleteReport } from "@/components/platform/DeleteReport";
import { MarkerRow } from "@/components/platform/Markers";
import { Verdict } from "@/components/platform/Verdict";
import { markerDef, PANELS, type Panel } from "@/lib/domain/markers";
import { reportView } from "@/lib/platform/dashboard";
import { requireMember } from "@/lib/platform/member";

export const metadata: Metadata = { title: "Report" };

const dateText = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { user, profile } = await requireMember();
  const { id } = await params;
  const view = await reportView(user.id, id);
  if (!view) notFound();
  const { read, markers } = view;
  const notes = new Map(read.markers.map((m) => [m.id, m.note]));

  const groups = new Map<string, typeof markers>();
  for (const m of markers) {
    const panel = markerDef(m.key)?.panel;
    const label = panel ? PANELS[panel as Panel] : m.panel || "Other";
    groups.set(label, [...(groups.get(label) ?? []), m]);
  }
  const order = Object.values(PANELS);
  const sorted = [...groups.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));

  const otherName =
    view.nameOnReport && profile.name && !view.nameOnReport.toLowerCase().includes(profile.name.trim().split(/\s+/)[0].toLowerCase()) ? view.nameOnReport : null;
  const out = markers.filter((m) => m.status === "low" || m.status === "high").length;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <Link href="/home" className="link-quiet inline-flex min-h-11 items-center text-sm">
        Back to home
      </Link>
      <p className="mt-4 text-sm text-graphite">
        {[view.labName, view.collectedOn ? `Collected ${dateText(view.collectedOn)}` : null].filter(Boolean).join(", ") || "Blood report"}
      </p>
      <p className="mt-1 inline-flex items-center gap-2 text-sm text-graphite">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-graphite" />
        {view.model === "mock" ? "Demo read, written from a template" : "Read by AI. Not a diagnosis, and not yet reviewed by a doctor."}
      </p>
      {otherName && <p className="error-mark mt-4 text-sm">This report is printed for {otherName}. Your read assumes it&apos;s yours.</p>}

      <div className="mt-8">
        <Verdict level={read.verdict.level} line={read.verdict.line} detail={read.verdict.detail} as="h1" />
      </div>

      <section className="mt-12">
        <h2 className="text-3xl font-bold wide">{read.headline}</h2>
        <p className="mt-3 max-w-prose text-lg leading-relaxed">{read.summary}</p>
        <p className="mt-4 text-sm text-graphite">
          {markers.length} markers, {out} outside the lab&apos;s range.
        </p>
      </section>

      {read.wins.length > 0 && (
        <section className="mt-12" aria-labelledby="wins">
          <h2 id="wins" className="text-xl font-bold semiwide">
            Working for you
          </h2>
          <ul className="mt-3 space-y-2">
            {read.wins.map((w, i) => (
              <li key={i} className="flex gap-3">
                <span className="glyph glyph-in mt-2" aria-hidden />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {read.focus.length > 0 && (
        <section className="mt-12" aria-labelledby="focus">
          <h2 id="focus" className="text-xl font-bold semiwide">
            Your pointers, most important first
          </h2>
          <ol className="mt-3">
            {read.focus.map((f, i) => (
              <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-t border-line py-5">
                <span className="display-num text-3xl text-graphite">{i + 1}</span>
                <div>
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="mt-1 text-graphite">{f.why}</p>
                  <p className="mt-2">{f.action}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mt-12" aria-labelledby="all">
        <h2 id="all" className="text-xl font-bold semiwide">
          Every marker
        </h2>
        {sorted.map(([panel, list]) => (
          <div key={panel} className="mt-8">
            <h3 className="text-sm font-semibold text-graphite">{panel}</h3>
            <ul className="mt-1">
              {list.map((m) => (
                <MarkerRow key={m.id} m={m} note={notes.get(m.id)} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      {read.doctor_questions.length > 0 && (
        <section className="mt-12 border border-line-strong p-5" aria-labelledby="doctor">
          <h2 id="doctor" className="text-xl font-bold semiwide">
            Take these to a doctor
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            {read.doctor_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12" aria-labelledby="retest">
        <h2 id="retest" className="text-xl font-bold semiwide">
          Retest in {read.retest.weeks} weeks
        </h2>
        <p className="mt-2 text-graphite">{read.retest.why}</p>
        {read.retest.markers.length > 0 && (
          <p className="mt-2">{read.retest.markers.map((k) => markerDef(k)?.name ?? k).join(", ")}</p>
        )}
        {read.test_tips.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-graphite">
            {read.test_tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-16 flex flex-wrap gap-3 border-t border-line pt-6">
        <Link href="/stack" className="button-primary h-12">
          Build my stack from this
        </Link>
        <DeleteReport id={view.id} />
      </div>
    </main>
  );
}

export default function ReportPage({ params }: PageProps<"/reports/[id]">) {
  return (
    <Suspense fallback={<main className="min-h-[60dvh]" />}>
      <Report params={params} />
    </Suspense>
  );
}
