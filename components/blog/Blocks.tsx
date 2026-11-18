import { Fragment, type ReactNode } from "react";
import { TRY_IT_COPY, headings, isExternalHref, isSafeHref } from "@/lib/blog/blocks";
import type { Block, LiveImage, RenderBlocks, Source, Span } from "@/lib/blog/types";
import { guide } from "@/lib/seo";
import { isWaitlist } from "@/lib/site-mode";
import { BlogImage } from "./BlogImage";
import { ContourCover } from "./ContourCover";

// A post's body, block by block, on paper. Only our own components render content: there is
// no HTML in a post and no raw-HTML prop here, so text is always text. Links are
// checked again at render (they were checked on save), and an unsafe one becomes plain text.
// Plain <a>, not next/link, for links that leave the blog or cross into the app.
// /write's preview renders drafts with the same function.

const READ = "max-w-[66ch]";
/** Out to column 12 on laptops: the reading column is 7 of 12, so two more columns and gaps. */
const BREAKOUT = "lg:mr-[calc(-2*(100%+2rem)/7)]";

function Inline({ spans }: { spans: readonly Span[] }) {
  return spans.map((span, i) => {
    let node: ReactNode = span.text;
    if (span.italic) node = <em>{node}</em>;
    if (span.bold) node = <strong className="font-semibold">{node}</strong>;
    if (span.href && isSafeHref(span.href)) {
      node = (
        <a href={span.href} rel={isExternalHref(span.href) ? "noopener noreferrer" : undefined} className="font-semibold underline underline-offset-[3px]">
          {node}
        </a>
      );
    }
    return <Fragment key={i}>{node}</Fragment>;
  });
}

/** Where a Try it button goes. App screens go through sign-in, which returns people to them. */
export function tryItTarget(block: Extract<Block, { type: "tryIt" }>): { line: string; href: string; button: string } {
  const own = block.line.trim();
  if (block.destination === "guide") {
    const g = guide(block.guidePath ?? "/calorie-tracker");
    return { line: own || g.blurb, href: g.path, button: TRY_IT_COPY.guide.button };
  }
  const copy = TRY_IT_COPY[block.destination];
  if (isWaitlist) return { line: own || copy.line, href: "/#join", button: "Join the waitlist" };
  return { line: own || copy.line, href: copy.next ? `/signin?next=${encodeURIComponent(copy.next)}` : "/signin", button: copy.button };
}

