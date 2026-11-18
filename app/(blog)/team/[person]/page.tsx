import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/blog/Byline";
import { Crumbs } from "@/components/blog/Crumbs";
import { BlogCta, PostRows } from "@/components/blog/Lists";
import { JsonLd } from "@/components/site/Guide";
import { authors, livePosts } from "@/lib/blog/registry";
import { BLOG_PATH, blogPageMetadata, profileLd, teamPath } from "@/lib/seo";

// An author's page (SEO plan §4.4): photo, name, role, their own short bio, the profiles they
// control, and their posts. Only real roles and qualifications: the bio is theirs, unedited.
// Someone who hasn't published yet has a page but stays out of search (noindex, follow).

export const ensureStatic = "navigation";

/** Not a valid address, so it reads as missing. */
const NO_AUTHORS_YET = "__none__";

const find = async (slug: string) => (await authors()).find((a) => a.slug === slug) ?? null;

export async function generateStaticParams() {
  const team = await authors();
  return team.length ? team.map((a) => ({ person: a.slug })) : [{ person: NO_AUTHORS_YET }];
}

export async function generateMetadata({ params }: PageProps<"/team/[person]">): Promise<Metadata> {
  const author = await find((await params).person);
  if (!author) return {};
  const posts = await livePosts({ authorId: author.id });
  const description = author.bio || `${author.name}${author.role ? `, ${author.role}` : ""}. Posts on the D-Human blog.`;
  return blogPageMetadata({ path: teamPath(author.slug), title: `${author.name} | D-Human`, description, index: posts.length > 0 });
}

export default async function TeamPage({ params }: PageProps<"/team/[person]">) {
  const author = await find((await params).person);
  if (!author) notFound();
  const posts = await livePosts({ authorId: author.id });
  return (
    <>
      <JsonLd data={profileLd(author)} />
      <section className="pt-28 pb-12 sm:pt-36 sm:pb-16">
        <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
          <Crumbs
            items={[
              { label: "D-Human", href: "/" },
              { label: "Blog", href: BLOG_PATH },
              { label: author.name },
            ]}
          />
          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end">
            <Avatar author={author} size={96} />
            <div className="min-w-0">
              <h1 className="semiwide text-title font-bold break-words text-balance">{author.name}</h1>
              {author.role && <p className="mt-3 text-lg text-graphite">{author.role}</p>}
            </div>
          </div>
          {author.bio && <p className="mt-8 max-w-[52ch] sm:text-xl sm:leading-normal">{author.bio}</p>}
          {author.links.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-x-6">
              {author.links.map((l) => (
                <li key={l.url}>
                  <a href={l.url} rel="me noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section aria-labelledby="posts-title" className="paper py-16 sm:py-24">
        <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
          <h2 id="posts-title" className="semiwide text-[clamp(1.875rem,1.45rem+1.7vw,3rem)] leading-[1.05] font-bold">
            {posts.length ? `Posts by ${author.name.split(/\s+/)[0]}` : "No posts yet"}
          </h2>
          {posts.length > 0 && <PostRows posts={posts} />}
        </div>
      </section>
      <BlogCta />
    </>
  );
}
