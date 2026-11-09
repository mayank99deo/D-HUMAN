import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/lib/db";
import type { Profile } from "@/lib/db/schema";
import { personaOf } from "@/lib/domain/persona";

export const getProfile = cache(async (userId: string): Promise<Profile | null> => {
  const d = await db();
  const [row] = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).limit(1);
  return row ?? null;
});

export const personaFor = (p: Profile) =>
  personaOf({
    name: p.name,
    birthYear: p.birthYear,
    primaryActivity: p.primaryActivity,
    activities: p.activities,
    level: p.level,
    goals: p.goals,
  });

// Calendar day in the person's own timezone, as YYYY-MM-DD.
export function localDate(tz: string | null | undefined, at = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Kolkata" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
  }
}

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
