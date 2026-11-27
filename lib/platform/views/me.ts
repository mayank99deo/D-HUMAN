import "server-only";
import { askGate } from "@/lib/ask/types";
import type { Profile } from "@/lib/db/schema";
import { personaFor } from "../profile";

// Who is signed in, worked out once for both the web's app layout (the nav's initial, the
// first-run tour, Ask's gate) and the apps (GET /api/me), so the two can't drift (the mobile
// repo's docs/API.md §3.2). This is the only answer that carries the profile in full, with
// medicines, conditions and pregnancy (QA's T1): the apps' Settings and onboarding use it.

/**
 * The name's first character, whole (backend test engineer, hunt 1; on the web too, Mayank's
 * call of 2026-11-27). The first UTF-16 unit of a name that starts with an emoji or another
 * character outside the BMP is half of one: a lone surrogate, which the nav drew as a broken
 * glyph and Swift's JSONDecoder refuses with the whole of GET /api/me. Then the first grapheme
 * ("👍🏽", "🇮🇳"); every other name keeps exactly the initial it had.
 */
export function initialOf(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim() ?? "";
  const unit = trimmed[0];
  if (unit === undefined || !/[\ud800-\udfff]/.test(unit)) return (unit ?? email[0] ?? "D").toUpperCase();
  const first = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(trimmed)[Symbol.iterator]().next().value?.segment;
  return (first ?? email[0] ?? "D").toUpperCase();
}

export function meView(user: { id: string; email: string }, profile: Profile | null) {
  const persona = profile ? personaFor(profile) : null;
  const onboarded = !!profile?.onboardedAt;
  return {
    user,
    profile,
    persona,
    onboarded,
    initial: initialOf(profile?.name, user.email),
    // Ask is open to this person: founders first, then onboarded adults (askGate).
    askOpen: !!profile && askGate({ email: user.email, onboardedAt: profile.onboardedAt, birthYear: profile.birthYear }) === "ok",
    // The first-run tour waits until it's done; people onboarded before it shipped were marked done by 0006.
    tourPending: onboarded && !profile?.tourDoneAt,
  };
}

export type MeView = ReturnType<typeof meView>;
