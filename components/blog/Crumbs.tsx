import Link from "next/link";
import { Fragment } from "react";

// Breadcrumbs as the guides show them: D-Human / Blog / Topic. Each link is 44 px tall. An
// item without a link is the page you're on. The same trail is in the page's structured data.

export type Crumb = { label: string; href?: string };

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 text-sm text-graphite">
        {items.map((c, i) => (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && <li aria-hidden="true">/</li>}
            {c.href ? (
              <li>
                <Link href={c.href} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-paper hover:underline active:text-paper">
                  {c.label}
                </Link>
              </li>
            ) : (
              <li aria-current="page" className="inline-flex min-h-11 items-center text-paper">
                {c.label}
              </li>
            )}
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
