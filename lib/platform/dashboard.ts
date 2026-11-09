import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Read } from "@/lib/ai/schemas";
import { db, schema } from "@/lib/db";
import type { EventRow, Marker, Profile } from "@/lib/db/schema";
import type { Persona } from "@/lib/domain/persona";
import { targetsFor } from "@/lib/domain/nutrition";
import { targetEvent, upcomingEvents } from "./events";
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
  const [row] = await d
    .select({ r: schema.reports, a: schema.analyses })
    .from(schema.reports)
    .innerJoin(schema.analyses, eq(schema.analyses.reportId, schema.reports.id))
    .where(and(eq(schema.reports.id, reportId), eq(schema.reports.userId, userId)))
    .limit(1);
  if (!row) return null;
  const markers = await d.select().from(schema.markers).where(eq(schema.markers.reportId, reportId)).orderBy(schema.markers.position);
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
  const reports = await d
    .select({ id: schema.reports.id, status: schema.reports.status, createdAt: schema.reports.createdAt, collectedOn: schema.reports.collectedOn, error: schema.reports.error })
    .from(schema.reports)
    .where(eq(schema.reports.userId, userId))
    .orderBy(desc(schema.reports.createdAt))
    .limit(12);
  const latestReady = reports.find((r) => r.status === "ready");
  const inProgress = reports.find((r) => r.status === "reading" || r.status === "interpreting" || r.status === "uploaded");
  const view = latestReady ? await reportView(userId, latestReady.id) : null;

  // The previous report's values, to show which way each marker moved.
  const previous = reports.filter((r) => r.status === "ready")[1];
  const prevMarkers = previous
    ? await d.select({ key: schema.markers.key, value: schema.markers.value }).from(schema.markers).where(eq(schema.markers.reportId, previous.id))
    : [];

  const today = localDate(profile.timezone);
  const [target, upcoming] = await Promise.all([targetEvent(userId, profile, persona), upcomingEvents(profile, persona, 6)]);
  const todayLogs = await logsBetween(userId, today, today);
  const targets = targetsFor({
    sex: profile.sex, age: persona.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
    level: profile.level, archetype: persona.archetype, goals: profile.goals,
  });
  const stack = await latestStack(userId);

  let pickedId: string | null = null;
  const picked = await d.select({ eventId: schema.userEvents.eventId }).from(schema.userEvents).where(eq(schema.userEvents.userId, userId)).limit(1);
  if (picked[0]) pickedId = picked[0].eventId;

  return {
    view,
    inProgress: inProgress ?? null,
    lastFailed: reports[0]?.status === "failed" ? reports[0] : null,
    reportCount: reports.filter((r) => r.status === "ready").length,
    prev: new Map(prevMarkers.filter((m) => m.key && m.value != null).map((m) => [m.key as string, m.value as number])),
    target,
    daysToTarget: target?.startsOn ? daysBetween(today, target.startsOn) : null,
    upcoming,
    pickedId,
    today: { totals: totalsOf(todayLogs), meals: todayLogs.length, targets },
    stack,
  };
}

export async function eventsByIds(ids: string[]): Promise<EventRow[]> {
  if (!ids.length) return [];
  const d = await db();
  return d.select().from(schema.events).where(inArray(schema.events.id, ids));
}
