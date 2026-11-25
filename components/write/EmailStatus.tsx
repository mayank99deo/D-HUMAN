import type { ReactNode } from "react";
import type { EmailStatus, SwitchLine } from "@/lib/email/status";
import type { Cell, Tone } from "@/lib/email/status-view";
import { SIGNUP_DAYS } from "@/lib/email/status";

// /write/status: the founders' one-look answer to "did the new people get their emails?",
// then the switches, today's budget and the daily job. Server-rendered, no script.
// Monochrome on purpose: the blood colours are for markers only, so the shape of each
// mark carries the meaning (filled: it went; ring: on its way; dashed: held by a switch;
// "!": a problem; dash: not due), always beside its word.

function Mark({ tone }: { tone: Tone }) {
  const base = "mt-1.5 inline-block size-2.5 flex-none";
  if (tone === "done") return <span aria-hidden className={`${base} rounded-full bg-paper`} />;
  if (tone === "wait") return <span aria-hidden className={`${base} rounded-full border-[1.5px] border-paper`} />;
  if (tone === "dry") return <span aria-hidden className={`${base} rounded-full border-[1.5px] border-dashed border-graphite`} />;
  if (tone === "problem")
    return (
      <span aria-hidden className="mt-0.5 inline-flex size-4 flex-none items-center justify-center bg-paper text-[0.6875rem] leading-none font-black text-ink">
        !
      </span>
    );
  return (
    <span aria-hidden className="mt-0.5 inline-block w-2.5 flex-none text-center leading-none text-graphite">
      –
    </span>
  );
}

