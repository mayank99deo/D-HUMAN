import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { aiMode } from "@/lib/ai/client";
import { searchEvents } from "@/lib/ai/events";
import { mockEvents } from "@/lib/ai/mock";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import type { EventRow, Profile } from "@/lib/db/schema";
import type { Persona } from "@/lib/domain/persona";
import { regionKey } from "@/lib/domain/region";
import { localDate } from "./profile";

// Events are searched once per (activity, region, named event), then refreshed
// weekly. A plain search (no named event) is shared by everyone in the region.
// A search for an event someone typed keeps its query on each row, and only people
// who typed the same thing see those rows: one person's typed text never puts
// events on someone else's dashboard or into their read.
// Shared searches are refreshed every two weeks; events don't move faster than that.
const FRESH_FOR = 14 * 24 * 60 * 60 * 1000;
const RETRY_FAILED_AFTER = 6 * 60 * 60 * 1000;

export const regionOf = (p: Profile) => regionKey(p.city, p.country);
export const eventQueryOf = (p: Pick<Profile, "eventInMind">) => (p.eventInMind ?? "").trim().toLowerCase();

// The rows this person may see: shared ones, plus their own named search's.
const visibleTo = (p: Profile) => {
  const query = eventQueryOf(p);
  return query ? inArray(schema.events.query, ["", query]) : eq(schema.events.query, "");
};

export async function ensureEvents(profile: Profile, persona: Persona): Promise<void> {
  if (!persona.eventSearch || aiMode() === "off") return;
  const d = await db();
  const activity = persona.archetype;
  const region = regionOf(profile);
  const query = eventQueryOf(profile);

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
    // One upsert for the lot. A row can't be updated twice in one statement, so
    // repeats in the answer (same name and date) are dropped first.
    const rows = new Map<string, typeof schema.events.$inferInsert>();
    for (const e of found.events) {
      const name = e.name.trim();
      rows.set(`${name}\u0000${e.starts_on ?? ""}`, {
        id: newId(),
        activity,
        region,
        query,
        name,
        kind: e.kind,
        startsOn: e.starts_on,
        endsOn: e.ends_on,
        city: e.city,
        country: e.country,
        url: e.url,
        details: e.details,
      });
    }
    if (rows.size) {
      await d
        .insert(schema.events)
        .values([...rows.values()])
        .onConflictDoUpdate({
          // Matches the events_unique key, which treats a missing date as a value.
          target: [schema.events.activity, schema.events.region, schema.events.query, schema.events.name, schema.events.startsOn],
          set: {
            kind: sql`excluded.kind`,
            endsOn: sql`excluded.ends_on`,
            city: sql`excluded.city`,
            country: sql`excluded.country`,
            url: sql`excluded.url`,
            details: sql`excluded.details`,
            fetchedAt: new Date(),
          },
        });
    }
    await mark("ok");
  } catch (error) {
    console.error("[events] Search failed:", error);
    await mark("failed");
  }
}

// A named search and the shared one often find the same event: show it once,
// as the copy they picked when there is one, else their own search's.
const sameEvent = (e: EventRow) => `${e.name.toLowerCase()}\u0000${e.startsOn ?? ""}`;
function onePerEvent(rows: EventRow[], prefer?: EventRow | null): EventRow[] {
  const byEvent = new Map<string, EventRow>();
  for (const e of rows) if (!byEvent.has(sameEvent(e))) byEvent.set(sameEvent(e), e);
  if (prefer && byEvent.has(sameEvent(prefer))) byEvent.set(sameEvent(prefer), prefer);
  return [...byEvent.values()];
}

export async function upcomingEvents(profile: Profile, persona: Persona, limit = 6): Promise<EventRow[]> {
  const d = await db();
  const today = localDate(profile.timezone);
  const rows = await d
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.activity, persona.archetype),
        eq(schema.events.region, regionOf(profile)),
        visibleTo(profile),
        or(gte(schema.events.startsOn, today), isNull(schema.events.startsOn)),
      ),
    )
    // Their own search's copy (a non-empty query) sorts ahead of the shared one.
    .orderBy(asc(schema.events.startsOn), desc(schema.events.query))
    .limit(limit * 2);
  return onePerEvent(rows).slice(0, limit);
}

// Upcoming events, the one they picked and the one the verdict aims at, in one go:
// the picked one, else the one they named, else the soonest.
export async function eventsFor(userId: string, profile: Profile, persona: Persona) {
  const d = await db();
  const today = localDate(profile.timezone);
  const [pickedRows, found] = await Promise.all([
    d
      .select({ e: schema.events })
      .from(schema.userEvents)
      .innerJoin(schema.events, eq(schema.events.id, schema.userEvents.eventId))
      .where(and(eq(schema.userEvents.userId, userId), eq(schema.userEvents.target, true), or(gte(schema.events.startsOn, today), isNull(schema.events.startsOn))))
      .limit(1),
    upcomingEvents(profile, persona, 12),
  ]);
  const picked = pickedRows[0]?.e ?? null;
  const upcoming = onePerEvent(found, picked);
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

// Sets (or, with null, clears) the event someone aims at. Only an event they can
// see may be picked; anything else returns false and keeps the old pick.
export async function pickTargetEvent(userId: string, eventId: string | null): Promise<boolean> {
  const d = await db();
  if (eventId) {
    const [found] = await d
      .select({ query: schema.events.query, eventInMind: schema.profiles.eventInMind })
      .from(schema.events)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, userId))
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!found || (found.query !== "" && found.query !== eventQueryOf(found))) return false;
  }
  // Clearing the old pick and saving the new one happen together.
  await d.transaction(async (tx) => {
    await tx.delete(schema.userEvents).where(eq(schema.userEvents.userId, userId));
    if (eventId) await tx.insert(schema.userEvents).values({ userId, eventId, target: true });
  });
  return true;
}
