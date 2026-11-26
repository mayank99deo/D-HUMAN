import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { aiMode } from "@/lib/ai/client";
import { isOwnerEmail } from "@/lib/auth/owners";
import { db, schema } from "@/lib/db";
import type { Profile } from "@/lib/db/schema";
import { CONSENT_VERSION, consentCurrent, newConsentLines } from "@/lib/domain/consent";
import type { MeView } from "@/lib/platform/views/me";

// The apps' "who am I" (lib/api/schemas.ts MeResponse), shaped from the web layout's own view
// (lib/platform/views/me.ts). Only the app routes import lib/api/views.

export type MeReports = { hold: "urgent" | "pregnant" | null; reportsVersion: string };

/**
 * What the apps need to know about the person's reports on every screen, in one parallel step:
 * - hold (G1): "urgent" while the newest read report has a result needing advice today (the
 *   Stack screen's rule, lib/platform/views/stack.ts), else "pregnant" from the profile, else
 *   null. Fuel and the Log bar drop their nudges while it stands.
 * - reportsVersion (G11): changes whenever any report is uploaded, read, retried or deleted, on
 *   any device, so the phone drops a cached Home and Stack that might hide a new urgent flag.
 *   A digest of the person's reports' ids, statuses and read times; it says nothing about them.
 */
export async function meReports(userId: string, profile: Pick<Profile, "conditions"> | null): Promise<MeReports> {
  const d = await db();
  const r = schema.reports;
  const newest = d.select({ id: r.id }).from(r).where(and(eq(r.userId, userId), eq(r.status, "ready"))).orderBy(desc(r.createdAt)).limit(1);
  const [rows, [urgent]] = await Promise.all([
    d.select({ id: r.id, status: r.status, analyzedAt: r.analyzedAt }).from(r).where(eq(r.userId, userId)).orderBy(r.id),
    d
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.markers)
      .where(and(eq(schema.markers.userId, userId), eq(schema.markers.flag, "urgent"), sql`${schema.markers.reportId} = (${newest})`)),
  ]);
  const digest = createHash("sha256")
    .update(rows.map((x) => `${x.id}:${x.status}:${x.analyzedAt?.toISOString() ?? ""}`).join("\n"))
    .digest()
    .subarray(0, 12)
    .toString("base64url");
  const hold = (urgent?.n ?? 0) > 0 ? "urgent" : profile?.conditions.includes("pregnant") ? "pregnant" : null;
  return { hold, reportsVersion: `${rows.length}.${digest}` };
}

/** GET /api/me's answer (lib/api/schemas.ts, MeResponse). Ask isn't in the apps (plan §2 row 5), so its gate isn't sent. */
export function meJson(v: MeView, reports: MeReports) {
  const p = v.profile;
  const at = p?.consentAt ?? null;
  return {
    id: v.user.id,
    email: v.user.email,
    onboarded: v.onboarded,
    consent: {
      at: at?.toISOString() ?? null,
      // The first agreement, kept when an app records agreement to newer wording (a DPDP record).
      firstAt: (p?.consentFirstAt ?? at)?.toISOString() ?? null,
      version: CONSENT_VERSION,
      current: consentCurrent(at),
      newLines: newConsentLines(at),
    },
    tourDone: !!p?.tourDoneAt,
    // G2: when the health question (conditions and medicines) was answered; a first stack waits for it.
    healthCheckedAt: p?.healthCheckedAt?.toISOString() ?? null,
    hold: reports.hold,
    reportsVersion: reports.reportsVersion,
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
