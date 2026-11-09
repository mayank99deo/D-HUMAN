import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Read } from "@/lib/ai/schemas";
import { db, schema } from "@/lib/db";
import type { EventRow, Marker, Profile } from "@/lib/db/schema";
import type { Persona } from "@/lib/domain/persona";
import { targetsFor } from "@/lib/domain/nutrition";
import { eventsFor } from "./events";
import { logsBetween, totalsOf } from "./food";
import { daysBetween, localDate } from "./profile";
import { latestStack } from "./stack";

export type ReportView = {
  id: string;
  labName: string | null;
  collectedOn: string | null;
  createdAt: Date;
  nameOnReport: string | null;
  model: string | null;
  read: Read;
  markers: Marker[];
};

export async function reportView(userId: string, reportId: string): Promise<ReportView | null> {
  const d = await db();
  // Both scoped to the user, so they can run side by side.
  const [[row], markers] = await Promise.all([
    d
      .select({ r: schema.reports, a: schema.analyses })
      .from(schema.reports)
      .innerJoin(schema.analyses, eq(schema.analyses.reportId, schema.reports.id))
      .where(and(eq(schema.reports.id, reportId), eq(schema.reports.userId, userId)))
      .limit(1),
    d
      .select()
      .from(schema.markers)
      .where(and(eq(schema.markers.reportId, reportId), eq(schema.markers.userId, userId)))
      .orderBy(schema.markers.position),
  ]);
  if (!row) return null;
  return {
    id: row.r.id,
    labName: row.r.labName,
    collectedOn: row.r.collectedOn,
    createdAt: row.r.createdAt,
    nameOnReport: row.r.nameOnReport,
    model: row.r.model,
    read: row.a.read as Read,
    markers,
  };
}

export async function dashboard(userId: string, profile: Profile, persona: Persona) {
  const d = await db();
  const today = localDate(profile.timezone);

  // Everything that doesn't depend on another query runs at once.
  const [reports, events, todayLogs, stack] = await Promise.all([
    d
      .select({ id: schema.reports.id, status: schema.reports.status, createdAt: schema.reports.createdAt, collectedOn: schema.reports.collectedOn, error: schema.reports.error })
      .from(schema.reports)
      .where(eq(schema.reports.userId, userId))
      .orderBy(desc(schema.reports.createdAt))
      .limit(12),
    eventsFor(userId, profile, persona),
    logsBetween(userId, today, today),
    latestStack(userId),
  ]);

  const ready = reports.filter((r) => r.status === "ready");
  const latestReady = ready[0];
  const previous = ready[1];
  const inProgress = reports.find((r) => r.status === "reading" || r.status === "interpreting" || r.status === "uploaded");

  // Then the latest read and the previous report's values (to show which way each marker moved), together.
  const [view, prevMarkers] = await Promise.all([
    latestReady ? reportView(userId, latestReady.id) : Promise.resolve(null),
    previous
      ? d
          .select({ key: schema.markers.key, value: schema.markers.value })
          .from(schema.markers)
          .where(and(eq(schema.markers.reportId, previous.id), eq(schema.markers.userId, userId)))
      : Promise.resolve([]),
  ]);

  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  const target = events.target;

  return {
    view,
    inProgress: inProgress ?? null,
    lastFailed: reports[0]?.status === "failed" ? reports[0] : null,
    reportCount: ready.length,
    prev: new Map(prevMarkers.filter((m) => m.key && m.value != null).map((m) => [m.key as string, m.value as number])),
    target,
    daysToTarget: target?.startsOn ? daysBetween(today, target.startsOn) : null,
    upcoming: events.upcoming,
    pickedId: events.pickedId,
    today: { totals: totalsOf(todayLogs), meals: todayLogs.length, targets },
    stack,
  };
}

export async function eventsByIds(ids: string[]): Promise<EventRow[]> {
  if (!ids.length) return [];
  const d = await db();
  return d.select().from(schema.events).where(inArray(schema.events.id, ids));
}
