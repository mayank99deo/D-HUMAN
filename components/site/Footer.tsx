import Link from "next/link";
import { Wordmark } from "@/components/brand/Logo";
import { hasLivePosts } from "@/lib/blog/registry";
import { GUIDES } from "@/lib/seo";
import { isWaitlist } from "@/lib/site-mode";

const QUIET_LINK = "inline-flex min-h-11 items-center text-graphite underline-offset-4 transition-colors hover:text-paper hover:underline active:text-paper";

// `guides`: links to every guide page, on the guides and the blog. The landing page links to
// the guides from its sections instead, so its last slide, sized with this footer at 13rem,
// still fits one screen.
//
// "Blog" appears only once a post is live (no link to an empty blog). The registry's cache
// tag re-renders every page with this footer when /write publishes. On the landing page it
// sits at the end of the wordmark's row, its 44 px tap area overlapping the margin around it,
// so the footer is no taller than before.
export async function Footer({ guides = false }: { guides?: boolean }) {
  const blog = await hasLivePosts();
  return (
    <footer className="border-t border-paper/15 py-14">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-5 sm:px-8 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-4">
          <div className="flex items-center justify-between gap-6">
            <Wordmark className="h-4 w-auto shrink-0" />
            {blog && !guides && (
              <Link href="/blog" className={`-my-3.5 text-sm ${QUIET_LINK}`}>
                Blog
              </Link>
            )}
          </div>
          <p className="mt-4 text-sm text-graphite">Test first. Supplement second.</p>
          {guides && (
            <nav aria-label="Guides and blog" className="mt-4">
              <ul className="flex flex-wrap gap-x-5 text-sm">
                {blog && (
                  <li>
                    <Link href="/blog" className={QUIET_LINK}>
                      Blog
                    </Link>
                  </li>
                )}
                {GUIDES.map((g) => (
                  <li key={g.path}>
                    <Link href={g.path} className={QUIET_LINK}>
                      {g.crumb}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
        <p className="max-w-[60ch] text-sm text-graphite lg:col-span-6 lg:col-start-7">
          {/* One string per mode, so each renders as a single text node. Open mode runs no tests of
              its own: it estimates meals and reads the reports people bring. */}
          {isWaitlist
            ? "D-Human offers wellness guidance and screening. It does not diagnose or treat any condition. Imaging and clinical tests are run by licensed partner centres."
            : "D-Human offers wellness guidance and screening. It does not diagnose or treat any condition. Meal numbers are estimates, and report reads are AI-analysed."}
          <span className="mt-4 block">© 2026 D-Human</span>
        </p>
      </div>
    </footer>
  );
}
