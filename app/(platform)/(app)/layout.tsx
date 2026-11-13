import type { Metadata } from "next";
import { Suspense } from "react";
import { Nav, NavView } from "@/components/platform/Nav";
import { ScrollReset } from "@/components/platform/ScrollReset";
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
    // touch: on phones and tablets the screens scroll inside this frame, fixed to the
    // screen like the top bar and tab bar, and the page itself never scrolls. In-app
    // browsers on iOS 26 (the Google app's, at least) slide their address bar over the
    // top of a scrolled page and leave its first lines underneath, while fixed parts
    // stay put; inside a fixed frame the screen lines up with the bars, and a new
    // screen always opens at the top (ScrollReset). Laptops keep normal page scrolling.
    // The frame only scrolls: its spacing lives on the layer inside, so sticky parts
    // (home's bib, Settings' save bar) measure from the screen's edges as before.
    <div id="app-shell" className="touch:fixed touch:inset-0 touch:overflow-x-hidden touch:overflow-y-auto touch:overscroll-y-contain touch:scroll-pt-14">
      {/* clip, not hidden: wide glows (the verdict's) can't widen the page, and sticky still works.
          pt-14 is the room under the fixed top bar (Nav.tsx); globals.css keeps html's
          scroll-padding-top equal to it, so navigations reset to the very top. */}
      <div className="min-h-dvh overflow-x-clip pt-14 pb-24 short:max-lg:pb-16 lg:pb-0 lg:pl-24">
        <Suspense fallback={null}>
          <ScrollReset />
        </Suspense>
        <Suspense fallback={<NavView initial="" path="" />}>
          <NavWithUser />
        </Suspense>
        {children}
        {/* Its own boundary with no fallback: it never holds up the page. */}
        <Suspense fallback={null}>
          <TourForUser />
        </Suspense>
      </div>
    </div>
  );
}
