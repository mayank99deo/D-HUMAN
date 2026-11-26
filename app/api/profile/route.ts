import { eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { MAX_AGE, MIN_AGE } from "@/components/platform/age";
import { appActor, isAppRequest } from "@/lib/api/actor";
import { claimEventSearch } from "@/lib/api/app-limits";
import { privateJson } from "@/lib/api/respond";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { BUDGET_IDS } from "@/lib/domain/budget";
import { consentCurrent } from "@/lib/domain/consent";
import { sendWelcome } from "@/lib/email/jobs";
import { ACTIVITY_IDS, CONDITION_IDS, DIET_IDS, GOAL_IDS, LANGUAGE_IDS, LEVEL_IDS, SEX_IDS } from "@/lib/domain/options";
import { ensureEvents } from "@/lib/platform/events";
import { json, unauthorized } from "@/lib/platform/http";
import { getProfile, personaFor } from "@/lib/platform/profile";
import { sheetFieldsChanged } from "@/lib/sheets/user-row";
import { pushUserRow } from "@/lib/sheets/users";
import { allowRequest, secondsUntilReset } from "@/lib/waitlist/rate-limit";

const text = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);

// Built per request, so the age rule follows the calendar year.
const patchSchema = (thisYear: number) =>
  z
    .object({
      name: text(60),
      birthYear: z.number().int().min(thisYear - MAX_AGE).max(thisYear - MIN_AGE).nullable(),
      sex: z.enum(SEX_IDS).nullable(),
      heightCm: z.number().min(100).max(250).nullable(),
      weightKg: z.number().min(25).max(300).nullable(),
      city: text(80),
      country: text(60),
      timezone: z.string().max(64).nullable(),
      language: z.enum(LANGUAGE_IDS),
      activities: z.array(z.enum(ACTIVITY_IDS)).max(10),
      primaryActivity: z.enum(ACTIVITY_IDS).nullable(),
      level: z.enum(LEVEL_IDS).nullable(),
      sessionsPerWeek: z.number().int().min(0).max(21).nullable(),
      goals: z.array(z.enum(GOAL_IDS)).max(3),
      eventInMind: text(120),
      diet: z.enum(DIET_IDS).nullable(),
      conditions: z.array(z.enum(CONDITION_IDS)).max(10),
      medications: text(400),
      currentSupplements: text(400),
      supplementBudget: z.enum(BUDGET_IDS).nullable(),
      consent: z.literal(true),
      complete: z.literal(true),
    })
    .partial();

// Fields that may be saved before consent: none of them is about health.
const BEFORE_CONSENT = new Set(["language", "timezone"]);

const sameList = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) => (a ?? []).join(",") === (b ?? []).join(",");

// What only the apps send (the mobile repo's docs/specs/README.md, gap G2): the health question
// answered, with the conditions (pregnancy among them, an empty list for none) and the medicines
// (null for none) in the same save. The web's saves never carry it, and from them it's ignored.
const appExtra = z.object({ healthChecked: z.literal(true).optional() });

