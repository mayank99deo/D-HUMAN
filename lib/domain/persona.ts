import type { ActivityId, GoalId, LevelId } from "./options";

// The persona is how D-Human sees you: what you do, how seriously, and so which
// markers matter most for you. It drives the emote, the bib, the order of the
// dashboard, the facts during analysis and the events we look up.

export type Archetype = ActivityId;

export type PersonaInput = {
  name?: string | null;
  birthYear?: number | null;
  primaryActivity?: string | null;
  activities?: string[] | null;
  level?: string | null;
  goals?: string[] | null;
};

const NOUN: Record<Archetype, string> = {
  running: "runner",
  hyrox: "hybrid athlete",
  strength: "lifter",
  trekking: "trekker",
  cycling: "cyclist",
  swimming: "swimmer",
  yoga: "yogi",
  team: "player",
  walking: "walker",
  starting: "starter",
};

const LEVEL_WORD: Record<LevelId, string> = {
  starting: "New",
  regular: "Regular",
  competitive: "Competitive",
  elite: "Elite",
};

// Ordered by what matters most for the activity. Goals then pull their own markers forward.
const PRIORITY: Record<Archetype, string[]> = {
  running: ["ferritin", "hemoglobin", "vitamin_d", "b12", "tsh", "magnesium", "hba1c", "transferrin_sat", "hscrp", "ck"],
  hyrox: ["ferritin", "vitamin_d", "hscrp", "ck", "testosterone_total", "hemoglobin", "hba1c", "magnesium", "tsh", "ldl"],
  strength: ["testosterone_total", "vitamin_d", "hba1c", "ldl", "creatinine", "alt", "hemoglobin", "ferritin", "tsh", "hscrp"],
  trekking: ["hemoglobin", "ferritin", "vitamin_d", "b12", "sodium", "tsh", "hba1c", "creatinine", "magnesium", "transferrin_sat"],
  cycling: ["ferritin", "hemoglobin", "vitamin_d", "magnesium", "b12", "hba1c", "tsh", "hscrp", "ck", "ldl"],
  swimming: ["ferritin", "vitamin_d", "hemoglobin", "tsh", "b12", "magnesium", "hba1c", "hscrp"],
  yoga: ["vitamin_d", "b12", "tsh", "hba1c", "ferritin", "hemoglobin", "ldl", "hscrp"],
  team: ["vitamin_d", "ferritin", "hemoglobin", "ck", "hscrp", "magnesium", "hba1c", "b12"],
  walking: ["hba1c", "ldl", "vitamin_d", "b12", "tsh", "hemoglobin", "triglycerides", "alt", "creatinine", "hscrp"],
  starting: ["hba1c", "glucose_fasting", "ldl", "triglycerides", "vitamin_d", "b12", "tsh", "alt", "hemoglobin", "uric_acid"],
};

const GOAL_MARKERS: Partial<Record<GoalId, string[]>> = {
  energy: ["ferritin", "hemoglobin", "b12", "vitamin_d", "tsh"],
  fat_loss: ["hba1c", "triglycerides", "tsh", "insulin_fasting", "homa_ir", "tg_hdl_ratio"],
  muscle: ["testosterone_total", "vitamin_d", "creatinine"],
  performance: ["ferritin", "hemoglobin", "vitamin_d"],
  sleep: ["vitamin_d", "magnesium", "cortisol", "tsh"],
  stress: ["cortisol", "magnesium", "tsh"],
  longevity: ["hba1c", "ldl", "apob", "lpa", "hscrp", "homocysteine", "triglycerides"],
  deficiency: ["vitamin_d", "b12", "ferritin", "folate"],
};

// What each activity looks for on the web. Activities without races get none;
// their "event" is the next retest.
const EVENT_SEARCH: Partial<Record<Archetype, string>> = {
  running: "running races: marathons, half marathons, 10K runs",
  hyrox: "HYROX races and hybrid fitness competitions",
  trekking: "popular group treks and high-altitude trekking seasons",
  cycling: "cycling events: cyclothons, gran fondos, brevets",
  swimming: "open-water swims and swimming events for amateurs",
  team: "amateur tournaments and corporate leagues",
  walking: "walkathons and community walks",
};

export type Persona = {
  archetype: Archetype;
  noun: string;
  label: string; // "Regular runner"
  level: LevelId;
  age: number | null;
  bib: string; // the big number on the bib
  firstName: string;
  priorities: string[];
  eventSearch: string | null;
};

export function ageFrom(birthYear?: number | null, now = new Date()) {
  if (!birthYear) return null;
  const age = now.getFullYear() - birthYear;
  return age > 0 && age < 120 ? age : null;
}

export function personaOf(p: PersonaInput, now = new Date()): Persona {
  const activities = (p.activities ?? []) as Archetype[];
  const archetype = ((p.primaryActivity as Archetype) || activities[0] || "starting") as Archetype;
  const level = (p.level as LevelId) || (archetype === "starting" ? "starting" : "regular");
  const noun = NOUN[archetype] ?? "human";
  const age = ageFrom(p.birthYear, now);
  const label = archetype === "starting" ? "Fresh start" : `${LEVEL_WORD[level]} ${noun}`;

  const goalPull = (p.goals ?? []).flatMap((g) => GOAL_MARKERS[g as GoalId] ?? []);
  const base = PRIORITY[archetype] ?? PRIORITY.starting;
  // Goal markers that are already in the activity list move up; new ones join after the top three.
  const ordered = [...base.slice(0, 3), ...goalPull, ...base.slice(3)];
  const priorities = [...new Set(ordered)];

  return {
    archetype,
    noun,
    label,
    level,
    age,
    bib: age ? String(age) : "01",
    firstName: (p.name ?? "").trim().split(/\s+/)[0] || "You",
    priorities,
    eventSearch: EVENT_SEARCH[archetype] ?? null,
  };
}

export const archetypeNoun = (a: string) => NOUN[a as Archetype] ?? "human";
