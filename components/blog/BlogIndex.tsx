import type { ReactNode } from "react";
import { JsonLd, keepBrand } from "@/components/site/Guide";
import { splitFeatured } from "@/lib/blog/registry";
import type { PostSummary } from "@/lib/blog/types";
import { BLOG_DESCRIPTION, BLOG_PER_PAGE, BLOG_TITLE, blogIndexLd } from "@/lib/seo";
import { Crumbs, type Crumb } from "./Crumbs";
import { BlogCta, EmptyBlog, Featured, GuidesStrip, Pager, PostRows, TopicChips, topicsWithPosts } from "./Lists";

// /blog and its older pages. Black hero with the topic chips, the featured post (page 1
// only), then the rest as rows on paper, 30 to a page, the guides and Start free.

const WRAP = "mx-auto w-full max-w-[1280px] px-5 sm:px-8";

/** The black title band every blog list page opens with. */
export function ListHero({ crumbs, title, lead, children }: { crumbs: Crumb[]; title: string; lead: ReactNode; children?: ReactNode }) {
  return (
    <section className="pt-28 pb-12 sm:pt-36 sm:pb-16">
      <div className={WRAP}>
        <Crumbs items={crumbs} />
        <h1 className="semiwide mt-2 max-w-[16ch] text-title font-bold tracking-[-0.01em] text-balance">{keepBrand(title)}</h1>
        <p className="mt-6 max-w-[46ch] text-graphite sm:text-xl sm:leading-normal">{typeof lead === "string" ? keepBrand(lead) : lead}</p>
        {children}
      </div>
    </section>
  );
}

export const pageCount = (posts: readonly PostSummary[]) => Math.max(1, Math.ceil(splitFeatured(posts).rest.length / BLOG_PER_PAGE));

export function BlogIndex({ posts, page }: { posts: readonly PostSummary[]; page: number }) {
  const { featured, rest } = splitFeatured(posts);
  const pages = pageCount(posts);
  const shown = rest.slice((page - 1) * BLOG_PER_PAGE, page * BLOG_PER_PAGE);
  const crumbs: Crumb[] = page > 1 ? [{ label: "D-Human", href: "/" }, { label: "Blog", href: "/blog" }, { label: `Page ${page}` }] : [{ label: "D-Human", href: "/" }, { label: "Blog" }];
  return (
    <>
      {posts.length > 0 && page === 1 && <JsonLd data={blogIndexLd(posts)} />}
      <ListHero crumbs={crumbs} title={page > 1 ? `${BLOG_TITLE}, page ${page}` : BLOG_TITLE} lead={BLOG_DESCRIPTION}>
        {posts.length > 0 && <TopicChips topics={topicsWithPosts(posts)} current="all" />}
      </ListHero>
      {!featured ? (
        <EmptyBlog />
      ) : (
        <>
          {page === 1 && <Featured post={featured} />}
          {shown.length > 0 && (
            <section aria-labelledby="latest-title" className="paper py-16 sm:py-24">
              <div className={WRAP}>
                <h2 id="latest-title" className="semiwide text-[clamp(1.875rem,1.45rem+1.7vw,3rem)] leading-[1.05] font-bold">
                  {page === 1 ? "Latest" : "Older posts"}
                </h2>
                <PostRows posts={shown} />
                <Pager page={page} pages={pages} />
              </div>
            </section>
          )}
        </>
      )}
      {featured && <GuidesStrip />}
      <BlogCta />
    </>
  );
}
