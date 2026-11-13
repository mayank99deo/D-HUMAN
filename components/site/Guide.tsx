import Link from "next/link";
import type { ReactNode } from "react";
import { GUIDES, guide, ldJson, type Faq, type GuidePath } from "@/lib/seo";
import { isWaitlist } from "@/lib/site-mode";
import { StartForm } from "./StartForm";

// The building blocks of the guide pages (app/(guides)). Same system as the landing
// page: black and white sections, Archivo set wide for headings, the 1280 px grid,
// hairline rules. Server components only; the start form is the one island of script.

type Tone = "ink" | "paper";

/** Section headings: a step down from the landing page's titles, for pages people read. */
export const H2 = "semiwide text-[clamp(1.875rem,1.45rem+1.7vw,3rem)] font-bold leading-[1.05] text-balance";
export const H3 = "text-xl font-bold leading-snug";

const muted = (tone: Tone) => (tone === "paper" ? "text-smoke" : "text-graphite");
const rule = (tone: Tone) => (tone === "paper" ? "border-rule" : "border-paper/15");

/** Keeps "D-Human" from breaking at its hyphen, as the landing page does. */
export function keepBrand(text: string): ReactNode {
  const parts = text.split(/(D-Human(?:'s)?)/);
  return parts.map((part, i) =>
    i % 2 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(data) }} />;
}

/** Start free in open mode; a link to the waitlist form in waitlist mode. */
export function CtaForm() {
  if (!isWaitlist) return <StartForm />;
  return (
    <div>
      <Link href="/#join" className="button-primary h-14">
        Join the waitlist
      </Link>
      <p className="mt-3 max-w-[56ch] text-sm text-graphite">Join the waitlist for early access and launch pricing.</p>
    </div>
  );
}

export type Fact = { label: string; value: ReactNode };

export function GuideHero({ path, title, lead, facts }: { path: GuidePath; title: string; lead: ReactNode; facts: Fact[] }) {
  return (
    <section className="border-b border-paper/15 pt-28 pb-16 sm:pt-36 sm:pb-24">
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 lg:col-span-7">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-x-2 text-sm text-graphite">
              <li>
                <Link href="/" className="inline-flex min-h-11 items-center underline-offset-4 hover:text-paper hover:underline active:text-paper">
                  D-Human
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-paper">
                {guide(path).crumb}
              </li>
            </ol>
          </nav>
          <h1 className="semiwide mt-3 max-w-[18ch] text-title font-bold text-balance">{title}</h1>
          <p className="mt-7 max-w-[52ch] text-pretty sm:text-xl sm:leading-normal">{typeof lead === "string" ? keepBrand(lead) : lead}</p>
          <div className="mt-9 max-w-xl">
            <CtaForm />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-5 text-sm sm:gap-x-8 lg:col-span-4 lg:col-start-9 lg:grid-cols-1 lg:self-end">
          {facts.map((f) => (
            <div key={f.label} className="border-t border-paper/25 pt-3">
              <dt className="text-graphite">{f.label}</dt>
              <dd className="mt-1 text-base font-semibold leading-snug">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * A titled band. "split": heading on the left, body on the right on wide screens.
 * "stack": heading above a full-width body (steps, tables that want the room).
 */
export function Section({
  id,
  tone = "ink",
  title,
  intro,
  layout = "split",
  children,
}: {
  id: string;
  tone?: Tone;
  title: string;
  intro?: ReactNode;
  layout?: "split" | "stack";
  children: ReactNode;
}) {
  const head = (
    <>
      <h2 id={`${id}-title`} className={`${H2} max-w-[20ch]`}>
        {title}
      </h2>
      {intro && <p className={`mt-5 max-w-[46ch] ${muted(tone)}`}>{intro}</p>}
    </>
  );
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`${tone === "paper" ? "paper" : "border-t border-paper/15"} scroll-mt-6 py-20 sm:py-28`}
    >
      <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
        {layout === "stack" ? (
          <>
            {head}
            <div className="mt-12 sm:mt-14">{children}</div>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
            <div className="min-w-0 lg:col-span-4">{head}</div>
            <div className="min-w-0 lg:col-span-7 lg:col-start-6">{children}</div>
          </div>
        )}
      </div>
    </section>
  );
}

export function Steps({ steps, tone = "paper" }: { steps: { title: string; body: ReactNode }[]; tone?: Tone }) {
  return (
    <ol className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.title} className={`border-t-2 pt-5 ${tone === "paper" ? "border-ink" : "border-paper"}`}>
          <span aria-hidden="true" className="display-num block text-4xl">
            {i + 1}
          </span>
          <h3 className="mt-4 text-lg font-bold leading-snug">{s.title}</h3>
          <p className={`mt-2 ${muted(tone)}`}>{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** Short points with a square bullet, as the plans list on the landing page had. */
export function Points({ items, tone = "ink" }: { items: ReactNode[]; tone?: Tone }) {
  return (
    <ul className="grid gap-4">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 leading-snug">
          <span aria-hidden="true" className={`mt-[0.5em] h-1.5 w-1.5 shrink-0 ${tone === "paper" ? "bg-ink" : "bg-paper"}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A titled block of prose inside a section. */
export function Block({ title, tone = "ink", children }: { title: string; tone?: Tone; children: ReactNode }) {
  return (
    <div className={`mt-10 border-t pt-8 first:mt-0 first:border-t-0 first:pt-0 ${rule(tone)}`}>
      <h3 className={H3}>{title}</h3>
      <div className={`mt-3 grid max-w-[62ch] gap-3 ${tone === "paper" ? "[&_p]:text-smoke" : "[&_p]:text-graphite"}`}>{children}</div>
    </div>
  );
}

export function DataTable({
  caption,
  head,
  rows,
  note,
  tone = "paper",
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
  note?: ReactNode;
  tone?: Tone;
}) {
  return (
    <figure>
      {/* relative: the scroller stays inside its own box on narrow phones. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[18rem] border-collapse text-left">
          <caption className="pb-4 text-left font-semibold">{caption}</caption>
          <thead>
            <tr className={`border-b-2 ${tone === "paper" ? "border-ink" : "border-paper"}`}>
              {head.map((h, i) => (
                <th key={h} scope="col" className={`py-2 pr-4 align-bottom text-sm font-semibold last:pr-0 ${i > 0 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[0])} className={`border-b ${rule(tone)}`}>
                {r.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="py-2.5 pr-4 font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="py-2.5 pr-4 text-right font-semibold last:pr-0">
                      {typeof cell === "number" ? cell.toLocaleString("en-IN") : cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <figcaption className={`mt-4 max-w-[62ch] text-sm ${muted(tone)}`}>{note}</figcaption>}
    </figure>
  );
}

/** Questions answered on the page. The same array feeds the page's FAQ markup (lib/seo.ts). */
export function FaqList({ faqs, tone = "paper" }: { faqs: Faq[]; tone?: Tone }) {
  return (
    <div className={`border-t ${rule(tone)}`}>
      {faqs.map((f) => (
        <div key={f.q} className={`border-b py-6 ${rule(tone)}`}>
          <h3 className="text-lg font-bold leading-snug">{f.q}</h3>
          <p className={`mt-2 max-w-[64ch] ${muted(tone)}`}>{f.a}</p>
        </div>
      ))}
    </div>
  );
}

export type Source = { id: string; text: string; url?: string };

/** Named sources for every number on the page, then the other guides. */
export function SourcesAndMore({ path, sources }: { path: GuidePath; sources: Source[] }) {
  const updated = guide(path).updated;
  const others = GUIDES.filter((g) => g.path !== path);
  return (
    <section aria-labelledby="sources-title" className="border-t border-paper/15 py-20 sm:py-24">
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-14 px-5 sm:px-8 lg:grid-cols-12 lg:gap-8">
        <div id="sources" className="min-w-0 scroll-mt-6 lg:col-span-5">
          <h2 id="sources-title" className="semiwide text-xl font-bold">
            Sources
          </h2>
          <ol className="mt-5 grid gap-4 text-sm text-graphite">
            {sources.map((s, i) => (
              <li key={s.id} id={`source-${s.id}`} className="grid grid-cols-[1.75rem_1fr] border-t border-paper/15 pt-4">
                <span aria-hidden="true" className="font-semibold text-paper">
                  {i + 1}
                </span>
                <span>
                  {s.text}
                  {s.url && (
                    // On its own line, so the 44 px tap height doesn't open a gap inside the reference.
                    <a href={s.url} className="-mb-2 flex min-h-11 w-fit min-w-11 items-center break-all text-paper underline underline-offset-4">
                      {s.url.replace(/^https:\/\/(www\.)?/, "")}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-graphite">
            Written by the D-Human team from the sources above. Not medical advice. Updated{" "}
            <time dateTime={updated}>
              {new Date(`${updated}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
            </time>
            .
          </p>
        </div>
        <nav aria-labelledby="more-title" className="lg:col-span-6 lg:col-start-7">
          <h2 id="more-title" className="semiwide text-xl font-bold">
            More from D-Human
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {others.map((g) => (
              <li key={g.path}>
                <Link
                  href={g.path}
                  className="flex h-full flex-col border border-paper/25 p-5 transition-colors hover:border-paper active:border-paper"
                >
                  <span className="font-bold leading-snug">{g.label}</span>
                  <span className="mt-1.5 text-sm text-graphite">{g.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}

export function GuideCta({ title, body }: { title: string; body: ReactNode }) {
  return (
    <section aria-labelledby="cta-title" className="border-t border-paper/15 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
        <h2 id="cta-title" className={`${H2} max-w-[18ch]`}>
          {title}
        </h2>
        <p className="mt-5 max-w-[46ch] text-graphite">{body}</p>
        <div className="mt-9 max-w-xl">
          <CtaForm />
        </div>
      </div>
    </section>
  );
}

/** An in-text link to another guide or section. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-semibold underline underline-offset-4">
      {children}
    </Link>
  );
}
