import type { Metadata } from "next";
import Link from "next/link";
import { Crumbs } from "@/components/blog/Crumbs";
import { BlogCta } from "@/components/blog/Lists";
import { JsonLd, Points, keepBrand } from "@/components/site/Guide";
import { CORRECTIONS_EMAILS, EDITORIAL_PATH, EDITORIAL_UPDATED, blogPageMetadata, editorialLd } from "@/lib/seo";

// How the blog is written, sourced, checked and corrected (SEO plan §4.4). Every line here
// must stay true of how posts are actually made: if the review rule, AI use or the
// correction address changes, change this page in the same commit.

const TITLE = "Editorial policy: how we write and check posts | D-Human";
const DESCRIPTION = "Who writes D-Human's blog, where its numbers come from, who checks a post before it goes live, how AI is used, and how to report an error.";

export const metadata: Metadata = blogPageMetadata({ path: EDITORIAL_PATH, title: TITLE, description: DESCRIPTION });

const SECTIONS: { title: string; points: string[] }[] = [
  {
    title: "Who writes",
    points: [
      "Every post names the person who wrote it, links to a page about them, and states only roles and qualifications they really hold.",
      "Nobody is called a doctor or a dietitian unless they are one.",
    ],
  },
  {
    title: "Where the numbers come from",
    points: [
      "Every health number names its source in the post's Sources: ICMR-NIN's 2020 requirements for Indians, USDA FoodData Central, peer-reviewed papers or official data.",
      "Examples worked out for a post are labelled as examples.",
      "Posts don't publish ranges or cut-offs for a single marker. Your lab's printed range is the one that applies to you.",
    ],
  },
  {
    title: "Who checks a post",
    points: [
      "Before any post goes live, and whenever its words change, a second person at D-Human reads it. That reader is never the post's writer or the last person to edit it.",
      "No doctor reviews our posts yet. When one does, the post will name them, say when they reviewed it, and the page's data will say the same.",
      "D-Human's blood report reads are AI-analysed. No doctor reviews them.",
    ],
  },
  {
    title: "What our posts never do",
    points: [
      "Diagnose, or tell you that you have a condition. Posts talk about markers, ranges and risk, and say when something is worth showing a doctor.",
      "Promise that a food or a supplement cures, treats or prevents a disease.",
      "Name supplement or lab brands, carry affiliate links, or take money to mention anything. D-Human has no brand partners.",
      "Give doses of medicines.",
    ],
  },
  {
    title: "How AI is used",
    points: [
      "Drafts may be prepared with AI tools. A named person checks every fact against its source and is accountable for the page.",
      "An AI is never listed as an author.",
    ],
  },
  {
    title: "Dates and corrections",
    points: [
      "Each post shows when it was published, and the date of its last real change to what it says. Typo fixes don't change that date.",
      `Found an error? Write to ${CORRECTIONS_EMAILS.join(" or ")}. We check it against the sources and fix the post if we got it wrong.`,
    ],
  },
];

export default function EditorialPolicyPage() {
  const updated = new Date(`${EDITORIAL_UPDATED}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <JsonLd data={editorialLd()} />
      <section className="pt-28 pb-12 sm:pt-36 sm:pb-16">
        <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
          <Crumbs items={[{ label: "D-Human", href: "/" }, { label: "Editorial policy" }]} />
          <h1 className="semiwide mt-2 max-w-[18ch] text-title font-bold text-balance">How we write and check posts</h1>
          <p className="mt-6 max-w-[52ch] text-graphite sm:text-xl sm:leading-normal">
            {keepBrand("The D-Human blog covers food, blood tests and preventive health. This is how its posts are written, sourced and checked.")}
          </p>
          <p className="mt-4 text-sm text-graphite">
            Updated <time dateTime={EDITORIAL_UPDATED}>{updated}</time>
          </p>
        </div>
      </section>
      <section className="paper py-16 sm:py-24">
        <div className="mx-auto grid w-full max-w-[1280px] gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:gap-8">
          {SECTIONS.map((s) => (
            <div key={s.title} className="border-t-2 border-ink pt-5 lg:col-span-6">
              <h2 className="semiwide text-2xl leading-tight font-bold">{s.title}</h2>
              <div className="mt-5 max-w-[60ch]">
                <Points tone="paper" items={s.points.map(keepBrand)} />
              </div>
            </div>
          ))}
          <p className="max-w-[60ch] text-sm text-smoke lg:col-span-12">
            Everything on the blog is general information, not medical advice. If something applies to you, it&apos;s worth asking a doctor. More on how
            D-Human uses sources and AI:{" "}
            <Link href="/sources-and-safety" className="font-semibold text-ink underline underline-offset-4">
              Sources and safety
            </Link>
            .
          </p>
        </div>
      </section>
      <BlogCta />
    </>
  );
}
