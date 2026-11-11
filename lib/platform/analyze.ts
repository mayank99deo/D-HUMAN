import "server-only";
import { and, asc, count, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { AiRefusalError, AiUnavailableError, aiMode } from "@/lib/ai/client";
import { mockExtract, mockRead } from "@/lib/ai/mock";
import { extractReport, interpretReport, type ReadInput } from "@/lib/ai/report";
import type { Extracted, Read } from "@/lib/ai/schemas";
import { newId } from "@/lib/auth/crypto";
import { db, schema, type Db } from "@/lib/db";
import { deriveMarkers } from "@/lib/domain/derived";
import { differentialKey, flagFor, markerDef, matchMarkerKey, sameUnit, statusFor, typicalRange, unitKnown, type Sex } from "@/lib/domain/markers";
import { labelOf, ACTIVITIES, GOALS, LEVELS, DIETS, CONDITIONS } from "@/lib/domain/options";
import type { Refusal } from "@/lib/domain/plan";
import { asFlag, floorVerdict, keepMostSevere } from "@/lib/domain/safety";
import { ensureEvents, targetEvent } from "./events";
import { dietPicture, dietText } from "./food";
import { claimUseIn, releaseUseIn } from "./plan";
import { daysBetween, getProfile, localDate, personaFor } from "./profile";

export type Progress =
  | { type: "stage"; stage: "reading" | "matching" | "weighing" | "writing" }
  | { type: "marker"; name: string }
  | { type: "done"; reportId: string }
  | { type: "error"; message: string };

// A report is read by one run at a time. A run claims the report by stamping
// `started_at`, and every later write checks that stamp and a running status,
// so a run that timed out or was taken over can't overwrite anything.
const RUNNING = ["reading", "interpreting"];
/** A read still "running" after this long has died (crash, deploy, killed function) and may be retried. */
export const STALE_AFTER_MS = 15 * 60_000;
/** Give up before the routes' 300 s limit, so a slow read ends as "failed", never stuck. */
const DEADLINE_MS = 280_000;
/** Paid reads per person per 24 hours, counted in the database so every server agrees. */
export const DAILY_READS = 10;
const DAY_MS = 24 * 60 * 60_000;

export const READ_MESSAGES = {
  busy: "This report is being read right now. Give it a minute.",
  daily_limit: `You've had ${DAILY_READS} reports read in the last 24 hours, the most we allow for now. Try again tomorrow.`,
  stale: "This read stopped partway. Your file is saved; try again.",
};

export type Claim =
  | { ok: true; startedAt: Date }
  | { ok: false; reason: "not_found" | "busy" | "daily_limit" | "already_read" }
  | { ok: false; reason: "plan_limit"; refusal: Refusal };

// Rolls back a claim transaction (and the use it recorded) when the report was taken first.
class ClaimLost extends Error {}

export const isStale = (startedAt: Date | null, now = Date.now()) => !startedAt || now - startedAt.getTime() > STALE_AFTER_MS;
export const isRunning = (r: { status: string; startedAt: Date | null }) => RUNNING.includes(r.status) && !isStale(r.startedAt);

// Reports whose read started in the last 24 hours. A retry of the same report counts once.
async function readsInLastDay(q: Db, userId: string, except?: string): Promise<number> {
  const since = new Date(Date.now() - DAY_MS);
  const [row] = await q
    .select({ n: count() })
    .from(schema.reports)
    .where(and(eq(schema.reports.userId, userId), gte(schema.reports.startedAt, since), except ? ne(schema.reports.id, except) : undefined));
  return row?.n ?? 0;
}

/** A quick check before an upload is stored; claimReport checks again, atomically. */
export async function readLimitReached(userId: string): Promise<boolean> {
  return (await readsInLastDay(await db(), userId)) >= DAILY_READS;
}

/**
 * Claims a report for one read. Refuses while a fresh read runs (so two quick
 * taps start one read), allows a stale one to be taken over, and enforces the
 * daily cap and the plan's allowance, recording the read as a use (released
 * again if the read fails). Runs under a per-person lock so parallel claims can't both pass.
 */
export async function claimReport(reportId: string, userId: string): Promise<Claim> {
  const d = await db();
  return d.transaction(async (tx): Promise<Claim> => {
    await readsLock(tx, userId);
    // Reads that died count for nothing, and free their report for a retry.
    await failReads(tx, and(eq(schema.reports.userId, userId), staleRunning(new Date(Date.now() - STALE_AFTER_MS))), READ_MESSAGES.stale);
    const owned = and(eq(schema.reports.id, reportId), eq(schema.reports.userId, userId));
    const [r] = await tx.select({ status: schema.reports.status, startedAt: schema.reports.startedAt }).from(schema.reports).where(owned).limit(1);
    if (!r) return { ok: false, reason: "not_found" } as const;
    if (isRunning(r)) return { ok: false, reason: "busy" } as const;
    // A finished read isn't read again; that would be a free extra read.
    if (r.status === "ready") return { ok: false, reason: "already_read" } as const;
    if ((await readsInLastDay(tx, userId, reportId)) >= DAILY_READS) return { ok: false, reason: "daily_limit" } as const;
    // Free and paid allowances (lib/domain/plan.ts).
    const refusal = await claimUseIn(tx, userId, "read", reportId, localDate(null));
    if (refusal) return { ok: false, reason: "plan_limit", refusal } as const;

    const startedAt = new Date();
    const cutoff = new Date(startedAt.getTime() - STALE_AFTER_MS);
    const [won] = await tx
      .update(schema.reports)
      .set({ status: "reading", stage: "reading", error: null, startedAt })
      .where(and(owned, or(notInArray(schema.reports.status, RUNNING), isNull(schema.reports.startedAt), lt(schema.reports.startedAt, cutoff))))
      .returning({ id: schema.reports.id });
    if (!won) throw new ClaimLost();
    return { ok: true, startedAt } as const;
  }).catch((error: unknown): Claim => {
    if (error instanceof ClaimLost) return { ok: false, reason: "busy" };
    throw error;
  });
}

const readsLock = (tx: Db, userId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`reads:${userId}`}))`);
const staleRunning = (cutoff: Date) => and(inArray(schema.reports.status, RUNNING), or(isNull(schema.reports.startedAt), lt(schema.reports.startedAt, cutoff)));

/**
 * Marks reads as failed and hands their uses back, in one transaction under the
 * same lock as claimReport, and only for reports the update actually changed. So
 * a retry can never reuse a use that is about to be handed back.
 */
async function failReads(tx: Db, where: SQL | undefined, message: string): Promise<string[]> {
  const rows = await tx.update(schema.reports).set({ status: "failed", stage: null, error: message }).where(where).returning({ id: schema.reports.id });
  const ids = rows.map((r) => r.id);
  await releaseUseIn(tx, "read", ids);
  return ids;
}

/** Marks a read that died partway as failed, so screens stop showing "reading". True if it did. */
export async function settleStaleRead(reportId: string, userId: string): Promise<boolean> {
  const d = await db();
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  return d.transaction(async (tx) => {
    await readsLock(tx, userId);
    const ids = await failReads(tx, and(eq(schema.reports.id, reportId), eq(schema.reports.userId, userId), staleRunning(cutoff)), READ_MESSAGES.stale);
    return ids.length > 0;
  });
}

/** Settles every read of this person's that died, so a dead read never counts against their plan. */
export async function settleStaleReads(userId: string): Promise<number> {
  const d = await db();
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  return d.transaction(async (tx) => {
    await readsLock(tx, userId);
    return (await failReads(tx, and(eq(schema.reports.userId, userId), staleRunning(cutoff)), READ_MESSAGES.stale)).length;
  });
}

class FriendlyError extends Error {}
class LostClaimError extends Error {}
class DeadlineError extends Error {}

const fmt = (n: number | null | undefined) => (n == null ? "" : Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

// Waits for a job, but no longer than `ms`.
const within = (job: Promise<unknown>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([job, new Promise((r) => (timer = setTimeout(r, ms)))]).finally(() => clearTimeout(timer));
};

type MarkerRow = typeof schema.markers.$inferInsert;
const displayName = (r: MarkerRow) => markerDef(r.key)?.name ?? r.name;

// A marker with doctor or urgent limits whose unit we can't convert: its flag couldn't be checked.
function isUnchecked(r: MarkerRow): boolean {
  const def = markerDef(r.key);
  return !!def && !!(def.doctor || def.urgent) && r.value != null && !unitKnown(def, r.unit);
}

function toRows(x: Extracted, reportId: string, userId: string, sex: Sex): MarkerRow[] {
  const rows = x.markers.map((m, i): MarkerRow => {
    // A white-cell differential is a count or a percentage; its unit decides which.
    const key = differentialKey(m.key !== "other" ? m.key : matchMarkerKey(m.printed_name) ?? null, m.unit) ?? null;
    const def = markerDef(key);
    let low = m.ref_low;
    let high = m.ref_high;
    let rangeSource = "report";
    if (low == null && high == null) {
      const typical = def && sameUnit(def, m.unit) ? typicalRange(def, sex) : undefined;
      low = typical?.low ?? null;
      high = typical?.high ?? null;
      rangeSource = typical ? "catalog" : "none";
    }
    return {
      id: newId(),
      reportId,
      userId,
      key,
      name: m.printed_name,
      panel: m.panel,
      value: m.value,
      valueText: m.value_text,
      unit: m.unit,
      refLow: low,
      refHigh: high,
      refText: m.ref_text,
      rangeSource,
      status: statusFor(m.value, low, high),
      flag: flagFor(def, m.value, m.unit, sex),
      position: i,
    };
  });
  // A marker printed twice keeps its worst reading, so a healthy-looking copy can't hide a flag.
  const kept = keepMostSevere(rows);
  // Ratios the report didn't print are worked out in code, against the catalogue's typical range.
  const next = Math.max(-1, ...kept.map((r) => r.position ?? 0)) + 1;
  const derived = deriveMarkers(kept.map((r) => ({ key: r.key, value: r.value ?? null, unit: r.unit ?? null }))).flatMap((dv, i): MarkerRow[] => {
    const def = markerDef(dv.key);
    if (!def) return [];
    const typical = typicalRange(def, sex);
    return [{
      id: newId(),
      reportId,
      userId,
      key: dv.key,
      name: def.name,
      panel: def.panel,
      value: dv.value,
      valueText: null,
      unit: dv.unit,
      refLow: typical?.low ?? null,
      refHigh: typical?.high ?? null,
      refText: null,
      rangeSource: "derived",
      status: statusFor(dv.value, typical?.low, typical?.high),
      flag: flagFor(def, dv.value, dv.unit, sex),
      position: next + i,
    }];
  });
  return [...kept, ...derived];
}

/** Reads a report the caller has claimed (see claimReport). Always ends ready or failed. */
export async function runAnalysis(reportId: string, userId: string, startedAt: Date, emit: (p: Progress) => void): Promise<void> {
  const d = await db();
  // This run's writes land only while it still owns the report.
  const mine = and(eq(schema.reports.id, reportId), eq(schema.reports.startedAt, startedAt), inArray(schema.reports.status, RUNNING));
  let step: "extract" | "read" = "extract";

  // Seconds spent in each step, logged at the end so slow reads can be traced.
  const times: Record<string, number> = {};
  let mark = startedAt.getTime();
  const lap = (name: string) => {
    const now = Date.now();
    times[name] = +((now - mark) / 1000).toFixed(1);
    mark = now;
  };

  const work = async () => {
    const mode = aiMode();
    if (mode === "off") throw new AiUnavailableError();
    const profile = await getProfile(userId);
    if (!profile) throw new FriendlyError("Finish your profile first.");
    const persona = personaFor(profile);

    // Look up events while the report is being read; the verdict may need them later.
    const eventsJob = ensureEvents(profile, persona).catch((error) => console.error("[events]", error));

    emit({ type: "stage", stage: "reading" });
    const files = await d
      .select({ mime: schema.reportFiles.mime, bytes: schema.reportFiles.bytes })
      .from(schema.reportFiles)
      .where(eq(schema.reportFiles.reportId, reportId))
      .orderBy(asc(schema.reportFiles.position));
    if (!files.length) throw new FriendlyError("We couldn't find the uploaded file. Try uploading again.");

    const onFound = (name: string) => emit({ type: "marker", name });
    const extracted = mode === "mock" ? await mockExtract(onFound) : await extractReport(files, onFound);
    lap("extract");
    const x = extracted.data;
    if (!x.is_lab_report || x.markers.length === 0) {
      throw new FriendlyError("That doesn't look like a lab report we can read. Try a clearer photo or the PDF from your lab.");
    }

    emit({ type: "stage", stage: "matching" });
    const sex = (profile.sex ?? x.sex_on_report) as Sex;
    const rows = toRows(x, reportId, userId, sex);
    const collectedOn = x.collected_on && /^\d{4}-\d{2}-\d{2}$/.test(x.collected_on) ? x.collected_on : null;
    const [moved] = await d
      .update(schema.reports)
      .set({ status: "interpreting", stage: "weighing", labName: x.lab_name, collectedOn, nameOnReport: x.name_on_report })
      .where(mine)
      .returning({ id: schema.reports.id });
    if (!moved) throw new LostClaimError();

    emit({ type: "stage", stage: "weighing" });
    step = "read";
    // Wait for a slow event search only when there's no target event to aim at yet.
    let event = await targetEvent(userId, profile, persona);
    if (!event && persona.eventSearch) {
      await within(eventsJob, 8_000);
      lap("events_wait");
      event = await targetEvent(userId, profile, persona);
    }
    const today = localDate(profile.timezone);
    const diet = dietText(await dietPicture(userId, profile));

    const rank = new Map(persona.priorities.map((k, i) => [k, i + 1]));
    const shortIds = new Map<string, string>();
    const input: ReadInput = {
      person: {
        firstName: persona.firstName,
        age: persona.age,
        sex: profile.sex,
        persona: persona.label,
        activities: profile.activities.map((a) => labelOf(ACTIVITIES, a)),
        level: labelOf(LEVELS, persona.level),
        sessionsPerWeek: profile.sessionsPerWeek,
        goals: profile.goals.map((g) => labelOf(GOALS, g)),
        diet: profile.diet ? labelOf(DIETS, profile.diet) : null,
        conditions: profile.conditions.map((c) => labelOf(CONDITIONS, c)),
        medications: profile.medications,
        currentSupplements: profile.currentSupplements,
        city: profile.city,
        language: profile.language,
      },
      target: event
        ? { kind: "event", name: event.name, date: event.startsOn, daysAway: event.startsOn ? daysBetween(today, event.startsOn) : null, city: event.city }
        : { kind: "retest" },
      markers: rows.map((r, i) => {
        const id = `m${i + 1}`;
        shortIds.set(id, r.id);
        const unchecked = isUnchecked(r);
        return {
          id,
          name: r.name,
          key: r.key ?? null,
          value: r.value != null ? fmt(r.value) : r.valueText ?? "",
          unit: r.unit ?? null,
          range: r.refLow != null && r.refHigh != null ? `${fmt(r.refLow)}–${fmt(r.refHigh)}` : r.refLow != null ? `above ${fmt(r.refLow)}` : r.refHigh != null ? `below ${fmt(r.refHigh)}` : r.refText || "none printed",
          rangeSource: r.rangeSource ?? "none",
          status: r.status,
          flag: r.flag ?? null,
          unchecked,
          priority: r.key ? rank.get(r.key) ?? null : null,
          // Notes only where they add something: off or at the edge of range, flagged or unchecked, or near the top for this persona.
          note: (r.status !== "in_range" && r.status !== "unknown") || !!r.flag || unchecked || (!!r.key && (rank.get(r.key) ?? 99) <= 8),
        };
      }),
      diet,
      labName: x.lab_name,
      collectedOn,
    };

    emit({ type: "stage", stage: "writing" });
    const interpreted = mode === "mock" ? await mockRead(input) : await interpretReport(input);
    lap("read");
    const read: Read = interpreted.data;
    // Safety floor (lib/domain/safety.ts): a flag means "Doctor first" in fixed words; an unchecked unit rules out "go".
    read.verdict = floorVerdict(read.verdict, {
      markers: rows.map((r) => ({ key: r.key ?? null, name: displayName(r), status: r.status, flag: asFlag(r.flag) })),
      unchecked: rows.filter(isUnchecked).map(displayName),
      eventName: event ? event.name.slice(0, 80) : null,
    });
    read.markers = read.markers.map((m) => ({ ...m, id: shortIds.get(m.id) ?? m.id }));

    // Markers, read and status change together, or not at all.
    await d.transaction(async (tx) => {
      const [done] = await tx
        .update(schema.reports)
        .set({ status: "ready", stage: null, analyzedAt: new Date(), model: interpreted.model })
        .where(mine)
        .returning({ id: schema.reports.id });
      if (!done) throw new LostClaimError();
      await tx.delete(schema.markers).where(eq(schema.markers.reportId, reportId));
      await tx.insert(schema.markers).values(rows);
      await tx
        .insert(schema.analyses)
        .values({ reportId, userId, read, eventId: event?.id ?? null })
        .onConflictDoUpdate({ target: schema.analyses.reportId, set: { read, eventId: event?.id ?? null, createdAt: new Date() } });
    });
    emit({ type: "done", reportId });
    console.info(`[analyze] ${reportId} ready in ${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)}s`, { ...times, markers: rows.length, model: interpreted.model });
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError("Read took too long")), DEADLINE_MS);
  });
  try {
    await Promise.race([work(), deadline]);
  } catch (error) {
    if (error instanceof LostClaimError) {
      // Another run owns this report now (this one went stale); leave its status alone.
      console.warn(`[analyze] ${reportId} was taken over by a newer read`);
      emit({ type: "error", message: READ_MESSAGES.busy });
      return;
    }
    console.error("[analyze]", error);
    const message = failureMessage(error, step);
    // Failed and handed back together, only if this run still owns the read (a read that
    // finished as the deadline hit, or was taken over, keeps its status and its use).
    await d
      .transaction(async (tx) => {
        await readsLock(tx, userId);
        await failReads(tx, mine, message);
      })
      .catch((e) => console.error("[analyze] Couldn't mark the read failed; it will be settled as stale.", e));
    emit({ type: "error", message });
  } finally {
    clearTimeout(timer);
  }
}

function failureMessage(error: unknown, step: "extract" | "read"): string {
  if (error instanceof FriendlyError) return error.message;
  if (error instanceof AiUnavailableError) return "Report reading isn't switched on yet. We've kept your file; try again soon.";
  if (error instanceof DeadlineError) return "Reading this report took too long, so we stopped. Your file is saved; try again.";
  if (error instanceof AiRefusalError) {
    return step === "extract"
      ? "Our AI wouldn't read this file. If it's a lab report, upload the PDF your lab sent instead."
      : "Our AI wouldn't write a read for this report. Your file is saved; try again later.";
  }
  return "Something went wrong while reading your report. Your file is saved; try again.";
}
