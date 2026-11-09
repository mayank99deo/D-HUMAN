import "server-only";
import { asc, eq } from "drizzle-orm";
import { AiRefusalError, AiUnavailableError, aiMode } from "@/lib/ai/client";
import { mockExtract, mockRead } from "@/lib/ai/mock";
import { extractReport, interpretReport, type ReadInput } from "@/lib/ai/report";
import type { Read } from "@/lib/ai/schemas";
import { newId } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { flagFor, markerDef, matchMarkerKey, sameUnit, statusFor, typicalRange, type Sex } from "@/lib/domain/markers";
import { labelOf, ACTIVITIES, GOALS, LEVELS, DIETS, CONDITIONS } from "@/lib/domain/options";
import { ensureEvents, targetEvent } from "./events";
import { dietPicture, dietText } from "./food";
import { daysBetween, getProfile, localDate, personaFor } from "./profile";

export type Progress =
  | { type: "stage"; stage: "reading" | "matching" | "weighing" | "writing" }
  | { type: "marker"; name: string }
  | { type: "done"; reportId: string }
  | { type: "error"; message: string };

class FriendlyError extends Error {}

const fmt = (n: number | null | undefined) => (n == null ? "" : Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

export async function runAnalysis(reportId: string, userId: string, emit: (p: Progress) => void): Promise<void> {
  const d = await db();
  const setReport = (values: Partial<typeof schema.reports.$inferInsert>) =>
    d.update(schema.reports).set(values).where(eq(schema.reports.id, reportId));

  // Seconds spent in each step, logged at the end so slow reads can be traced.
  const started = Date.now();
  const times: Record<string, number> = {};
  let mark = started;
  const lap = (name: string) => {
    const now = Date.now();
    times[name] = +((now - mark) / 1000).toFixed(1);
    mark = now;
  };

  try {
    const mode = aiMode();
    if (mode === "off") throw new AiUnavailableError();
    const profile = await getProfile(userId);
    if (!profile) throw new FriendlyError("Finish your profile first.");
    const persona = personaFor(profile);

    // Look up events while the report is being read; the verdict needs them later.
    const eventsJob = ensureEvents(profile, persona).catch((error) => console.error("[events]", error));

    emit({ type: "stage", stage: "reading" });
    await setReport({ status: "reading", stage: "reading", error: null });
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
    const seenKeys = new Set<string>();
    const rows: (typeof schema.markers.$inferInsert)[] = [];
    x.markers.forEach((m, i) => {
      const key = m.key !== "other" ? m.key : matchMarkerKey(m.printed_name) ?? null;
      if (key) {
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
      }
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
      rows.push({
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
      });
    });
    await d.delete(schema.markers).where(eq(schema.markers.reportId, reportId));
    await d.insert(schema.markers).values(rows);
    const collectedOn = x.collected_on && /^\d{4}-\d{2}-\d{2}$/.test(x.collected_on) ? x.collected_on : null;
    await setReport({ status: "interpreting", stage: "weighing", labName: x.lab_name, collectedOn, nameOnReport: x.name_on_report });

    emit({ type: "stage", stage: "weighing" });
    // Events are usually found at onboarding already; don't hold the read for a slow search.
    await Promise.race([eventsJob, new Promise((r) => setTimeout(r, 8_000))]);
    lap("events_wait");
    const event = await targetEvent(userId, profile, persona);
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
          priority: r.key ? rank.get(r.key) ?? null : null,
          // Notes only where they add something: off or at the edge of range, flagged, or near the top for this persona.
          note: (r.status !== "in_range" && r.status !== "unknown") || !!r.flag || (!!r.key && (rank.get(r.key) ?? 99) <= 8),
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
    // Safety floor: a flagged marker always means "doctor first", whatever the wording.
    if (rows.some((r) => r.flag) && read.verdict.level !== "doctor_first") read.verdict.level = "doctor_first";
    read.markers = read.markers.map((m) => ({ ...m, id: shortIds.get(m.id) ?? m.id }));

    await d
      .insert(schema.analyses)
      .values({ reportId, userId, read, eventId: event?.id ?? null })
      .onConflictDoUpdate({ target: schema.analyses.reportId, set: { read, eventId: event?.id ?? null, createdAt: new Date() } });
    await setReport({ status: "ready", stage: null, analyzedAt: new Date(), model: interpreted.model });
    emit({ type: "done", reportId });
    console.info(`[analyze] ${reportId} ready in ${((Date.now() - started) / 1000).toFixed(1)}s`, { ...times, markers: rows.length, model: interpreted.model });
  } catch (error) {
    console.error("[analyze]", error);
    const message =
      error instanceof FriendlyError
        ? error.message
        : error instanceof AiUnavailableError
          ? "Report reading isn't switched on yet. We've kept your file; try again soon."
          : error instanceof AiRefusalError
            ? "We couldn't read this report automatically. Try a clearer photo or the lab's PDF."
            : "Something went wrong while reading your report. Your file is saved; try again.";
    await setReport({ status: "failed", stage: null, error: message });
    emit({ type: "error", message });
  }
}
