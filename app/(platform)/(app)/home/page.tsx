import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bib } from "@/components/platform/Bib";
import { Contour } from "@/components/platform/Contour";
import { DeleteReport } from "@/components/platform/DeleteReport";
import { EventPicker } from "@/components/platform/EventPicker";
import { MarkerTile } from "@/components/platform/Markers";
import { Stall } from "@/components/platform/Stall";
import { overBy, TargetBar } from "@/components/platform/Target";
import { Verdict } from "@/components/platform/Verdict";
import { homeData } from "@/lib/platform/dashboard";
import { homeView } from "@/lib/platform/views/home";

export const metadata: Metadata = { title: "Home" };

// After a delete: say what went, and that the rest is still there (people with no report
// of their own keep using Fuel).
const DELETED: Record<string, string> = {
  report: "Report deleted. Your meals, targets and profile are still here.",
  all: "Reports deleted. Your meals, targets and profile are still here.",
};

async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, profile, persona, data } = await homeData();
  // What Home shows is worked out by homeView, which the apps' GET /api/home sends too
  // (lib/platform/views/home.ts), so the two can't drift.
  const view = homeView({ user, profile, persona }, data);
  const deleted = DELETED[String((await searchParams).deleted ?? "")] ?? null;
  const { ask, bib, report, stack: stackCopy } = view;
  const read = report?.read;
  const t = view.target;
  const fuel = view.fuel;

  // Today's fuel changes every day, so it sits right under the verdict.
  const fuelSection = (
    <section className="mt-14" aria-labelledby="fuel">
      <div className="flex items-center justify-between gap-4">
        <h2 id="fuel" className="text-2xl font-bold semiwide">
          Today&apos;s fuel
        </h2>
        {/* The thing people come back to do every day, so a real button, not a quiet link. */}
        <Link href="/fuel" className="button-primary h-11 shrink-0 px-5 text-[0.9375rem]">
          Log a meal
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-4 border-t border-line pt-5">
        {[
          { label: "kcal", v: fuel.totals.kcal, t: fuel.targets.kcal },
          { label: "protein, g", v: fuel.totals.proteinG, t: fuel.targets.proteinG },
          { label: "fibre, g", v: fuel.totals.fibreG, t: fuel.targets.fibreG },
        ].map((x) => {
          const extra = overBy(x.v, x.t);
          return (
            <div key={x.label} className="min-w-0">
              <p className="display-num text-[clamp(1.5rem,7vw,1.875rem)]">{Math.round(x.v).toLocaleString("en-IN")}</p>
              <p className="mt-1 text-sm text-graphite">
                of {x.t.toLocaleString("en-IN")} {x.label}
              </p>
              {extra > 0 && <p className="text-sm font-semibold">{extra.toLocaleString("en-IN")} over</p>}
              <TargetBar value={x.v} target={x.t} className="mt-3" />
            </div>
          );
        })}
      </div>
      {fuel.meals === 0 && <p className="mt-4 text-sm text-graphite">Nothing logged today. Snap a plate, say it, or type it.</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 text-sm">
        {view.yesterday.meals > 0 && (
          <p className="text-graphite">
            Yesterday: {Math.round(view.yesterday.totals.kcal).toLocaleString("en-IN")} kcal and {Math.round(view.yesterday.totals.proteinG)} g protein.
          </p>
        )}
        <Link href="/fuel/past" className="link-quiet inline-flex min-h-11 items-center">
          Past meals
        </Link>
      </div>
    </section>
  );

  return (
    // Phones: one column. Tablets (and phones turned sideways): the bib and the verdict side by
    // side, everything else full width below. Laptops: the bib stays put on the left while the
    // rest scrolls on the right.
    <div className="mx-auto grid max-w-6xl px-4 pb-16 pt-6 sm:px-6 md:grid-cols-2 md:gap-x-8 lg:grid-cols-12 lg:gap-x-12 lg:pt-10">
      <div className="lg:col-span-5 lg:row-span-2">
        <div className="lg:sticky lg:top-20">
          <p className="mb-4 text-graphite">
            {view.greeting}, {persona.firstName}.
          </p>
          <Bib
            number={bib.number}
            name={bib.name}
            label={bib.label}
            archetype={bib.archetype}
            next={bib.next}
            nextDetail={bib.nextDetail}
            retest={bib.retest}
            tone={bib.tone}
          />
          {view.inProgress && (
            <Link href={`/upload?report=${view.inProgress.id}`} className="mt-4 flex min-h-13 items-center justify-between border border-line-strong px-4 text-sm">
              <span>Reading your report now</span>
              <span className="text-graphite">Watch</span>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-12 md:mt-9 lg:col-span-7">
        {deleted && (
          <p role="status" className="mb-8 border border-line-strong px-4 py-3 text-sm">
            {deleted}
          </p>
        )}
        {read ? (
          <>
            {/* Before the verdict, so a friend's results are never read as their own first. */}
            {report!.otherName && (
              <div className="mb-8 border border-line-strong p-4">
                <p className="error-mark text-sm">This report is printed for {report!.otherName}. If it isn&apos;t yours, delete it to clear Home.</p>
                <div className="mt-3">
                  <DeleteReport key={report!.id} id={report!.id} stay />
                </div>
              </div>
            )}
            <Verdict level={read.verdict.level} line={read.verdict.line} detail={read.verdict.detail} as="h1" lang={report!.verdictLang} />
            {report!.isMock && <p className="mt-4 text-sm text-graphite">Demo read: AI is off on this machine, so this was written from a template.</p>}
            <p className="mt-3 flex flex-wrap items-center gap-x-4 text-sm text-graphite">
              <span>
                From {report!.otherName ? "the" : "your"} report {report!.source}.
              </span>
              <Link href="/reports" className="link-quiet inline-flex min-h-11 items-center">
                Manage reports
              </Link>
            </p>
          </>
        ) : (
          <section aria-labelledby="first" className="@container">
            <h1 id="first" className="verdict-type text-[clamp(2.25rem,11cqi,3.75rem)]">
              Your bib needs a verdict.
            </h1>
            <p className="mt-4 max-w-prose text-lg text-graphite">
              Upload a blood report, PDF or photos. We read every marker, weigh it for how you train, and tell you where you stand
              {t ? ` for ${t.name}` : ""}.
            </p>
            {view.lastFailed?.error && <p className="error-mark mt-4 text-sm">{view.lastFailed.error}</p>}
            <Link href="/upload" className="button-primary mt-8 h-13 w-full sm:w-auto">
              Upload a blood report
            </Link>
          </section>
        )}
      </div>

      <div className="md:col-span-2 lg:col-span-7 lg:col-start-6">
        {fuelSection}
        {read && (
          <>
            <section className="mt-14" aria-labelledby="matter">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="matter" className="text-2xl font-bold semiwide">
                  What matters for a {persona.noun}
                </h2>
                <Link href={`/reports/${report!.id}`} className="link-quiet min-h-11 shrink-0 whitespace-nowrap py-2 text-sm">
                  Full report
                </Link>
              </div>
              {/* Pairs where there's room: not in the laptop's narrower right column until 1280 px. */}
              <div className="mt-4 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {report!.matter.slice(0, 3).map(({ marker: m, note, before }, i) => (
                  <div key={m.id} className={i === 0 ? "sm:col-span-2 lg:col-span-1 xl:col-span-2" : ""}>
                    <MarkerTile m={m} note={note} before={before} ask={ask} />
                  </div>
                ))}
                {report!.matter.slice(3).map(({ marker: m, before }) => (
                  <MarkerTile key={m.id} m={m} size="sm" before={before} ask={ask} />
                ))}
              </div>
            </section>

            {read.focus.length > 0 && (
              <section className="mt-14" aria-labelledby="focus">
                <h2 id="focus" className="text-2xl font-bold semiwide">
                  Your pointers
                </h2>
                <ol className="mt-4">
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

            {report!.contour.length >= 4 && (
              <section className="mt-14" aria-labelledby="contour">
                <h2 id="contour" className="text-2xl font-bold semiwide">
                  Your contour
                </h2>
                <p className="mt-2 max-w-prose text-graphite">
                  Every marker is a direction. Lines bulge out where a marker runs above range and pull in where it runs below.
                </p>
                <div className="mt-6">
                  <Contour markers={report!.contour} />
                </div>
              </section>
            )}
          </>
        )}

        {view.events.upcoming.length > 0 && (
          <section className="mt-14" aria-labelledby="events">
            <h2 id="events" className="text-2xl font-bold semiwide">
              Coming up for {persona.noun}s
            </h2>
            <p className="mt-2 text-graphite">Pick one to aim your verdict at. Found on the web; check dates on the event page.</p>
            <div className="mt-4">
              <EventPicker events={view.events.upcoming} pickedId={view.events.pickedId} targetId={view.events.targetId} />
            </div>
          </section>
        )}

        <section className="mt-14 border-t border-line pt-6" aria-labelledby="stack">
          <h2 id="stack" className="text-2xl font-bold semiwide">
            Your stack
          </h2>
          <p className="mt-2 max-w-prose text-graphite">{stackCopy.line}</p>
          <Link href="/stack" className="button-ghost mt-4 h-12">
            {stackCopy.button}
          </Link>
        </section>
      </div>
    </div>
  );
}

// What shows the moment home opens: the two things people come to do, a plain
// loading line, and a reload offer if it drags on. Never just grey boxes.
function Skeleton() {
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-6 sm:px-6 md:grid-cols-2 md:gap-8 lg:grid-cols-12 lg:gap-12 lg:pt-10">
      <div className="h-[28rem] bg-lift md:h-80 lg:col-span-5 lg:h-[28rem]" aria-hidden />
      <div className="lg:col-span-7">
        <p className="text-sm text-graphite" role="status" aria-live="polite">
          Loading your dashboard…
        </p>
        <Stall />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href="/fuel" className="flex min-h-24 flex-col justify-between border border-line-strong p-4 active:bg-lift">
            <span className="text-lg font-bold semiwide">Log a meal</span>
            <span className="text-sm text-graphite">Snap, say or type it</span>
          </Link>
          <Link href="/upload" className="flex min-h-24 flex-col justify-between border border-line-strong p-4 active:bg-lift">
            <span className="text-lg font-bold semiwide">Upload a report</span>
            <span className="text-sm text-graphite">PDF or photos from your lab</span>
          </Link>
        </div>
        <div className="mt-8 h-64 bg-lift" aria-hidden />
      </div>
    </div>
  );
}

export default function HomePage({ searchParams }: PageProps<"/home">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}
