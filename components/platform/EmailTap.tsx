"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { emailTapFrom, firstTap } from "./email-tap";
import { send } from "./net";

// Records a tap on an email's link (?e=<send id>) once the screen opens signed in, then
// takes `e` out of the address bar. Mounted on every signed-in screen (the app layout and
// onboarding). A tap that went through sign-in first counts too: `e` rides along in
// /signin?next=… and arrives here afterwards. The server ignores ids that aren't this
// person's, and records only the first tap.
export function EmailTap() {
  const e = useSearchParams().get("e");
  useEffect(() => {
    if (e === null) return;
    const tap = emailTapFrom(window.location.href);
    if (!tap) return;
    // Next.js keeps its router in step with replaceState, and nothing reloads.
    window.history.replaceState(null, "", tap.cleanHref);
    if (tap.sendId && firstTap(tap.sendId)) void send("/api/email/tap", { body: { e: tap.sendId }, keepalive: true });
  }, [e]);
  return null;
}
