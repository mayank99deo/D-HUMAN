import "server-only";
import { aiMode } from "@/lib/ai/client";
import { isOwnerEmail } from "@/lib/auth/owners";
import { CONSENT_VERSION, consentCurrent } from "@/lib/domain/consent";
import type { MeView } from "@/lib/platform/views/me";

// The apps' "who am I" (lib/api/schemas.ts MeResponse), shaped from the web layout's own view
// (lib/platform/views/me.ts). Only the app routes import lib/api/views.

/** GET /api/me's answer (lib/api/schemas.ts, MeResponse). Ask isn't in the apps (plan §2 row 5), so its gate isn't sent. */
export function meJson(v: MeView) {
  const p = v.profile;
  const at = p?.consentAt ?? null;
  return {
    id: v.user.id,
    email: v.user.email,
    onboarded: v.onboarded,
    consent: { at: at?.toISOString() ?? null, version: CONSENT_VERSION, current: consentCurrent(at) },
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
