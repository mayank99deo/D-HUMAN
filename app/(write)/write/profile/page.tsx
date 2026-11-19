import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileForm } from "@/components/write/ProfileForm";
import { Gate, WriteLoading, WriteShell } from "@/components/write/WriteShell";
import { writerAccess } from "@/lib/auth/author";
import { getAuthorProfile } from "@/lib/blog/store";

export const metadata: Metadata = { title: "Your profile" };

async function Profile() {
  const access = await writerAccess();
  if (access.kind !== "author") return <Gate kind={access.kind} />;
  const profile = await getAuthorProfile(access.author);
  return (
    <WriteShell active="profile">
      <ProfileForm initial={profile} />
    </WriteShell>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<WriteLoading title="Your profile" />}>
      <Profile />
    </Suspense>
  );
}
