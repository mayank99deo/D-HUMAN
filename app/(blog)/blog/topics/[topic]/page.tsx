import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListHero } from "@/components/blog/BlogIndex";
import { BlogCta, GuidesStrip, PostRows, TopicChips, topicsWithPosts } from "@/components/blog/Lists";
import { JsonLd } from "@/components/site/Guide";
import { livePosts } from "@/lib/blog/registry";
import { BLOG_TOPICS, type BlogTopic } from "@/lib/blog/types";
import { BLOG_PATH, BLOG_TOPIC_INFO, HUB_MIN_POSTS, blogPageMetadata, guide, topicLd, topicPath } from "@/lib/seo";

// A topic hub: its intro, the guide it links up to, then its posts. Under HUB_MIN_POSTS posts
// it's thin, so noindex, follow, and out of the sitemap; with none it says so.

export const ensureStatic = "navigation";

const asTopic = (value: string): BlogTopic | null => ((BLOG_TOPICS as readonly string[]).includes(value) ? (value as BlogTopic) : null);

export function generateStaticParams() {
  return BLOG_TOPICS.map((topic) => ({ topic }));
}

export async function generateMetadata({ params }: PageProps<"/blog/topics/[topic]">): Promise<Metadata> {
  const topic = asTopic((await params).topic);
  if (!topic) return {};
  const { label, intro } = BLOG_TOPIC_INFO[topic];
  const count = (await livePosts({ topic })).length;
  return blogPageMetadata({ path: topicPath(topic), title: `${label}: blog posts | D-Human`, description: intro, index: count >= HUB_MIN_POSTS });
}

export default async function TopicPage({ params }: PageProps<"/blog/topics/[topic]">) {
  const topic = asTopic((await params).topic);
  if (!topic) notFound();
  const [all, posts] = await Promise.all([livePosts(), livePosts({ topic })]);
  const { label, intro, guides } = BLOG_TOPIC_INFO[topic];
  return (
    <>
      {posts.length > 0 && <JsonLd data={topicLd(topic, posts)} />}
      <ListHero
        crumbs={[
          { label: "D-Human", href: "/" },
          { label: "Blog", href: BLOG_PATH },
          { label },
        ]}
        title={label}
        lead={intro}
      >
        <p className="mt-4 text-graphite">
          {guides.length > 1 ? "The guides" : "The guide"}:{" "}
          {guides.map((path, i) => (
            <span key={path}>
              {i > 0 && ", "}
              <Link href={path} className="font-semibold text-paper underline underline-offset-4">
                {guide(path).crumb}
              </Link>
            </span>
          ))}
        </p>
        {all.length > 0 && <TopicChips topics={topicsWithPosts(all)} current={topic} />}
      </ListHero>
      <section aria-labelledby="posts-title" className="paper py-16 sm:py-24">
        <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
          {posts.length ? (
            <>
              <h2 id="posts-title" className="semiwide text-[clamp(1.875rem,1.45rem+1.7vw,3rem)] leading-[1.05] font-bold">
                Posts
              </h2>
              <PostRows posts={posts} />
            </>
          ) : (
            <>
              <h2 id="posts-title" className="semiwide text-2xl font-bold">
                Nothing in {label} yet.
              </h2>
              <Link href={BLOG_PATH} className="button-ghost mt-6">
                See all posts
              </Link>
            </>
          )}
        </div>
      </section>
      <GuidesStrip />
      <BlogCta />
    </>
  );
}
