// Shared by the waitlist form (client) and the API schema (server).

export const PLAN_VALUES = ["baseline", "core", "complete", "unsure"] as const;
export type PlanValue = (typeof PLAN_VALUES)[number];

export const PLAN_LABELS: Record<PlanValue, string> = {
  baseline: "Baseline",
  core: "Core",
  complete: "Complete",
  unsure: "Not sure yet",
};

export const TRAINING_VALUES = ["lifting", "running", "hyrox", "endurance", "general"] as const;
export type TrainingValue = (typeof TRAINING_VALUES)[number];

export const TRAINING_LABELS: Record<TrainingValue, string> = {
  lifting: "Lifting",
  running: "Running",
  hyrox: "Hyrox",
  endurance: "Marathons and endurance",
  general: "General health",
};

export const SOURCE_VALUES = ["hero", "closing"] as const;
export type SourceValue = (typeof SOURCE_VALUES)[number];
