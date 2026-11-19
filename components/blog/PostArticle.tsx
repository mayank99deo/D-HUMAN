import Link from "next/link";
import { blockText, closingLines, headings } from "@/lib/blog/blocks";
import type { LivePost, PostSummary } from "@/lib/blog/types";
import { BLOG_PATH, BLOG_TOPIC_INFO, EDITORIAL_PATH, GUIDES, postPath, teamPath, topicPath } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site-url";
import { CoverArt, PostBody } from "./Blocks";
import { AuthorChip, Avatar } from "./Byline";
import { CopyLink } from "./CopyLink";
import { Crumbs } from "./Crumbs";
import { BlogCta, RelatedList } from "./Lists";
import { dayInIndia, formatDate, scriptOf } from "./format";

// A post, top to bottom (product designer §2.5, graphic designer's mock): the title band on
// ink with the byline as a facts list, the cover straddling ink and paper, the body on paper
// with "On this page" and Share in a rail on laptops, then sources, the fixed lines, the
// author and related posts on ink, and Start free. /write's preview renders the same thing.

const WRAP = "mx-auto w-full max-w-[1280px] px-5 sm:px-8";
const SHARE_LINK = "inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-[3px]";

function Facts({ post }: { post: LivePost }) {
  const facts = [
    { label: "Published", value: <time dateTime={dayInIndia(post.publishedAt)}>{formatDate(post.publishedAt)}</time> },
    { label: "Reading time", value: `${post.readingMinutes} ${post.readingMinutes === 1 ? "minute" : "minutes"}` },
    ...(post.updatedOn ? [{ label: "Updated", value: <time dateTime={dayInIndia(post.updatedOn)}>{formatDate(post.updatedOn)}</time> }] : []),
  ];
  return (
    <dl className="mt-9 grid max-w-[46rem] grid-cols-2 gap-5 sm:grid-cols-3 sm:gap-x-8 lg:col-span-3 lg:col-start-10 lg:mt-0 lg:grid-cols-1 lg:self-end">
      <div className="col-span-2 border-t border-paper/25 pt-3 sm:col-span-1">
        <dt className="text-sm text-graphite">Written by</dt>
        <dd className="mt-1.5">
          <Link href={teamPath(post.author.slug)} className="inline-flex min-h-11 items-center hover:underline">
            <AuthorChip author={post.author} size={32} />
          </Link>
        </dd>
      </div>
      {facts.map((f) => (
        <div key={f.label} className="border-t border-paper/25 pt-3">
          <dt className="text-sm text-graphite">{f.label}</dt>
          <dd className="mt-1.5 leading-snug font-semibold">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Contents({ items }: { items: { anchor: string; text: string }[] }) {
  const list = (
    <ol className="pb-3">
      {items.map((h) => (
        <li key={h.anchor}>
          <a href={`#${h.anchor}`} className="flex min-h-11 items-center text-[0.9375rem] leading-[1.3] text-smoke hover:text-ink active:text-ink">
            {h.text}
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <>
      {/* Phones: closed until tapped. Laptops: always open in the rail. No script either way. */}
      <details className="border-t-2 border-b border-t-ink border-b-rule lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-[0.9375rem] font-bold [&::-webkit-details-marker]:hidden">
          On this page
          <span aria-hidden="true" className="text-xl font-normal">
            +
          </span>
        </summary>
        {list}
      </details>
      <nav aria-label="On this page" className="hidden border-t-2 border-ink lg:block">
        <p className="flex min-h-12 items-center text-[0.9375rem] font-bold">On this page</p>
        {list}
      </nav>
    </>
  );
}

function Share({ post, className }: { post: LivePost; className: string }) {
  const url = absoluteUrl(postPath(post.slug));
  return (
    <div className={className}>
      <a href={`https://wa.me/?text=${encodeURIComponent(`${post.title} ${url}`)}`} rel="noopener noreferrer" className={SHARE_LINK}>
        Share on WhatsApp
      </a>
      <CopyLink url={url} className={`${SHARE_LINK} cursor-pointer`} />
    </div>
  );
}

function EndMatter({ post, related }: { post: LivePost; related: readonly PostSummary[] }) {
  const firstName = post.author.name.split(/\s+/)[0];
  return (
    <section aria-label="Sources and more" className="border-t border-paper/15 py-18 sm:py-24">
      <div className={`${WRAP} grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-8`}>
        <div className="min-w-0 lg:col-span-5">
          {post.sources.length > 0 && (
            <div id="sources" className="scroll-mt-8">
              <h2 className="semiwide text-xl font-bold">Sources</h2>
              <ol className="mt-5 grid gap-4 text-sm text-graphite">
                {post.sources.map((s, i) => (
                  <li key={s.id} id={`source-${i + 1}`} className="grid scroll-mt-8 grid-cols-[1.75rem_1fr] border-t border-paper/15 pt-4">
                    <span aria-hidden="true" className="font-semibold text-paper">
                      {i + 1}
                    </span>
                    <span>
                      {s.name}
                      {s.url && (
                        <a href={s.url} rel="noopener noreferrer" className="-mb-2 flex min-h-11 w-fit min-w-11 items-center break-all text-paper underline underline-offset-4">
                          {s.url.replace(/^https?:\/\/(www\.)?/, "")}
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="mt-6 grid gap-2 text-sm text-graphite">
            {closingLines(post).map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p>
              How we choose sources and check posts:{" "}
              <Link href={EDITORIAL_PATH} className="text-paper underline underline-offset-4">
                editorial policy
              </Link>
              ,{" "}
              <Link href="/sources-and-safety" className="text-paper underline underline-offset-4">
                sources and safety
              </Link>
              .
            </p>
          </div>
          <div className="mt-10 border-t border-paper/15 pt-6">
            <div className="flex items-start gap-4">
              <Avatar author={post.author} />
              <div className="min-w-0">
                <p className="font-semibold">{post.author.name}</p>
                {post.author.role && <p className="text-sm text-graphite">{post.author.role}</p>}
                {post.author.bio && <p className="mt-2 max-w-[52ch] text-sm text-graphite">{post.author.bio}</p>}
                <Link href={teamPath(post.author.slug)} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">
                  More from {firstName}
                </Link>
              </div>
            </div>
          </div>
        </div>
        <nav aria-labelledby="more-title" className="min-w-0 lg:col-span-6 lg:col-start-7">
          <h2 id="more-title" className="semiwide text-xl font-bold">
            {related.length ? "More from the blog" : "Our guides"}
          </h2>
          {related.length ? (
            <RelatedList posts={related} />
          ) : (
            <ul className="mt-5 border-t-2 border-paper">
              {GUIDES.map((g) => (
                <li key={g.path} className="border-b border-paper/15">
                  <Link href={g.path} className="flex min-h-14 flex-col justify-center py-3 hover:underline">
                    <span className="font-bold">{g.label}</span>
                    <span className="text-sm text-graphite">{g.blurb}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </div>
    </section>
  );
}

/** Devanagari anywhere in a post sets it in the phone's own fonts, never the 726 KB web font. */
const postScript = (post: LivePost) => scriptOf([post.title, post.dek, ...post.blocks.map(blockText)].join(" "));

export function PostArticle({ post, related }: { post: LivePost; related: readonly PostSummary[] }) {
  const topic = post.topic ? BLOG_TOPIC_INFO[post.topic] : null;
  const toc = headings(post.blocks);
  const cover = post.cover;
  const { style } = postScript(post);
  return (
    <>
      <article style={style}>
        <section className="pt-28 pb-10 sm:pt-36 sm:pb-14">
          <div className={`${WRAP} grid grid-cols-1 lg:grid-cols-12 lg:gap-x-8`}>
            <div className="min-w-0 lg:col-span-8">
              <Crumbs
                items={[
                  { label: "D-Human", href: "/" },
                  { label: "Blog", href: BLOG_PATH },
                  ...(post.topic && topic ? [{ label: topic.label, href: topicPath(post.topic) }] : []),
                ]}
              />
              <h1
                {...scriptOf(post.title)}
                className={`semiwide mt-2 max-w-[18ch] text-title font-bold tracking-[-0.01em] break-words text-balance [&:lang(hi)]:max-w-[24ch] [&:lang(hi)]:leading-[1.3] [&:lang(hi)]:tracking-normal ${
                  post.title.length > 60 ? "max-sm:text-[2rem]" : ""
                }`}
              >
                {post.title}
              </h1>
              {post.dek && (
                <p {...scriptOf(post.dek)} className="mt-6 max-w-[52ch] text-lg leading-normal text-pretty sm:text-[1.375rem] sm:leading-[1.45]">
                  {post.dek}
                </p>
              )}
            </div>
            <Facts post={post} />
          </div>
        </section>

        {/* The cover straddles the ink band and the paper body. */}
        <div className="bg-[linear-gradient(var(--color-ink)_50%,var(--color-paper)_50%)]">
          <div className={WRAP}>
            <div className="relative -mx-5 aspect-[3/2] overflow-hidden bg-lift sm:mx-0 lg:aspect-[2/1]">
              <CoverArt slug={post.slug} cover={cover} alt={cover?.alt} sizes="(min-width: 1280px) 1216px, 100vw" priority label={topic?.label} />
            </div>
          </div>
        </div>

        <div className="paper pt-4 pb-20">
          <div className={`${WRAP} grid grid-cols-1 lg:grid-cols-12 lg:gap-x-8`}>
            {cover && (cover.caption || cover.credit) ? (
              <p className="mt-3 max-w-[60ch] text-sm leading-[1.45] text-smoke lg:col-span-7 lg:col-start-4">
                {cover.caption}
                {cover.credit && <span className="mt-1 block">{cover.credit}</span>}
              </p>
            ) : null}
            <div className="mt-8 lg:col-span-3 lg:col-start-1 lg:row-start-2 lg:mt-14">
              <div className="lg:sticky lg:top-28">
                {toc.length >= 3 && <Contents items={toc} />}
                <Share post={post} className="hidden gap-5 border-t border-rule pt-2 lg:mt-4 lg:flex" />
              </div>
            </div>
            <div className="mt-10 min-w-0 text-[1.0625rem] leading-[1.65] sm:text-lg lg:col-span-7 lg:col-start-4 lg:row-start-2 lg:mt-14">
              <PostBody blocks={post.blocks} images={post.images} sources={post.sources} />
              <Share post={post} className="mt-10 flex gap-6 lg:hidden" />
            </div>
          </div>
        </div>
      </article>
      <EndMatter post={post} related={related} />
      <BlogCta />
    </>
  );
}
