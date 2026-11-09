import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bib, type Tone } from "@/components/platform/Bib";
import { Contour, type ContourMarker } from "@/components/platform/Contour";
import { EventPicker } from "@/components/platform/EventPicker";
import { MarkerTile, rangeText } from "@/components/platform/Markers";
import { Verdict } from "@/components/platform/Verdict";
import { markerDef, PANELS, type Panel } from "@/lib/domain/markers";
import { dashboard } from "@/lib/platform/dashboard";
import { requireMember } from "@/lib/platform/member";

export const metadata: Metadata = { title: "Home" };

const dateText = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function greeting(tz: string | null) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz || "Asia/Kolkata" }).format(new Date()));
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

async function Dashboard() {
  const { user, profile, persona } = await requireMember();
  const data = await dashboard(user.id, profile, persona);
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
  const next = t ? `${t.name}` : read ? `Retest in ${read.retest.weeks} weeks` : "Next: your first blood report";
  const nextDetail = t
    ? [t.startsOn ? dateText(t.startsOn) : "Dates to be announced", data.daysToTarget != null ? `${data.daysToTarget} days out` : null, t.city].filter(Boolean).join(", ")
    : read
      ? read.retest.why
      : "Upload a report and your bib gets its verdict.";
  const tone: Tone = read?.verdict.level ?? null;
  const fuel = data.today;
  const isMock = data.view?.model === "mock";

  return (
    <div className="mx-auto grid max-w-6xl gap-x-12 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-12 lg:pt-10">
      <div className="lg:col-span-5">
        <div className="lg:sticky lg:top-20">
          <p className="mb-4 text-graphite">
            {greeting(profile.timezone)}, {persona.firstName}.
          </p>
          <Bib number={persona.bib} name={persona.firstName} label={persona.label} archetype={persona.archetype} next={next} nextDetail={nextDetail} tone={tone} />
          {data.inProgress && (
            <Link href={`/upload?report=${data.inProgress.id}`} className="mt-4 flex min-h-13 items-center justify-between border border-line-strong px-4 text-sm">
              <span>Reading your report now</span>
              <span className="text-graphite">Watch</span>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-12 lg:col-span-7 lg:mt-9">
        {read ? (
          <>
            <Verdict level={read.verdict.level} line={read.verdict.line} detail={read.verdict.detail} as="h1" />
            {isMock && <p className="mt-4 text-sm text-graphite">Demo read: AI is off on this machine, so this was written from a template.</p>}

            <section className="mt-14" aria-labelledby="matter">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="matter" className="text-2xl font-bold semiwide">
                  What matters for a {persona.noun}
                </h2>
                <Link href={`/reports/${data.view!.id}`} className="link-quiet min-h-11 shrink-0 whitespace-nowrap py-2 text-sm">
                  Full report
                </Link>
              </div>
              <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
                {matter.slice(0, 3).map((m, i) => (
                  <div key={m.id} className={i === 0 ? "sm:col-span-2" : ""}>
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
        ) : (
          <section aria-labelledby="first">
            <h1 id="first" className="verdict-type text-[clamp(2.25rem,6.5vw,3.75rem)]">
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

        <section className="mt-14" aria-labelledby="fuel">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="fuel" className="text-2xl font-bold semiwide">
              Today&apos;s fuel
            </h2>
            <Link href="/fuel" className="link-quiet min-h-11 py-2 text-sm">
              Log a meal
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-3 border-t border-line pt-5">
            {[
              { label: "kcal", v: fuel.totals.kcal, t: fuel.targets.kcal },
              { label: "protein, g", v: fuel.totals.proteinG, t: fuel.targets.proteinG },
              { label: "fibre, g", v: fuel.totals.fibreG, t: fuel.targets.fibreG },
            ].map((x) => (
              <div key={x.label}>
                <p className="display-num text-3xl">{Math.round(x.v)}</p>
                <p className="mt-1 text-sm text-graphite">
                  of {x.t} {x.label}
                </p>
                <div className="mt-3 h-1 bg-line" aria-hidden>
                  <div className="h-1 bg-paper" style={{ width: `${Math.min(100, (x.v / x.t) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          {fuel.meals === 0 && <p className="mt-4 text-sm text-graphite">Nothing logged today. Snap a plate, say it, or type it.</p>}
        </section>

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
              ? `${(data.stack.plan as { items: unknown[] } | null)?.items.length ?? 0} supplements, each tied to a marker or a gap in what you eat. Nothing else.`
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

function Skeleton() {
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-6 sm:px-6 lg:grid-cols-12 lg:pt-10" aria-busy>
      <div className="h-[28rem] bg-lift lg:col-span-5" />
      <div className="space-y-4 lg:col-span-7">
        <div className="h-6 w-40 bg-lift" />
        <div className="h-24 bg-lift" />
        <div className="h-64 bg-lift" />
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
