import Link from "next/link";
import { GuideCta } from "@/components/site/Guide";
import type { BlogTopic, PostSummary } from "@/lib/blog/types";
import { BLOG_PATH, BLOG_TOPIC_INFO, GUIDES, blogPagePath, postPath, topicPath } from "@/lib/seo";
import { CoverArt } from "./Blocks";
import { AuthorChip } from "./Byline";
import { dayInIndia, formatDate, readingTime, scriptOf } from "./format";

// The pieces blog lists are made of (the graphic designer's mock): topic chips, the featured
// story, list rows with thumbnails on the right (rows, not a card grid, on laptops too), the
// guides strip, older and newer pages, and the closing Start free.

const WRAP = "mx-auto w-full max-w-[1280px] px-5 sm:px-8";
const topicLabel = (topic: BlogTopic | null) => (topic ? BLOG_TOPIC_INFO[topic].label : null);
/** Long titles wrap fully and break long words; Devanagari gets room for its marks. */
const TITLE = "break-words text-balance [&:lang(hi)]:leading-[1.3] [&:lang(hi)]:tracking-normal";

/** Links, not filters, so each topic has a page crawlers can reach. Topics with no posts are hidden. */
export function TopicChips({ topics, current }: { topics: readonly BlogTopic[]; current: BlogTopic | "all" }) {
  const chip = (on: boolean) =>
    `inline-flex min-h-11 flex-none items-center border px-3.5 text-[0.9375rem] transition-colors ${
      on ? "border-paper bg-paper font-semibold text-ink" : "border-paper/35 hover:border-paper active:border-paper"
    }`;
  return (
    // relative: hidden overflow inside a sideways scroller must not widen the page.
    <nav aria-label="Topics" className="relative -mx-5 mt-8 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] sm:-mx-8 sm:px-8">
      <Link href={BLOG_PATH} aria-current={current === "all" ? "page" : undefined} className={chip(current === "all")}>
        All
      </Link>
      {topics.map((t) => (
        <Link key={t} href={topicPath(t)} aria-current={current === t ? "page" : undefined} className={chip(current === t)}>
          {BLOG_TOPIC_INFO[t].label}
        </Link>
      ))}
    </nav>
  );
}

/** Topics that have at least one live post, in the fixed order. */
export const topicsWithPosts = (posts: readonly PostSummary[]) => (Object.keys(BLOG_TOPIC_INFO) as BlogTopic[]).filter((t) => posts.some((p) => p.topic === t));

const DateLine = ({ post }: { post: PostSummary }) => (
  <>
    <time dateTime={dayInIndia(post.publishedAt)}>{formatDate(post.publishedAt)}</time>, {readingTime(post.readingMinutes)}
  </>
);

