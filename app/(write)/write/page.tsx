import type { Metadata } from "next";
import { Suspense } from "react";
import { PostsList, TABS, type Tab } from "@/components/write/PostsList";
import { Gate, WriteLoading, WriteShell } from "@/components/write/WriteShell";
import { writerAccess } from "@/lib/auth/author";
import { listPosts } from "@/lib/blog/store";

export const metadata: Metadata = { title: "Posts" };

async function Posts({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const access = await writerAccess();
  if (access.kind !== "author") return <Gate kind={access.kind} />;
  const { tab } = await searchParams;
  const current: Tab = TABS.some((t) => t.key === tab) ? (tab as Tab) : "drafts";
  const posts = await listPosts();
  return (
    <WriteShell active="posts">
      <PostsList posts={posts} tab={current} />
    </WriteShell>
  );
}

export default function WritePage({ searchParams }: PageProps<"/write">) {
  return (
    <Suspense fallback={<WriteLoading title="Posts" />}>
      <Posts searchParams={searchParams as Promise<{ tab?: string }>} />
    </Suspense>
  );
}
