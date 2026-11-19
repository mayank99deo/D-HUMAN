import Link from "next/link";
import { TOPIC_LABELS } from "@/lib/blog/checks";
import type { PostListRow } from "@/lib/blog/store";
import { NewPostButton } from "./NewPostButton";

// /write: Drafts, Published, Taken down (designer §3.3). Each row: title, topic, who
// edited it last and when, and its state in words.

export type Tab = "drafts" | "live" | "down";
export const TABS: { key: Tab; label: string; empty: string }[] = [
  { key: "drafts", label: "Drafts", empty: "No drafts. Your next post starts here." },
  { key: "live", label: "Published", empty: "Nothing published yet." },
  { key: "down", label: "Taken down", empty: "Nothing taken down." },
];

const IN_TAB: Record<Tab, (p: PostListRow) => boolean> = {
  drafts: (p) => p.status === "draft",
  live: (p) => p.status === "live",
  down: (p) => p.status === "taken_down",
};

const when = (iso: string) => {
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(x);
  const sameDay = day(d) === day(new Date());
  return sameDay ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(d) : day(d);
};

function tags(p: PostListRow): string[] {
  const out: string[] = [];
  if (p.status === "live") out.push(p.changesNotLive ? "Live · changes not live" : "Live");
  if (p.status === "draft") out.push("Draft");
  if (p.status === "taken_down") out.push("Taken down");
  if (p.featured) out.push("Featured");
  if (p.review === "requested") out.push("Ready for a read");
  if (p.review === "looks_good") out.push("Looks good");
  if (p.review === "needs_changes") out.push("Needs changes");
  return out;
}

export function PostsList({ posts, tab }: { posts: PostListRow[]; tab: Tab }) {
  const shown = posts.filter(IN_TAB[tab]);
  const none = posts.length === 0;
  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-20 sm:px-6 lg:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Posts</h1>
        <NewPostButton />
      </div>
      {none ? (
        <div className="mt-10 border border-line-strong p-5">
          <p className="text-lg">No posts yet. Your first one starts here.</p>
          <p className="mt-2 text-graphite">Writing in Google Docs? Use Import: paste the whole document and it keeps its headings, bold, links and lists.</p>
          <Link href="/write/import" className="button-ghost mt-4 h-12">
            Import from Google Docs
          </Link>
        </div>
      ) : (
        <>
          <nav aria-label="Post states" className="relative mt-8 flex gap-2 overflow-x-auto">
            {TABS.map((t) => {
              const count = posts.filter(IN_TAB[t.key]).length;
              return (
                <Link key={t.key} href={t.key === "drafts" ? "/write" : `/write?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined} className={`choice shrink-0 ${tab === t.key ? "bg-paper text-ink" : ""}`}>
                  {t.label} <span className={`ml-1.5 ${tab === t.key ? "text-ink/60" : "text-graphite"}`}>{count}</span>
                </Link>
              );
            })}
          </nav>
          {shown.length === 0 ? (
            <p className="mt-8 text-graphite">{TABS.find((t) => t.key === tab)!.empty}</p>
          ) : (
            <ul className="mt-6 border-t border-line">
              {shown.map((p) => (
                <li key={p.id} className="border-b border-line">
                  <Link href={`/write/${p.id}`} className="block py-4 active:bg-lift">
                    <span className="block text-lg leading-snug font-semibold break-words">{p.title}</span>
                    <span className="mt-1 block text-sm text-graphite">
                      {[p.topic ? TOPIC_LABELS[p.topic] : "No topic yet", `Edited ${when(p.editedAt)}${p.editedBy ? ` by ${p.editedBy}` : ""}`].join(" · ")}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-2">
                      {tags(p).map((t) => (
                        <span key={t} className="border border-line-strong px-2 py-0.5 text-xs">
                          {t}
                        </span>
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