/** The lead story: a 3:2 photo, edge to edge on phones; photo left and words right on laptops. */
export function Featured({ post }: { post: PostSummary }) {
  const label = topicLabel(post.topic);
  return (
    <section aria-label="Featured post" className="pb-16 sm:pb-20">
      <div className={WRAP}>
        <Link href={postPath(post.slug)} className="group grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-x-8">
          <div className="relative -mx-5 aspect-[3/2] overflow-hidden bg-lift sm:mx-0 lg:col-span-7">
            <CoverArt slug={post.slug} cover={post.cover} sizes="(min-width: 1280px) 696px, (min-width: 1024px) 56vw, 100vw" priority label={label ?? undefined} />
          </div>
          <div className="min-w-0 lg:col-span-4 lg:col-start-9 lg:self-end">
            {label && <p className="text-sm font-semibold text-graphite">{label}</p>}
            <h2 {...scriptOf(post.title)} className={`semiwide mt-2.5 text-[clamp(1.75rem,1.3rem+1.6vw,2.75rem)] leading-[1.06] font-bold tracking-[-0.01em] group-hover:underline group-hover:decoration-2 group-hover:underline-offset-[6px] ${TITLE}`}>
              {post.title}
            </h2>
            {post.dek && (
              <p {...scriptOf(post.dek)} className="mt-4 max-w-[44ch] text-graphite">
                {post.dek}
              </p>
            )}
            <div className="mt-6">
              <AuthorChip author={post.author} line={<DateLine post={post} />} />
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}

/**
 * Rows split by hairlines, on paper. Phones: words, then an 88 px square thumbnail on the
 * right, the date under. Laptops: date on columns 1 and 2, words on 3 to 8, a 4:3 thumbnail
 * on 10 to 12. Thumbnails are decorative (alt ""): the title beside them names the post.
 */
export function PostRows({ posts, headingLevel = 3 }: { posts: readonly PostSummary[]; headingLevel?: 2 | 3 }) {
  const Title = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="mt-8 border-t-2 border-ink">
      {posts.map((post) => {
        const label = topicLabel(post.topic);
        return (
          <li key={post.id} className="border-b border-rule">
            <Link href={postPath(post.slug)} className="group grid grid-cols-[minmax(0,1fr)_88px] gap-x-4 py-5 lg:grid-cols-12 lg:gap-x-8 lg:py-8">
              <div className="col-start-1 row-start-1 min-w-0 lg:col-span-6 lg:col-start-3">
                {label && <p className="text-sm font-semibold text-smoke">{label}</p>}
                <Title {...scriptOf(post.title)} className={`semiwide mt-1.5 text-xl leading-[1.2] font-bold group-hover:underline group-hover:decoration-2 group-hover:underline-offset-[5px] lg:text-[1.75rem] lg:leading-[1.12] ${TITLE}`}>
                  {post.title}
                </Title>
                {post.dek && (
                  <p {...scriptOf(post.dek)} className="mt-2 line-clamp-3 text-[0.9375rem] leading-normal text-smoke lg:max-w-[54ch] lg:text-[1.0625rem]">
                    {post.dek}
                  </p>
                )}
              </div>
              <div className="relative col-start-2 row-start-1 aspect-square self-start overflow-hidden bg-[#e6e6e6] lg:col-span-3 lg:col-start-10 lg:aspect-[4/3]">
                <CoverArt slug={post.slug} cover={post.cover} sizes="(min-width: 1280px) 280px, (min-width: 1024px) 22vw, 88px" />
              </div>
              <p className="col-span-2 row-start-2 mt-3 text-sm text-smoke lg:col-span-2 lg:col-start-1 lg:row-start-1 lg:mt-1">
                <time dateTime={dayInIndia(post.publishedAt)}>{formatDate(post.publishedAt)}</time>
                <br />
                {readingTime(post.readingMinutes)}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Older and newer pages, as plain links crawlers and slow phones both follow. */
export function Pager({ page, pages }: { page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="More posts" className="mt-10 flex flex-wrap gap-3">
      {page > 1 && (
        <Link href={blogPagePath(page - 1)} className="button-ghost">
          Newer posts
        </Link>
      )}
      {page < pages && (
        <Link href={blogPagePath(page + 1)} className="button-ghost">
          Older posts
        </Link>
      )}
    </nav>
  );
}

/** The five guides as text links: where readers go for the tools themselves. */
export function GuidesStrip() {
  return (
    <nav aria-labelledby="guides-title" className="border-t border-paper/15 py-10">
      <div className={WRAP}>
        <h2 id="guides-title" className="text-base font-bold">
          Guides
        </h2>
        <ul className="mt-2 flex flex-wrap gap-x-6">
          {GUIDES.map((g) => (
            <li key={g.path}>
              <Link href={g.path} className="inline-flex min-h-11 items-center text-graphite underline underline-offset-4 hover:text-paper active:text-paper">
                {g.crumb}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** Start free (open mode) or Join the waitlist, closing every blog page. */
export function BlogCta() {
  return <GuideCta title="Start with your next meal." body="D-Human counts the calories and protein in Indian meals, and reads your blood report with AI." />;
}

/** No live posts (before the first, or if every post is taken down): a short page pointing at the guides. */
export function EmptyBlog() {
  return (
    <section aria-labelledby="empty-title" className="paper py-16 sm:py-24">
      <div className={WRAP}>
        <h2 id="empty-title" className="semiwide text-2xl font-bold">
          The first posts are on their way.
        </h2>
        <p className="mt-3 max-w-[46ch] text-smoke">Meanwhile, our guides:</p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDES.map((g) => (
            <li key={g.path}>
              <Link href={g.path} className="flex h-full flex-col border border-ink/25 p-5 transition-colors hover:border-ink active:border-ink">
                <span className="leading-snug font-bold">{g.label}</span>
                <span className="mt-1.5 text-sm text-smoke">{g.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** "More from the blog" at the end of a post, on ink: small rows with square thumbnails. */
export function RelatedList({ posts }: { posts: readonly PostSummary[] }) {
  return (
    <ul className="mt-5 border-t-2 border-paper">
      {posts.map((post) => {
        const label = topicLabel(post.topic);
        return (
          <li key={post.id} className="border-b border-paper/15">
            <Link href={postPath(post.slug)} className="group grid grid-cols-[minmax(0,1fr)_88px] gap-4 py-4">
              <div className="min-w-0">
                {label && <p className="text-sm font-semibold text-graphite">{label}</p>}
                <h3 {...scriptOf(post.title)} className={`semiwide mt-1 text-[1.0625rem] leading-[1.25] font-bold group-hover:underline group-hover:underline-offset-4 ${TITLE}`}>
                  {post.title}
                </h3>
              </div>
              <div className="relative aspect-square overflow-hidden bg-lift">
                <CoverArt slug={post.slug} cover={post.cover} sizes="88px" />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
