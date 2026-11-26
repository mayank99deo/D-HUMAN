import "server-only";
import { eq } from "drizzle-orm";
import { aiMode } from "@/lib/ai/client";
import type { StackPlan } from "@/lib/ai/schemas";
import { askGate } from "@/lib/ask/types";
import { db, schema } from "@/lib/db";
import type { Profile, Report } from "@/lib/db/schema";
import { markerDef } from "@/lib/domain/markers";
import type { Persona } from "@/lib/domain/persona";
import { asFlag } from "@/lib/domain/safety";
import { dietPicture, type DietPicture } from "../food";
import { inputsChanged, latestReadyReport, latestStack } from "../stack";

// The Stack screen, worked out once for both the web's /stack page and the apps' GET /api/stack,
// so the two can't drift (the mobile repo's docs/API.md §3.2). stackData loads; stackView is the
// page's own derivations, moved here unchanged, as a pure function of the person and the data:
// where the stack comes from, whether it's out of date, the flagged results the safety floor
// keeps out of it (from the newest report), and the hold.

type Member = { user: { id: string; email: string }; profile: Profile; persona: Persona };
type StackRow = typeof schema.stacks.$inferSelect;
type FlagRow = { key: string | null; name: string; flag: string | null };

export type StackData = {
  report: Report | null;
  stack: StackRow | null;
  /** Only read when there's no report: a stack then comes from meals alone. */
  picture: DietPicture | null;
  /** The markers of the newest report (else the stack's own), for the flags. */
  markers: FlagRow[];
  flags: { aiOff: boolean; ask: boolean };
};

/** Two steps: the newest report, the newest stack and (with no report) the diet picture together; then that report's flags. */
export async function stackData({ user, profile }: Pick<Member, "user" | "profile">): Promise<StackData> {
  const [report, stack] = await Promise.all([latestReadyReport(user.id), latestStack(user.id)]);
  // Before any report, the stack comes from meals alone (lib/platform/stack.ts).
  const picture = report ? null : await dietPicture(user.id, profile);
  const fromReport = report?.id ?? stack?.reportId ?? null;
  const d = await db();
  const markers = fromReport
    ? await d.select({ key: schema.markers.key, name: schema.markers.name, flag: schema.markers.flag }).from(schema.markers).where(eq(schema.markers.reportId, fromReport))
    : [];
  return {
    report,
    stack,
    picture,
    markers,
    flags: { aiOff: aiMode() === "off", ask: askGate({ email: user.email, onboardedAt: profile.onboardedAt, birthYear: profile.birthYear }) === "ok" },
  };
}

// "24, 175 cm, 70 kg, regular lifter": what a meals-only stack's targets were set from.
function bodyLine(profile: Profile, persona: Persona) {
  return [
    persona.age != null ? String(persona.age) : null,
    // Non-breaking spaces, so "71 kg" never splits across lines.
    profile.heightCm ? `${Math.round(profile.heightCm)} cm` : null,
    profile.weightKg ? `${Math.round(profile.weightKg)} kg` : null,
    persona.label.toLowerCase(),
  ]
    .filter(Boolean)
    .join(", ");
}

export type StackView =
  | { state: "start_with_food"; fullDays: number; usualDayShort: boolean }
  | {
      state: "stack";
      aiOff: boolean;
      stack: { id: string; status: string; error: string | null; plan: StackPlan | null; demo: boolean; made: string } | null;
      staleReason: "report" | "profile" | null;
      basis: "report" | "meals";
      hasReport: boolean;
      body: string;
      markerNames: Record<string, string>;
      budget: string | null;
      flagged: { name: string; urgent: boolean }[];
      hold: "urgent" | "pregnant" | null;
      ask: boolean;
    };

/** The Stack page's view: the two ways to start, or the stack's props in the order the page passes them. */
export function stackView({ profile, persona }: Pick<Member, "profile" | "persona">, data: StackData): StackView {
  const { report, stack } = data;
  // No report and nothing to go on in their food yet: the two ways to start.
  if (!report && data.picture && !stack && data.picture.source === "none") return { state: "start_with_food", fullDays: data.picture.fullDays, usualDayShort: data.picture.usualDayShort };
  // A stack built from meals has no report; once a report is read, it's out of date.
  const basis = stack ? (stack.reportId ? "report" : "meals") : report ? "report" : "meals";
  // Out of date: a newer report than the one it was built from (or the first, for a stack
  // from meals), or changed health answers (diet, medicines, conditions) since it was built.
  const staleReason =
    report && stack && stack.reportId !== report.id ? "report" : stack?.status === "ready" && inputsChanged(stack.plan, profile) ? "profile" : null;
  const names = Object.fromEntries(((stack?.plan as StackPlan | null)?.items ?? []).flatMap((i) => i.markers).map((k) => [k, markerDef(k)?.name ?? k]));
  // Results the safety floor keeps out of a stack, from the newest report (not the one the
  // stack was built on, which may be older or none at all, for a stack from meals): named
  // in a small card at the end, or, when urgent, in one line at the top with the stack held.
  const flagged = data.markers.flatMap((m) => {
    const flag = asFlag(m.flag);
    return flag ? [{ name: markerDef(m.key)?.name ?? m.name, urgent: flag === "urgent" }] : [];
  });
  const hold = flagged.some((f) => f.urgent) ? "urgent" : profile.conditions.includes("pregnant") ? "pregnant" : null;
  return {
    state: "stack",
    aiOff: data.flags.aiOff,
    stack: stack ? { id: stack.id, status: stack.status, error: stack.error, plan: stack.plan as StackPlan | null, demo: stack.model === "mock", made: stack.createdAt.toISOString() } : null,
    staleReason,
    basis,
    hasReport: !!report,
    body: bodyLine(profile, persona),
    markerNames: names,
    budget: profile.supplementBudget,
    flagged,
    hold,
    ask: data.flags.ask,
  };
}
