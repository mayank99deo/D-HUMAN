import "server-only";
import { askGate } from "@/lib/ask/types";
import type { Profile } from "@/lib/db/schema";
import { personaFor } from "../profile";

// Who is signed in, worked out once for both the web's app layout (the nav's initial, the
// first-run tour, Ask's gate) and the apps (GET /api/me), so the two can't drift (the mobile
// repo's docs/API.md §3.2). This is the only answer that carries the profile in full, with
// medicines, conditions and pregnancy (QA's T1): the apps' Settings and onboarding use it.

export function meView(user: { id: string; email: string }, profile: Profile | null) {
  const persona = profile ? personaFor(profile) : null;
  const onboarded = !!profile?.onboardedAt;
  return {
    user,
    profile,
    persona,
    onboarded,
    initial: (profile?.name?.trim()[0] ?? user.email[0] ?? "D").toUpperCase(),
    // Ask is open to this person: founders first, then onboarded adults (askGate).
    askOpen: !!profile && askGate({ email: user.email, onboardedAt: profile.onboardedAt, birthYear: profile.birthYear }) === "ok",
    // The first-run tour waits until it's done; people onboarded before it shipped were marked done by 0006.
    tourPending: onboarded && !profile?.tourDoneAt,
  };
}

export type MeView = ReturnType<typeof meView>;
