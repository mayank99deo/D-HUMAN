import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bib, type Tone } from "@/components/platform/Bib";
import { Contour, type ContourMarker } from "@/components/platform/Contour";
import { EventPicker } from "@/components/platform/EventPicker";
import { MarkerTile, rangeText } from "@/components/platform/Markers";
import { retestFrom } from "@/components/platform/retest";
import { Stall } from "@/components/platform/Stall";
import { overBy, TargetBar } from "@/components/platform/Target";
import { Verdict } from "@/components/platform/Verdict";
import { markerDef, PANELS, type Panel } from "@/lib/domain/markers";
import { homeData } from "@/lib/platform/dashboard";
import { localDate } from "@/lib/platform/profile";

export const metadata: Metadata = { title: "Home" };

const dateText = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function greeting(tz: string | null) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz || "Asia/Kolkata" }).format(new Date()));
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// With nothing to take because a doctor comes first, home must not count "0 supplements".
function stackLine(plan: { items: unknown[]; see_doctor: unknown[] } | null) {
  const n = plan?.items.length ?? 0;
  if (!n && plan?.see_doctor.length) return "See a doctor before adding anything. Your stack lists what to ask about.";
  if (!n) return "Nothing to add. Your markers and your food don't point to any supplement.";
  return `${n} supplement${n === 1 ? "" : "s"}, each tied to a marker or a gap in what you eat. Nothing else.`;
}

