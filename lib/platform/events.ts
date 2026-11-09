import "server-only";
import { and, asc, eq, gte, ilike, isNull, or } from "drizzle-orm";
import { aiMode } from "@/lib/ai/client";
import { searchEvents } from "@/lib/ai/events";
import { mockEvents } from "@/lib/ai/mock";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import type { EventRow, Profile } from "@/lib/db/schema";
import type { Persona } from "@/lib/domain/persona";
import { localDate } from "./profile";

// Events are searched once per (activity, region, named event) and shared by
// everyone who matches, then refreshed weekly.
const FRESH_FOR = 7 * 24 * 60 * 60 * 1000;
const RETRY_FAILED_AFTER = 6 * 60 * 60 * 1000;

export const regionOf = (p: Profile) => (p.city?.trim() || p.country?.trim() || "India").toLowerCase();

export async function ensureEvents(profile: Profile, persona: Persona): Promise<void> {
  if (!persona.eventSearch || aiMode() === "off") return;
  const d = await db();
  const activity = persona.archetype;
  const region = regionOf(profile);
  const query = (profile.eventInMind ?? "").trim().toLowerCase();

  const [last] = await d
    .select()
    .from(schema.eventSearches)
    .where(and(eq(schema.eventSearches.activity, activity), eq(schema.eventSearches.region, region), eq(schema.eventSearches.query, query)))
    .limit(1);
  const age = last ? Date.now() - last.searchedAt.getTime() : Infinity;
  if (last?.status === "ok" && age < FRESH_FOR) return;
  if (last?.status === "failed" && age < RETRY_FAILED_AFTER) return;
  if (last?.status === "running" && age < 5 * 60 * 1000) return;

  const mark = (status: string) =>
    d
      .insert(schema.eventSearches)
      .values({ activity, region, query, status, searchedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.eventSearches.activity, schema.eventSearches.region, schema.eventSearches.query],
        set: { status, searchedAt: new Date() },
      });

  await mark("running");
  try {
    const found =
      aiMode() === "mock"
        ? await mockEvents(persona.eventSearch, profile.city)
        : await searchEvents({
            what: persona.eventSearch,
            city: profile.city,
            country: profile.country,
            named: profile.eventInMind,
            today: localDate(profile.timezone),
          });
    for (const e of found.events) {
      await d
        .insert(schema.events)
        .values({
          id: newId(),
          activity,
          region,
          name: e.name.trim(),
          kind: e.kind,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
          city: e.city,
          country: e.country,
          url: e.url,
          details: e.details,
        })
        .onConflictDoUpdate({
          target: [schema.events.activity, schema.events.region, schema.events.name, schema.events.startsOn],
          set: { url: e.url, details: e.details, city: e.city, endsOn: e.ends_on, fetchedAt: new Date() },
        });
    }
    await mark("ok");
  } catch (error) {
    console.error("[events] Search failed:", error);
    await mark("failed");
  }
}

export async function upcomingEvents(profile: Profile, persona: Persona, limit = 6): Promise<EventRow[]> {
  const d = await db();
  const today = localDate(profile.timezone);
  return d
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.activity, persona.archetype),
        eq(schema.events.region, regionOf(profile)),
        or(gte(schema.events.startsOn, today), isNull(schema.events.startsOn)),
      ),
    )
    .orderBy(asc(schema.events.startsOn))
    .limit(limit);
}

// Upcoming events, the one they picked and the one the verdict aims at, in one go:
// the picked one, else the one they named, else the soonest.
export async function eventsFor(userId: string, profile: Profile, persona: Persona) {
  const d = await db();
  const today = localDate(profile.timezone);
  const [pickedRows, upcoming] = await Promise.all([
    d
      .select({ e: schema.events })
      .from(schema.userEvents)
      .innerJoin(schema.events, eq(schema.events.id, schema.userEvents.eventId))
      .where(and(eq(schema.userEvents.userId, userId), eq(schema.userEvents.target, true), or(gte(schema.events.startsOn, today), isNull(schema.events.startsOn))))
      .limit(1),
    upcomingEvents(profile, persona, 12),
  ]);
  const picked = pickedRows[0]?.e ?? null;
  let target: EventRow | null = picked;
  const named = profile.eventInMind?.trim();
  if (!target && named) {
    const words = named.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    target =
      upcoming.find((e) => words.every((w) => e.name.toLowerCase().includes(w))) ??
      upcoming.find((e) => words.some((w) => e.name.toLowerCase().includes(w))) ??
      null;
  }
  target ??= upcoming.find((e) => e.startsOn) ?? null;
  return { target, upcoming: upcoming.slice(0, 6), pickedId: picked?.id ?? null };
}

export async function targetEvent(userId: string, profile: Profile, persona: Persona): Promise<EventRow | null> {
  return (await eventsFor(userId, profile, persona)).target;
}

export async function pickTargetEvent(userId: string, eventId: string | null) {
  const d = await db();
  await d.delete(schema.userEvents).where(eq(schema.userEvents.userId, userId));
  if (eventId) await d.insert(schema.userEvents).values({ userId, eventId, target: true });
}

export async function findEventByName(name: string) {
  const d = await db();
  return d.select().from(schema.events).where(ilike(schema.events.name, `%${name}%`)).limit(5);
}
