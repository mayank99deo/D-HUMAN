import "server-only";
import { BUDGETS } from "@/lib/domain/budget";
import { ACTIVITIES, CONDITIONS, DIETS, GOALS, LANGUAGES, LEVELS, SEXES } from "@/lib/domain/options";
import type { PlanDetail } from "@/lib/platform/plan-state";
import { planJson } from "./parts";

// The apps' Settings, option lists and remote config (lib/api/schemas.ts SettingsResponse,
// OptionsResponse, ConfigResponse). None of these carries health words; they shape the web's own
// lists and loaders, so the web's Settings page and onboarding stay as they are.

/** The age range onboarding allows, as the web's profile route checks it (components/platform/age.ts). */
const MIN_AGE = 18;
const MAX_AGE = 100;

/** GET /api/app/options: every list onboarding and Settings show, with ids and labels. Not personal. */
export function optionsJson(thisYear = new Date().getFullYear()) {
  const pick = (list: readonly { id: string; label: string; hint?: string }[]) => list.map((o) => ({ id: o.id, label: o.label, hint: o.hint ?? null }));
  return {
    activities: pick(ACTIVITIES),
    levels: pick(LEVELS),
    goals: pick(GOALS),
    diets: pick(DIETS),
    conditions: pick(CONDITIONS),
    sexes: pick(SEXES),
    languages: pick(LANGUAGES),
    budgets: BUDGETS.map((b) => ({ id: b.id, label: b.label, cap: b.cap })),
    birthYears: { min: thisYear - MAX_AGE, max: thisYear - MIN_AGE },
    limits: { goals: 3, activities: 10, conditions: 10 },
  };
}

/**
 * The remote switches the apps know (the mobile repo's docs/APP-STRUCTURE.md §7). They only ever
 * turn a thing off: a name in APP_SWITCHES_OFF (comma-separated) is off, anything else is on, and
 * an unknown name is ignored. Nothing in an App Store build waits for one to turn on.
 */
export const APP_SWITCHES = ["voice", "snap", "again", "reminders", "appleSignIn", "iap", "doses"] as const;
export type AppSwitch = (typeof APP_SWITCHES)[number];

/** GET /api/app/config: versions, the store link, the API's address and the switches turned off. From the server's settings only. */
export function configJson(env: Record<string, string | undefined> = process.env) {
  const asked = (env.APP_SWITCHES_OFF ?? "").split(",").map((s) => s.trim());
  const url = (v: string | undefined) => (v && /^https:\/\//.test(v) ? v : null);
  return {
    minSupported: env.APP_MIN_VERSION_IOS?.trim() || "1.0.0",
    latest: env.APP_LATEST_VERSION_IOS?.trim() || null,
    updateUrl: url(env.APP_STORE_URL_IOS),
    apiBase: "https://www.d-human.fit",
    off: APP_SWITCHES.filter((s) => asked.includes(s)),
    links: { privacy: url(env.APP_PRIVACY_URL), terms: url(env.APP_TERMS_URL), support: url(env.APP_SUPPORT_URL) },
    notice: env.APP_NOTICE?.trim() || null,
  };
}

type Passes = { paidOn: string; from: string; until: string }[];

/**
 * GET /api/settings: the plan, the passes bought (dates only, never an amount: a web pass's amount
 * would show the web's price, spec D17), the email settings, and how the weekly wrap reaches the
 * person (gap G6: by email until the apps' push ships).
 */
export function settingsJson(o: { email: string; plan: PlanDetail; passes: Passes; emails: { weekly: boolean; questions: boolean; weeklyPausedAt: Date | null } }) {
  return {
    email: o.email,
    plan: planJson(o.plan),
    passes: o.passes.map((p) => ({ paidOn: p.paidOn, from: p.from, until: p.until })),
    emails: { weekly: o.emails.weekly, questions: o.emails.questions, weeklyPaused: Boolean(o.emails.weeklyPausedAt) },
    weekly: { channel: "email" as const },
  };
}
