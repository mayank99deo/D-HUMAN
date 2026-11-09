// Every choice offered in onboarding and settings, with the labels people see.

export const ACTIVITIES = [
  { id: "running", label: "Running", hint: "5K to ultras" },
  { id: "hyrox", label: "HYROX & functional", hint: "Hybrid races, CrossFit" },
  { id: "strength", label: "Strength & gym", hint: "Lifting, bodybuilding" },
  { id: "trekking", label: "Trekking & the road", hint: "Hikes, high passes, long trips" },
  { id: "cycling", label: "Cycling", hint: "Road, MTB, brevets" },
  { id: "swimming", label: "Swimming", hint: "Pool or open water" },
  { id: "yoga", label: "Yoga & mobility", hint: "Yoga, pilates, stretching" },
  { id: "team", label: "Team & racket sports", hint: "Cricket, football, badminton" },
  { id: "walking", label: "Walking", hint: "Everyday steps" },
  { id: "starting", label: "Not much yet", hint: "Starting from zero is fine" },
] as const;
export type ActivityId = (typeof ACTIVITIES)[number]["id"];
export const ACTIVITY_IDS = ACTIVITIES.map((a) => a.id) as [ActivityId, ...ActivityId[]];

export const LEVELS = [
  { id: "starting", label: "Just starting", hint: "Building the habit" },
  { id: "regular", label: "Regular", hint: "2–4 sessions a week" },
  { id: "competitive", label: "Competitive", hint: "I race or enter events" },
  { id: "elite", label: "Elite", hint: "Podiums, coached, high volume" },
] as const;
export type LevelId = (typeof LEVELS)[number]["id"];
export const LEVEL_IDS = LEVELS.map((l) => l.id) as [LevelId, ...LevelId[]];

export const GOALS = [
  { id: "energy", label: "More energy" },
  { id: "fat_loss", label: "Lose fat" },
  { id: "muscle", label: "Build muscle" },
  { id: "performance", label: "Perform at an event" },
  { id: "sleep", label: "Sleep better" },
  { id: "stress", label: "Handle stress" },
  { id: "longevity", label: "Stay healthy for decades" },
  { id: "deficiency", label: "Fix a known deficiency" },
] as const;
export type GoalId = (typeof GOALS)[number]["id"];
export const GOAL_IDS = GOALS.map((g) => g.id) as [GoalId, ...GoalId[]];

export const DIETS = [
  { id: "veg", label: "Vegetarian" },
  { id: "eggetarian", label: "Eggetarian" },
  { id: "nonveg", label: "Non-vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "jain", label: "Jain" },
] as const;
export type DietId = (typeof DIETS)[number]["id"];
export const DIET_IDS = DIETS.map((d) => d.id) as [DietId, ...DietId[]];

export const CONDITIONS = [
  { id: "thyroid", label: "Thyroid" },
  { id: "diabetes", label: "Diabetes or prediabetes" },
  { id: "bp", label: "High blood pressure" },
  { id: "cholesterol", label: "High cholesterol" },
  { id: "pcos", label: "PCOS" },
  { id: "anaemia", label: "Anaemia" },
  { id: "pregnant", label: "Pregnant or breastfeeding" },
  { id: "kidney", label: "Kidney" },
  { id: "liver", label: "Liver" },
  { id: "heart", label: "Heart" },
] as const;
export type ConditionId = (typeof CONDITIONS)[number]["id"];
export const CONDITION_IDS = CONDITIONS.map((c) => c.id) as [ConditionId, ...ConditionId[]];

export const SEXES = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "intersex", label: "Intersex" },
] as const;
export type SexId = (typeof SEXES)[number]["id"];
export const SEX_IDS = SEXES.map((s) => s.id) as [SexId, ...SexId[]];

export const LANGUAGES = [
  { id: "en", label: "English", sample: "Your vitamin D is low." },
  { id: "hi", label: "हिंदी", sample: "आपका विटामिन D कम है।" },
  { id: "hinglish", label: "Hinglish", sample: "Aapka vitamin D low hai." },
] as const;
export type LanguageId = (typeof LANGUAGES)[number]["id"];
export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id) as [LanguageId, ...LanguageId[]];

export const labelOf = <T extends { id: string; label: string }>(list: readonly T[], id?: string | null) =>
  list.find((x) => x.id === id)?.label ?? id ?? "";
