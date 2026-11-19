import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportPaste } from "@/components/write/ImportPaste";
import { Gate, WriteLoading, WriteShell } from "@/components/write/WriteShell";
import { writerAccess } from "@/lib/auth/author";

export const metadata: Metadata = { title: "Import" };

async function Import() {
  const access = await writerAccess();
  if (access.kind !== "author") return <Gate kind={access.kind} />;
  return (
    <WriteShell active="import">
      <ImportPaste />
    </WriteShell>
  );
}

export default function ImportPage() {
  return (
    <Suspense fallback={<WriteLoading title="Import" />}>
      <Import />
    </Suspense>
  );
}