/** `quiet`: the email that doesn't matter for this person yet; its word only, so a row stays short on a phone. */
function CellView({ cell, quiet = false }: { cell: Cell; quiet?: boolean }) {
  return (
    <div className={`flex gap-2.5 ${quiet ? "text-graphite" : ""}`}>
      <Mark tone={cell.tone} />
      <div className="min-w-0">
        <p className={quiet ? "" : "font-semibold"}>{cell.label}</p>
        {cell.detail && !quiet && <p className="mt-0.5 text-sm break-words text-graphite">{cell.detail}</p>}
      </div>
    </div>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12 first-of-type:mt-8">
      <h2 id={id} className="text-xl font-bold semiwide">
        {title}
      </h2>
      {intro && <p className="mt-2 max-w-3xl text-sm text-graphite">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Small capitals over each column on wide screens; on phones each value carries its own label. */
const colHead = "hidden text-xs font-semibold tracking-[0.08em] text-graphite uppercase lg:block";
const inlineLabel = "mb-1 text-xs font-semibold tracking-[0.08em] text-graphite uppercase lg:hidden";

function Signups({ status }: { status: EmailStatus }) {
  const t = status.totals;
  if (!status.signups.length) return <p className="text-graphite">Nobody signed up in the last {SIGNUP_DAYS} days.</p>;
  const line = [
    `${t.signups} signed up`,
    `${t.onboarded} finished setting up`,
    `${t.sent} emails went (${t.delivered} delivered)`,
    `${t.waiting} on the way`,
    t.dry ? `${t.dry} held by a switch` : null,
    `${t.problems} ${t.problems === 1 ? "problem" : "problems"}`,
  ].filter(Boolean);
  return (
    <>
      <p className="text-lg">{line.join(" · ")}</p>
      <div className="mt-6 border-t border-line">
        <div className="hidden gap-6 border-b border-line py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]">
          <p className={colHead}>Who</p>
          <p className={colHead}>Signed up</p>
          <p className={colHead}>Welcome</p>
          <p className={colHead}>Finish setting up</p>
        </div>
        <ul>
          {status.signups.map((s, i) => (
            <li key={i} className="grid gap-x-6 gap-y-3 border-b border-line py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]">
              <p className="font-semibold [overflow-wrap:anywhere]">{s.email}</p>
              <div className="text-sm">
                <p className="lg:hidden text-graphite">
                  Signed up {s.signedUp} · {s.onboarded ? `finished ${s.onboarded}` : "not finished setting up"}
                </p>
                <p className="hidden lg:block">{s.signedUp}</p>
                <p className="hidden text-graphite lg:block">{s.onboarded ? `Finished ${s.onboarded}` : "Not finished setting up"}</p>
              </div>
              <div>
                <p className={inlineLabel}>Welcome</p>
                <CellView cell={s.welcome} quiet={s.main !== "welcome"} />
              </div>
              <div>
                <p className={inlineLabel}>Finish setting up</p>
                <CellView cell={s.unfinished} quiet={s.main !== "welcome_unfinished"} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

const STATE_WORDS: Record<SwitchLine["state"], string> = { on: "On", off: "Off", unrecognised: "Not read as on", set: "Set", missing: "Missing" };

function Switches({ lines }: { lines: SwitchLine[] }) {
  return (
    <ul className="grid gap-x-8 border-t border-line md:grid-cols-2">
      {lines.map((l) => (
        <li key={l.name} className="flex gap-2.5 border-b border-line py-3">
          <Mark tone={l.on ? "done" : l.state === "unrecognised" ? "problem" : "dry"} />
          <div className="min-w-0 flex-1">
            <p className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
              <span className="font-semibold">{l.label}</span>
              <span className={`text-right ${l.on ? "" : "font-semibold"}`}>{STATE_WORDS[l.state]}</span>
            </p>
            <p className="mt-0.5 font-mono text-xs break-all text-graphite">{l.name}</p>
            {l.note && <p className="mt-1 text-sm text-graphite">{l.note}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="border-l border-line pl-4">
      <p className="display-num text-[clamp(2rem,6vw,2.75rem)]">{value}</p>
      <p className="mt-2 text-sm text-graphite">{label}</p>
    </div>
  );
}

function Budget({ budget }: { budget: EmailStatus["budget"] }) {
  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
      <Figure value={budget.left} label={`Lifecycle emails left today (cap ${budget.cap})`} />
      <Figure value={budget.codesToday} label="Sign-in codes sent" />
      <Figure value={budget.lifecycleToday} label="Lifecycle emails sent" />
      <Figure value={budget.otherToday} label="Alerts, review requests, waitlist" />
    </div>
  );
}

function Daily({ daily }: { daily: EmailStatus["daily"] }) {
  if (!daily) return <p className="text-graphite">The daily job hasn&apos;t run on this database yet.</p>;
  const run = daily.run;
  return (
    <>
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-graphite">Last started</dt>
          <dd className="font-semibold">{daily.startedAt}{daily.running ? " · running now" : ""}</dd>
        </div>
        <div>
          <dt className="text-graphite">Last ok</dt>
          <dd className="font-semibold">{daily.okAt}</dd>
        </div>
        <div>
          <dt className="text-graphite">Last result</dt>
          <dd className="font-semibold">
            {run ? `${run.status === "ok" ? "Ok" : run.status === "error" ? `Failed${run.failedAt ? ` at ${run.failedAt}` : ""}` : run.status}${run.dry ? " (dry, read-only)" : ""}` : "None recorded"}
          </dd>
        </div>
      </dl>
      {run && (
        <>
          {run.error && (
            <p className="mt-4 flex gap-2.5 text-sm">
              <Mark tone="problem" />
              <span className="break-words">{run.error}</span>
            </p>
          )}
          <div className="mt-6 border-t border-line">
            <div className="hidden grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))] gap-4 border-b border-line py-2 sm:grid">
              {["Kind", "Due", "Went", "Capped", "Over budget", "Failed"].map((h) => (
                <p key={h} className="text-xs font-semibold tracking-[0.08em] text-graphite uppercase">
                  {h}
                </p>
              ))}
            </div>
            <ul>
              {run.kinds.map((k) => (
                <li key={k.kind} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line py-2.5 text-sm sm:grid sm:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))] sm:gap-4">
                  <p className="w-full font-semibold sm:w-auto">
                    {k.kind} <span className="font-normal text-graphite">{k.live ? "live" : "dry"}</span>
                  </p>
                  <Num label="Due" n={k.due} />
                  <Num label={k.live ? "Went" : "Would go"} n={k.went} />
                  <Num label="Capped" n={k.capped} />
                  <Num label="Over budget" n={k.overBudget} />
                  <Num label="Failed" n={k.failed} />
                </li>
              ))}
            </ul>
          </div>
          <dl className="mt-4 grid gap-2 text-sm">
            <Fact label="Run at">{`${run.at} IST, ${(run.ms / 1000).toFixed(1)} s`}</Fact>
            <Fact label="Budget left then">{run.budgetLeft ?? "unknown"}</Fact>
            <Fact label="Retries">{run.retries}</Fact>
            {run.housekeeping && <Fact label="Housekeeping">{run.housekeeping}</Fact>}
            {run.sheet && <Fact label="Feedback Sheet">{run.sheet}</Fact>}
            {run.stoppedEarly && <Fact label="Stopped early">{run.stoppedEarly}</Fact>}
            {run.failureAlert && <Fact label="Founders told">{run.failureAlert}</Fact>}
          </dl>
        </>
      )}
    </>
  );
}

function Num({ label, n }: { label: string; n: number }) {
  return (
    <p className={n ? "" : "text-graphite"}>
      <span className="text-graphite sm:hidden">{label} </span>
      {n}
    </p>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-graphite">{label}:</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Sends({ sends }: { sends: EmailStatus["sends"] }) {
  if (!sends.length) return <p className="text-graphite">No lifecycle emails yet.</p>;
  return (
    <ul className="border-t border-line">
      {sends.map((s, i) => (
        <li key={i} className="grid gap-x-6 gap-y-2 border-b border-line py-3 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="font-semibold">
              {s.kind}
              {s.kind === "Weekly" || s.kind === "Feedback" ? <span className="font-normal text-graphite"> {s.key}</span> : null}
            </p>
            <p className="text-graphite [overflow-wrap:anywhere]">{s.email}</p>
          </div>
          <CellView cell={s.cell} />
          <p className="text-graphite">
            {s.at} · Resend id {s.resendId ? "yes" : "no"}
            {s.attempts > 0 ? ` · ${s.attempts} ${s.attempts === 1 ? "refusal" : "refusals"}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function SheetJobs({ status }: { status: EmailStatus }) {
  return (
    <>
      {status.sheetJobs.length ? (
        <ul className="border-t border-line">
          {status.sheetJobs.map((j) => (
            <li key={j.job} className="border-b border-line py-3 text-sm">
              <p className="font-mono font-semibold break-all">{j.job}</p>
              <p className="mt-1 text-graphite">
                Last started {j.startedAt}
                {j.running ? " · running now" : ""} · last ok {j.okAt}
              </p>
              <p className="mt-1 break-words">{j.result}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-graphite">No Users tab sync has run yet. Its runs show here once it records them.</p>
      )}
      <p className="mt-3 text-sm text-graphite">
        Feedback answers the Sheet still has to forget, for deleted accounts: <span className="text-paper">{status.forgetsWaiting}</span>
      </p>
    </>
  );
}

export function EmailStatusView({ status }: { status: EmailStatus }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-6 lg:pt-12">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Email status</h1>
      <p className="mt-3 max-w-3xl text-graphite">
        As of {status.asOf} IST. For the founders only: masked addresses, dates and counts, nothing about anyone&apos;s health. Reload for the latest.
      </p>

      <Section
        id="signups"
        title={`New people, last ${SIGNUP_DAYS} days`}
        intro={`The welcome goes the moment someone finishes setting up. "Finish setting up" goes 24 hours after sign-up if they haven't, at the next daily run (about 10:30 or 19:30 IST). "Sent" means Resend took it; "Delivered" means their mail server did. Delivered doesn't mean the inbox: Gmail may still file it under Promotions or Spam.`}
      >
        <Signups status={status} />
      </Section>

      <Section id="switches" title="Switches" intro="On or off only; values are never shown. Changes in Vercel apply after a redeploy.">
        <Switches lines={status.switches} />
      </Section>

      <Section
        id="budget"
        title="Today's budget"
        intro={`Resend's free plan sends 100 a day, counted from 05:30 IST (midnight UTC), and 30 stay free for sign-in codes. Emails sent by hand, outside the app, use the same 100 but aren't counted here.`}
      >
        <Budget budget={status.budget} />
      </Section>

      <Section id="daily" title="The daily job" intro="Runs about 10:30 and 19:30 IST. A manual Run in Vercel → Cron Jobs shows here too.">
        <Daily daily={status.daily} />
      </Section>

      <Section id="sends" title="Last 50 emails" intro="Welcome, finish setting up, weekly and feedback emails, newest first. Sign-in codes aren't recorded here.">
        <Sends sends={status.sends} />
      </Section>

      <Section id="alerts" title="Notes to the founders">
        {status.alerts.length ? (
          <ul className="border-t border-line text-sm">
            {status.alerts.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-4 border-b border-line py-2.5">
                <span>{a.what}</span>
                <span className="text-graphite">{a.at}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-graphite">None sent.</p>
        )}
      </Section>

      <Section id="sheet" title="Google Sheet sync">
        <SheetJobs status={status} />
      </Section>
    </main>
  );
}