export async function POST(request: Request) {
  // A request carrying Authorization is an app's: taken as its token, answered privately. Every
  // other request is the web's, resolved and answered exactly as before.
  const app = isAppRequest(request);
  const user = app ? ((await appActor(request))?.user ?? null) : await apiUser();
  if (!user) return app ? privateJson({ error: "signed_out" }, 401) : unauthorized();
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => (app ? privateJson(body, status, headers) : json(body, status));
  // Onboarding saves once per step; 30 an hour leaves room for that and for Settings.
  if (!allowRequest(`profile:${user.id}`, 30, 60 * 60_000)) return reply({ error: "rate_limited" }, 429, app ? { "retry-after": String(secondsUntilReset(`profile:${user.id}`) || 60) } : {});
  const raw = await request.json().catch(() => null);
  const parsed = patchSchema(new Date().getFullYear()).safeParse(raw);
  if (!parsed.success) return reply({ error: "invalid", issues: parsed.error.issues.map((i) => i.path.join(".")) }, 400);
  const extra = app ? appExtra.safeParse(raw) : null;
  if (extra && !extra.success) return reply({ error: "invalid", issues: ["healthChecked"] }, 400);
  const healthChecked = !!extra?.data.healthChecked;
  // Both halves of the question answered in the same save: conditions and medicines (review finding 2).
  if (healthChecked && (!parsed.data.conditions || parsed.data.medications === undefined)) return reply({ error: "invalid", issues: ["conditions", "medications"] }, 400);

  const { consent, complete, timezone, ...fields } = parsed.data;
  const before = await getProfile(user.id);

  // No health answers are stored until the person has agreed.
  const consented = !!before?.consentAt || consent === true;
  if (!consented && Object.keys(parsed.data).some((k) => !BEFORE_CONSENT.has(k))) return reply({ error: "consent_required" }, 403);

  const values: Partial<typeof schema.profiles.$inferInsert> = { ...fields, updatedAt: new Date() };
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      values.timezone = timezone;
    } catch {
      /* ignore an unknown zone */
    }
  }
  // Keep the moment they first agreed. The consent step's words now cover Ask's questions too
  // (contract §7.3), so people agreeing now never see Ask's one-time notice; people who agreed
  // before Ask existed keep ask_consent_at null and see it once.
  if (consent && !before?.consentAt) {
    const now = new Date();
    values.consentAt = now;
    values.askConsentAt = before?.askConsentAt ?? now;
  }
  // The apps ask again when the consent wording has changed since the person agreed (their
  // writes answer 409 consent_needed until then); agreeing records the moment they agreed to it.
  if (app && consent && before?.consentAt && !consentCurrent(before.consentAt)) values.consentAt = new Date();
  if (healthChecked) values.healthCheckedAt = new Date();
  if (fields.activities && !fields.primaryActivity && fields.activities.length === 1) values.primaryActivity = fields.activities[0];

  if (complete) values.onboardedAt = before?.onboardedAt ?? new Date();

  // Apps only: a save after onboarding that changes what event searches depend on sets off a paid
  // search, so it counts against the week's few (lib/api/app-limits.ts); past them, nothing is
  // saved and the app gets 429 with Retry-After. Onboarding's own search doesn't count.
  if (app && before?.onboardedAt) {
    const next = { ...before, ...values };
    const changes = next.city !== before.city || next.primaryActivity !== before.primaryActivity || next.eventInMind !== before.eventInMind || !sameList(next.activities, before.activities);
    const refused = changes ? await claimEventSearch(user.id) : null;
    if (refused) return refused;
  }

  const d = await db();
  const [saved] = await d.update(schema.profiles).set(values).where(eq(schema.profiles.userId, user.id)).returning();
  if (!saved) return reply({ error: "not_found" }, 404);

  // Event searches cost money, so look them up only when onboarding finishes
  // or something they depend on actually changed.
  const justFinished = !!complete && !before?.onboardedAt;
  const searchChanged =
    !!before &&
    (saved.city !== before.city ||
      saved.primaryActivity !== before.primaryActivity ||
      saved.eventInMind !== before.eventInMind ||
      !sameList(saved.activities, before.activities));
  if (saved.onboardedAt && (justFinished || searchChanged)) {
    const persona = personaFor(saved);
    after(() => ensureEvents(saved, persona));
  }
  // The welcome email, once per account, after the response so it never holds up the save.
  // A dry run until EMAIL_LIFECYCLE_LIVE is on; the daily job catches up any that didn't go.
  if (justFinished) after(() => sendWelcome(saved));
  // The founders' Sheet: once onboarding finishes, and when Settings changes a field it shows.
  // Saves during onboarding (one per step) wait for its end; the daily job has them anyway.
  if (saved.onboardedAt && (justFinished || sheetFieldsChanged(before, saved))) after(() => pushUserRow(user.id));
  return reply({ status: "saved" });
}
