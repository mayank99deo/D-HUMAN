import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Editor } from "@/components/write/Editor";
import { Gate, WriteLoading, WriteShell } from "@/components/write/WriteShell";
import { otherAuthors, writerAccess } from "@/lib/auth/author";
import { getEditorPost } from "@/lib/blog/store";

export const metadata: Metadata = { title: "Editor" };

async function Edit({ params }: { params: Promise<{ id: string }> }) {
  const access = await writerAccess();
  if (access.kind !== "author") return <Gate kind={access.kind} />;
  const { author } = access;
  const { id } = await params;
  const [post, reviewers] = await Promise.all([getEditorPost(author, id), otherAuthors(author)]);
  if (!post) notFound();
  return (
    <WriteShell active="posts">
      <Editor initial={post} me={{ id: author.id, name: author.name, freshSession: author.freshSession }} reviewers={reviewers} />
    </WriteShell>
  );
}

export default function EditPage({ params }: PageProps<"/write/[id]">) {
  return (
    <Suspense fallback={<WriteLoading title="Opening the post" />}>
      <Edit params={params} />
    </Suspense>
  );
}
