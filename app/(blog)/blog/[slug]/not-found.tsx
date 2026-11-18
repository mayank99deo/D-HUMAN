import Link from "next/link";
import { GUIDES } from "@/lib/seo";

// A post that isn't there: never published, taken down or deleted (all 404, Mayank's call).
// Same header and footer as the blog; a way back to the latest posts and the guides.
export default function PostNotFound() {
  return (
    <section className="pt-28 pb-20 sm:pt-36 sm:pb-28">
      <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
        <h1 className="semiwide max-w-[18ch] text-title font-bold text-balance">This post isn&apos;t available</h1>
        <p className="mt-6 max-w-[46ch] text-graphite sm:text-xl sm:leading-normal">It may have been taken down for an update.</p>
        <Link href="/blog" className="button-primary mt-9 h-14">
          Read the latest posts
        </Link>
        <h2 className="mt-14 text-base font-bold">Guides</h2>
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
    </section>
  );
}
