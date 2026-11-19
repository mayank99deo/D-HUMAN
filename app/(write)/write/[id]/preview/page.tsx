import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PostArticle } from "@/components/blog/PostArticle";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { ReviewDecision } from "@/components/write/ReviewDecision";
import { Gate, WriteLoading } from "@/components/write/WriteShell";
import { writerAccess } from "@/lib/auth/author";
import { getEditorPost, previewPost } from "@/lib/blog/store";

// The latest saved draft, rendered by the reader's own PostArticle, so the preview is the
// post page block for block (designer §3.7). Writers only, never indexed. The founder
// asked to read it answers below the post; a strip at the foot says it isn't public.

export const metadata: Metadata = { title: "Preview" };

async function Preview({ params }: { params: Promise<{ id: string }> }) {
  const access = await writerAccess();
  if (access.kind !== "author") return <Gate kind={access.kind} />;
  const { id } = await params;
  const post = await getEditorPost(access.author, id);
  if (!post) notFound();
  const page = await previewPost(post);
  const askedMe = post.review && post.review.reviewer.id === access.author.id ? post.review : null;

  return (
    <div className="pb-16">
      <Header subpage blog />
      <main>
        <PostArticle post={page} related={[]} />
      </main>
      {askedMe && (
        <section aria-label="Your read" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <ReviewDecision review={askedMe} draftVersion={post.draftVersion} />
        </section>
      )}
      <Footer guides />
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <p className="text-sm font-semibold">{askedMe ? "Preview. Not public. Your read is at the end." : "Preview. Not public."}</p>
          <Link href={`/write/${post.id}`} className="button-ghost h-11 shrink-0 px-3 text-sm">
            Back to the editor
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PreviewPage({ params }: PageProps<"/write/[id]/preview">) {
  return (
    <Suspense fallback={<WriteLoading title="Preview" />}>
      <Preview params={params} />
    </Suspense>
  );
}
