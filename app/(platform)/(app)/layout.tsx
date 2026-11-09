import type { Metadata } from "next";
import { Suspense } from "react";
import { Nav, NavView } from "@/components/platform/Nav";
import { getSessionUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/platform/profile";

export const metadata: Metadata = {
  title: { default: "D-Human", template: "%s | D-Human" },
  robots: { index: false },
};

async function NavWithUser() {
  const user = await getSessionUser();
  const profile = user ? await getProfile(user.id) : null;
  const initial = (profile?.name?.trim()[0] ?? user?.email[0] ?? "D").toUpperCase();
  return <Nav initial={initial} />;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh pb-24 lg:pb-0 lg:pl-24">
      <Suspense fallback={<NavView initial="" path="" />}>
        <NavWithUser />
      </Suspense>
      {children}
    </div>
  );
}
