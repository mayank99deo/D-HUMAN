import type { Metadata } from "next";
import { Suspense } from "react";
import { Nav, NavView } from "@/components/platform/Nav";
import { Tour } from "@/components/platform/Tour";
import { getSessionUser } from "@/lib/auth/session";
import { getProfile, personaFor } from "@/lib/platform/profile";

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

// The first-run tour, for onboarded people. It waits for the tour to be done on
// the server; people onboarded before it shipped were marked done by migration
// 0006. Same cached user and profile reads as the nav, so no extra queries.
async function TourForUser() {
  const user = await getSessionUser();
  const profile = user ? await getProfile(user.id) : null;
  if (!user || !profile?.onboardedAt) return null;
  return <Tour who={user.id} pending={!profile.tourDoneAt} name={personaFor(profile).firstName} />;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // clip, not hidden: wide glows (the verdict's) can't widen the page, and sticky still works.
    <div className="min-h-dvh overflow-x-clip pb-24 lg:pb-0 lg:pl-24">
      <Suspense fallback={<NavView initial="" path="" />}>
        <NavWithUser />
      </Suspense>
      {children}
      {/* Its own boundary with no fallback: it never holds up the page. */}
      <Suspense fallback={null}>
        <TourForUser />
      </Suspense>
    </div>
  );
}
