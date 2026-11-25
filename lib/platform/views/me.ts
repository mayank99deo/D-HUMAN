import "server-only";
import { aiMode } from "@/lib/ai/client";
import { askGate } from "@/lib/ask/types";
import { isOwnerEmail } from "@/lib/auth/owners";
import type { Profile } from "@/lib/db/schema";
import { personaFor } from "../profile";

// Who is signed in, worked out once for both the web's app layout (the nav's initial, the
// first-run tour, Ask's gate) and the apps (GET /api/me), so the two can't drift (the mobile
// repo's docs/API.md §3.2). This is the only answer that carries the profile in full, with
// medicines, conditions and pregnancy (QA's T1): the apps' Settings and onboarding use it.

/**
 * The consent wording's version: the day the current text went live (it added "and
 * questions" for Ask). Someone who agreed before it is asked again in the app. When the
 * app's own consent step names more (Apple's speech service), its new date goes here.
 */
export const CONSENT_VERSION = "2026-11-20";
const CONSENT_SINCE = Date.parse(`${CONSENT_VERSION}T00:00:00+05:30`);

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

/** GET /api/me's answer (lib/api/schemas.ts, MeResponse). Ask isn't in the apps (plan §2 row 5), so its gate isn't sent. */
export function meJson(v: MeView) {
  const p = v.profile;
  const at = p?.consentAt ?? null;
  return {
    id: v.user.id,
    email: v.user.email,
    onboarded: v.onboarded,
    consent: { at: at?.toISOString() ?? null, version: CONSENT_VERSION, current: !!at && at.getTime() >= CONSENT_SINCE },
    tourDone: !!p?.tourDoneAt,
    persona: v.persona
      ? { firstName: v.persona.firstName, initial: v.initial, bib: v.persona.bib, label: v.persona.label, archetype: v.persona.archetype, noun: v.persona.noun, level: v.persona.level, age: v.persona.age }
      : null,
    founder: isOwnerEmail(v.user.email),
    aiOff: aiMode() === "off",
    profile: {
      name: p?.name ?? null,
      birthYear: p?.birthYear ?? null,
      sex: p?.sex ?? null,
      heightCm: p?.heightCm ?? null,
      weightKg: p?.weightKg ?? null,
      city: p?.city ?? null,
      country: p?.country ?? null,
      timezone: p?.timezone ?? null,
      language: p?.language ?? "en",
      activities: p?.activities ?? [],
      primaryActivity: p?.primaryActivity ?? null,
      level: p?.level ?? null,
      sessionsPerWeek: p?.sessionsPerWeek ?? null,
      goals: p?.goals ?? [],
      eventInMind: p?.eventInMind ?? null,
      diet: p?.diet ?? null,
      conditions: p?.conditions ?? [],
      medications: p?.medications ?? null,
      currentSupplements: p?.currentSupplements ?? null,
      supplementBudget: p?.supplementBudget ?? null,
    },
  };
}
