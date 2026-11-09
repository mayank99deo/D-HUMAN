import { eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { ACTIVITY_IDS, CONDITION_IDS, DIET_IDS, GOAL_IDS, LANGUAGE_IDS, LEVEL_IDS, SEX_IDS } from "@/lib/domain/options";
import { ensureEvents } from "@/lib/platform/events";
import { json, unauthorized } from "@/lib/platform/http";
import { getProfile, personaFor } from "@/lib/platform/profile";

const thisYear = new Date().getFullYear();
const text = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);

const patch = z
  .object({
    name: text(60),
    birthYear: z.number().int().min(thisYear - 100).max(thisYear - 13).nullable(),
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
    consent: z.literal(true),
    complete: z.literal(true),
  })
  .partial();

export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid", issues: parsed.error.issues.map((i) => i.path.join(".")) }, 400);

  const { consent, complete, timezone, ...fields } = parsed.data;
  const values: Partial<typeof schema.profiles.$inferInsert> = { ...fields, updatedAt: new Date() };
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      values.timezone = timezone;
    } catch {
      /* ignore an unknown zone */
    }
  }
  if (consent) values.consentAt = new Date();
  if (fields.activities && !fields.primaryActivity && fields.activities.length === 1) values.primaryActivity = fields.activities[0];

  const before = await getProfile(user.id);
  if (complete) {
    if (!(before?.consentAt || consent)) return json({ error: "consent_required" }, 400);
    values.onboardedAt = before?.onboardedAt ?? new Date();
  }

  const d = await db();
  const [saved] = await d.update(schema.profiles).set(values).where(eq(schema.profiles.userId, user.id)).returning();
  if (!saved) return json({ error: "not_found" }, 404);

  // A finished profile is enough to start looking up their events in the background.
  if (saved.onboardedAt) {
    const persona = personaFor(saved);
    after(() => ensureEvents(saved, persona));
  }
  return json({ status: "saved" });
}
