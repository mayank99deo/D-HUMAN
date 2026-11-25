import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmailStatusView } from "@/components/write/EmailStatus";
import { Gate, WriteLoading, WriteShell } from "@/components/write/WriteShell";
import { writerAccess } from "@/lib/auth/author";
import { loadEmailStatus } from "@/lib/email/status";

// /write/status: the founders' email status page. Founders are the blog's writers
// (BLOG_OWNER_EMAILS), so it shares /write's access check and robots rule. Read only and
// rendered per request (writerAccess awaits connection()), never cached. Anyone else signed
// in gets the 404 page, so the page doesn't reveal itself.

export const metadata: Metadata = { title: "Email status" };

async function Status() {
  const access = await writerAccess();
  if (access.kind === "signed_out") return <Gate kind="signed_out" next="/write/status" />;
  if (access.kind !== "author") notFound();
  const status = await loadEmailStatus();
  return (
    <WriteShell active="status" wide>
      <EmailStatusView status={status} />
    </WriteShell>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={<WriteLoading title="Email status" wide />}>
      <Status />
    </Suspense>
  );
}
