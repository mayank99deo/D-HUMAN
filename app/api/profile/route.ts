import { eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { MAX_AGE, MIN_AGE } from "@/components/platform/age";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { BUDGET_IDS } from "@/lib/domain/budget";
import { ACTIVITY_IDS, CONDITION_IDS, DIET_IDS, GOAL_IDS, LANGUAGE_IDS, LEVEL_IDS, SEX_IDS } from "@/lib/domain/options";
import { ensureEvents } from "@/lib/platform/events";
import { json, unauthorized } from "@/lib/platform/http";
import { getProfile, personaFor } from "@/lib/platform/profile";
import { allowRequest } from "@/lib/waitlist/rate-limit";

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

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  // Onboarding saves once per step; 30 an hour leaves room for that and for Settings.
  if (!allowRequest(`profile:${user.id}`, 30, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const parsed = patchSchema(new Date().getFullYear()).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid", issues: parsed.error.issues.map((i) => i.path.join(".")) }, 400);

  const { consent, complete, timezone, ...fields } = parsed.data;
  const before = await getProfile(user.id);

  // No health answers are stored until the person has agreed.
  const consented = !!before?.consentAt || consent === true;
  if (!consented && Object.keys(parsed.data).some((k) => !BEFORE_CONSENT.has(k))) return json({ error: "consent_required" }, 403);

  const values: Partial<typeof schema.profiles.$inferInsert> = { ...fields, updatedAt: new Date() };
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      values.timezone = timezone;
    } catch {
      /* ignore an unknown zone */
    }
  }
  // Keep the moment they first agreed.
  if (consent && !before?.consentAt) values.consentAt = new Date();
  if (fields.activities && !fields.primaryActivity && fields.activities.length === 1) values.primaryActivity = fields.activities[0];

  if (complete) values.onboardedAt = before?.onboardedAt ?? new Date();

  const d = await db();
  const [saved] = await d.update(schema.profiles).set(values).where(eq(schema.profiles.userId, user.id)).returning();
  if (!saved) return json({ error: "not_found" }, 404);

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
  return json({ status: "saved" });
}
