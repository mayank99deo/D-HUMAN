import "server-only";
import type { EventRow } from "@/lib/db/schema";
import { factsFor } from "@/lib/domain/facts";
import type { Persona } from "@/lib/domain/persona";
import { REPORT_UPLOAD } from "@/lib/domain/uploads";
import type { PlanDetail } from "@/lib/platform/plan-state";
import { planJson } from "./parts";

// The apps' Upload screen (lib/api/schemas.ts UploadResponse): what the web's /upload page reads
// (the plan, the event the read aims at, the facts for the wait), shaped from the same loaders.
// The page carries no health words or rules of its own, so it stays as it is.

export function uploadJson(o: { persona: Persona; target: EventRow | null; plan: PlanDetail; aiOff: boolean }) {
  return {
    plan: planJson(o.plan),
    target: o.target?.name ?? null,
    noun: o.persona.noun,
    facts: factsFor(o.persona.archetype).map((f) => ({ kicker: f.kicker, text: f.text })),
    limits: { maxFiles: REPORT_UPLOAD.maxFiles, maxTotalBytes: REPORT_UPLOAD.maxTotalBytes, types: [...REPORT_UPLOAD.types] },
    aiOff: o.aiOff,
  };
}