async function Dashboard() {
  const { profile, persona, data } = await homeData();
  const read = data.view?.read;
  const notes = new Map(read?.markers.map((m) => [m.id, m.note]) ?? []);
  const markers = data.view?.markers ?? [];

  // Metrics that matter: this persona's priority markers, in order, that this report has.
  const byKey = new Map(markers.filter((m) => m.key).map((m) => [m.key as string, m]));
  const priority = persona.priorities.map((k) => byKey.get(k)).filter((m): m is NonNullable<typeof m> => !!m);
  // Out-of-range markers that aren't priorities still deserve a spot.
  const extra = markers.filter((m) => (m.status === "low" || m.status === "high" || m.flag) && !priority.includes(m));
  const matter = [...priority.slice(0, 3), ...extra, ...priority.slice(3)].slice(0, 6);

  const panelOrder = Object.keys(PANELS) as Panel[];
  const contour: ContourMarker[] = [...markers]
    .filter((m) => m.value != null)
    .sort((a, b) => panelOrder.indexOf(markerDef(a.key)?.panel ?? "muscle") - panelOrder.indexOf(markerDef(b.key)?.panel ?? "muscle"))
    .map((m) => ({
      id: m.id,
      short: markerDef(m.key)?.short ?? m.name,
      name: markerDef(m.key)?.name ?? m.name,
      value: m.value,
      valueText: m.valueText,
      unit: m.unit,
      low: m.refLow,
      high: m.refHigh,
      status: m.status,
      range: rangeText(m),
    }));

  const t = data.target;
  // The retest counts down from the day the blood was taken (or the upload day).
  const retest =
    read && data.view ? retestFrom(data.view.collectedOn ?? localDate(profile.timezone, data.view.createdAt), read.retest.weeks, localDate(profile.timezone)) : null;
  const next = t ? `${t.name}` : retest ? retest.label : "Next: your first blood report";
  const nextDetail = t
    ? [t.startsOn ? dateText(t.startsOn) : "Dates to be announced", data.daysToTarget != null ? `${data.daysToTarget} days out` : null, t.city].filter(Boolean).join(", ")
    : read
      ? read.retest.why
      : "Upload a report and your bib gets its verdict.";
  const tone: Tone = read?.verdict.level ?? null;
  const fuel = data.today;
  const isMock = data.view?.model === "mock";

  // Today's fuel changes every day, so it sits right under the verdict.
  const fuelSection = (
    <section className="mt-14" aria-labelledby="fuel">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="fuel" className="text-2xl font-bold semiwide">
          Today&apos;s fuel
        </h2>
        <Link href="/fuel" className="link-quiet min-h-11 py-2 text-sm">
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
            {greeting(profile.timezone)}, {persona.firstName}.
          </p>
          <Bib
            number={persona.bib}
            name={persona.firstName}
            label={persona.label}
            archetype={persona.archetype}
            next={next}
            nextDetail={nextDetail}
            retest={t && retest ? retest.label : null}
            tone={tone}
          />
          {data.inProgress && (
            <Link href={`/upload?report=${data.inProgress.id}`} className="mt-4 flex min-h-13 items-center justify-between border border-line-strong px-4 text-sm">
              <span>Reading your report now</span>
              <span className="text-graphite">Watch</span>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-12 md:mt-9 lg:col-span-7">
        {read ? (
          <>
            <Verdict level={read.verdict.level} line={read.verdict.line} detail={read.verdict.detail} as="h1" lang={profile.language === "hi" ? "hi" : undefined} />
            {isMock && <p className="mt-4 text-sm text-graphite">Demo read: AI is off on this machine, so this was written from a template.</p>}
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
            {data.lastFailed?.error && <p className="error-mark mt-4 text-sm">{data.lastFailed.error}</p>}
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
                <Link href={`/reports/${data.view!.id}`} className="link-quiet min-h-11 shrink-0 whitespace-nowrap py-2 text-sm">
                  Full report
                </Link>
              </div>
              {/* Pairs where there's room: not in the laptop's narrower right column until 1280 px. */}
              <div className="mt-4 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {matter.slice(0, 3).map((m, i) => (
                  <div key={m.id} className={i === 0 ? "sm:col-span-2 lg:col-span-1 xl:col-span-2" : ""}>
                    <MarkerTile m={m} note={notes.get(m.id)} before={m.key ? data.prev.get(m.key) : undefined} />
                  </div>
                ))}
                {matter.slice(3).map((m) => (
                  <MarkerTile key={m.id} m={m} size="sm" before={m.key ? data.prev.get(m.key) : undefined} />
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

            {contour.length >= 4 && (
              <section className="mt-14" aria-labelledby="contour">
                <h2 id="contour" className="text-2xl font-bold semiwide">
                  Your contour
                </h2>
                <p className="mt-2 max-w-prose text-graphite">
                  Every marker is a direction. Lines bulge out where a marker runs above range and pull in where it runs below.
                </p>
                <div className="mt-6">
                  <Contour markers={contour} />
                </div>
              </section>
            )}
          </>
        )}

        {data.upcoming.length > 0 && (
          <section className="mt-14" aria-labelledby="events">
            <h2 id="events" className="text-2xl font-bold semiwide">
              Coming up for {persona.noun}s
            </h2>
            <p className="mt-2 text-graphite">Pick one to aim your verdict at. Found on the web; check dates on the event page.</p>
            <div className="mt-4">
              <EventPicker
                events={data.upcoming.map((e) => ({ id: e.id, name: e.name, startsOn: e.startsOn, city: e.city, url: e.url, details: e.details }))}
                pickedId={data.pickedId}
                targetId={t?.id ?? null}
              />
            </div>
          </section>
        )}

        <section className="mt-14 border-t border-line pt-6" aria-labelledby="stack">
          <h2 id="stack" className="text-2xl font-bold semiwide">
            Your stack
          </h2>
          <p className="mt-2 max-w-prose text-graphite">
            {data.stack?.status === "ready"
              ? stackLine(data.stack.plan as { items: unknown[]; see_doctor: unknown[] } | null)
              : read
                ? "Built from this report and what you eat. Only what a marker or a real gap points to."
                : "It appears once your first report is read."}
          </p>
          {read && (
            <Link href="/stack" className="button-ghost mt-4 h-12">
              {data.stack?.status === "ready" ? "Open my stack" : "Build my stack"}
            </Link>
          )}
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

export default function HomePage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Dashboard />
    </Suspense>
  );
}