function SourceLink({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <a href={`#source-${n}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-smoke underline-offset-4 hover:underline">
      Source {n}
    </a>
  );
}

type Context = { anchors: Map<string, string>; images: Readonly<Record<string, LiveImage>>; sourceNumber: Map<string, number> };

function BlockView({ block, ctx }: { block: Block; ctx: Context }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className={`mb-[1.1em] ${READ}`}>
          <Inline spans={block.spans} />
        </p>
      );
    case "heading":
      return block.level === 2 ? (
        <h2
          id={ctx.anchors.get(block.id)}
          className={`semiwide mt-[2.2em] mb-[0.6em] scroll-mt-8 text-[clamp(1.5rem,1.25rem+0.9vw,2rem)] leading-[1.15] font-bold text-balance first:mt-0 [&:lang(hi)]:leading-[1.3] ${READ}`}
        >
          {block.text}
        </h2>
      ) : (
        <h3 className={`mt-8 mb-2 text-xl leading-snug font-bold [&:lang(hi)]:leading-[1.3] ${READ}`}>{block.text}</h3>
      );
    case "list":
      return block.ordered ? (
        <ol className={`my-5 grid list-decimal gap-2.5 pl-6 marker:font-semibold ${READ}`}>
          {block.items.map((item, i) => (
            <li key={i} className="pl-1">
              <Inline spans={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className={`my-5 grid gap-2.5 ${READ}`}>
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden="true" className="mt-[0.7em] h-1.5 w-1.5 shrink-0 bg-ink" />
              <span>
                <Inline spans={item} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "photo": {
      const image = ctx.images[block.imageId];
      if (!image) return null;
      return (
        <figure className={`my-9 ${block.wide ? BREAKOUT : ""}`}>
          <div className="relative overflow-hidden bg-[#e6e6e6]" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
            <BlogImage image={image} alt={block.alt} sizes={block.wide ? "(min-width: 1280px) 904px, (min-width: 1024px) 70vw, 100vw" : "(min-width: 1280px) 696px, (min-width: 1024px) 55vw, 100vw"} />
          </div>
          {(block.caption || block.credit) && (
            <figcaption className="mt-3 max-w-[60ch] text-sm leading-[1.45] text-smoke">
              {block.caption}
              {block.credit && <span className="mt-1 block">{block.credit}</span>}
            </figcaption>
          )}
        </figure>
      );
    }
    case "quote":
      return (
        <figure className={`my-10 border-t-2 border-b border-t-ink border-b-rule pt-5 pb-6 ${BREAKOUT}`}>
          <blockquote>
            <p className="semiwide text-[clamp(1.625rem,1.2rem+1.6vw,2.5rem)] leading-[1.15] font-bold tracking-[-0.01em] text-balance [&:lang(hi)]:leading-[1.3]">{block.text}</p>
          </blockquote>
          {block.attribution && <figcaption className="mt-3 text-sm text-smoke">{block.attribution}</figcaption>}
        </figure>
      );
    case "note":
      // The D-corner: a short bar, a gap, then the stem, as at the top left of the wordmark's D.
      return (
        <aside
          aria-label={block.title || "Note"}
          className={`relative my-9 pt-[22px] pl-[22px] before:absolute before:top-0 before:left-0 before:h-1 before:w-10 before:bg-ink after:absolute after:top-[14px] after:bottom-0 after:left-0 after:w-1 after:bg-ink ${READ}`}
        >
          <p className="mb-1.5 text-sm font-bold">
            <span className="sr-only">Note: </span>
            {block.title}
          </p>
          <p className="text-[1.1875rem] leading-[1.45] font-semibold">
            <Inline spans={block.spans} />
          </p>
        </aside>
      );
    case "doctor":
      // Fixed title; says when to see a doctor, never what the reader has. The "!" is the
      // house error glyph: ink, never colour.
      return (
        <aside role="note" aria-label="Worth showing a doctor" className={`my-9 grid grid-cols-[28px_1fr] gap-3.5 border border-ink px-5 py-[18px] ${READ}`}>
          <span aria-hidden="true" className="grid h-7 w-7 place-items-center bg-ink leading-none font-extrabold text-paper">
            !
          </span>
          <div>
            <p className="font-bold">Worth showing a doctor</p>
            <p className="mt-1 text-smoke">
              <Inline spans={block.spans} />
            </p>
          </div>
        </aside>
      );
    case "keyNumber":
      return (
        <aside aria-label="Key number" className={`my-9 border-t-2 border-ink pt-3.5 ${READ}`}>
          <p className="display-num text-[clamp(3.5rem,2.8rem+3vw,5rem)] leading-[0.95] [overflow-wrap:anywhere]">{block.value}</p>
          <p className="mt-2.5 max-w-[40ch] leading-[1.4] font-semibold">{block.label}</p>
          <SourceLink n={ctx.sourceNumber.get(block.sourceId)} />
        </aside>
      );
    case "tryIt": {
      const target = tryItTarget(block);
      return (
        <aside aria-label="Try it" className="my-10 grid gap-4 bg-ink p-6 text-paper sm:grid-cols-[1fr_auto] sm:items-center sm:px-8 sm:py-7">
          <p className="leading-[1.4] font-semibold">{target.line}</p>
          <a href={target.href} className="button-primary h-14 whitespace-nowrap">
            {target.button}
          </a>
        </aside>
      );
    }
    case "table":
      return (
        <figure className="my-9">
          {/* relative: the scroller stays inside its own box on narrow phones. */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[18rem] border-collapse text-left text-base">
              <caption className="pb-3.5 text-left font-semibold">{block.caption}</caption>
              <thead>
                <tr className="border-b-2 border-ink">
                  {block.header.map((h, i) => (
                    <th key={i} scope="col" className={`py-2.5 pr-4 align-bottom text-sm font-semibold last:pr-0 ${i > 0 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-b border-rule">
                    {row.map((cell, c) =>
                      c === 0 ? (
                        <th key={c} scope="row" className="py-2.5 pr-4 font-normal">
                          {cell}
                        </th>
                      ) : (
                        <td key={c} className="py-2.5 pr-4 text-right font-semibold last:pr-0">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.sourceId && (
            <figcaption className="mt-1">
              <SourceLink n={ctx.sourceNumber.get(block.sourceId)} />
            </figcaption>
          )}
        </figure>
      );
    default:
      // A block type this build doesn't know (a newer editor): show nothing rather than guess.
      return null;
  }
}

export function PostBody({ blocks, images, sources }: { blocks: readonly Block[]; images: Readonly<Record<string, LiveImage>>; sources: readonly Source[] }) {
  const ctx: Context = {
    anchors: new Map(headings(blocks).map((h) => [h.blockId, h.anchor])),
    images,
    sourceNumber: new Map(sources.map((s, i) => [s.id, i + 1])),
  };
  return (
    <>
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} ctx={ctx} />
      ))}
    </>
  );
}

/** The RenderBlocks contract (lib/blog/types.ts), for /write's preview. */
export const renderBlocks: RenderBlocks = (blocks, images, sources) => <PostBody blocks={blocks} images={images} sources={sources} />;

/** A post's cover, or the drawn one when it has no photo. Fills its box; the box sets the shape. */
export function CoverArt({
  slug,
  cover,
  alt = "",
  sizes,
  priority = false,
  label,
}: {
  slug: string;
  cover: LiveImage | null;
  alt?: string;
  sizes: string;
  priority?: boolean;
  label?: string;
}) {
  return cover ? <BlogImage image={cover} alt={alt} sizes={sizes} priority={priority} /> : <ContourCover slug={slug} label={label} />;
}
