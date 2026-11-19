// The app map: everything Ask may say about using D-Human, built from the app's own
// constants so a number can't drift from the screens. It sits in Ask's fixed system
// prompt, which is cached for everyone, so it must stay byte-stable: no dates, no user
// data, a fixed order. tests/ask-app.test.ts fails when a screen, tab or number drifts.
//
// Keep each screen's line in step with the component named above it, the way
// components/platform/tour-stops.ts is kept with the screens.

import { ASK_LIMITS, ASK_LINKS, type AskLinkId } from "../ask/types.ts";
import { BUDGETS } from "./budget.ts";
import { HISTORY_DAYS } from "./meals.ts";
import { LANGUAGES } from "./options.ts";
import { PLAN, PRICE_TEXT } from "./plan.ts";
import { SPOKEN } from "./speech.ts";

// Not exported by the app yet (contract §18 follow-up): MAX_TOTAL and MAX_FILES in
// app/api/reports/route.ts, and the literal `fullDays.length >= 3` in lib/platform/food.ts.
// tests/ask-app.test.ts reads both source files and fails if these disagree.
export const UPLOAD_MAX_MB = 4;
export const UPLOAD_MAX_PHOTOS = 6;
export const FULL_DAYS_FOR_STACK = 3;

const budgets = `${BUDGETS[0].label} to ${BUDGETS[BUDGETS.length - 3].label}, ${BUDGETS[BUDGETS.length - 2].label}, or ${BUDGETS[BUDGETS.length - 1].label.toLowerCase()}`;

/** One line per link id: what the screen is for, as the model may describe it. */
export const SCREEN_LINES: Record<AskLinkId, string> = {
  // components/platform/FuelLogger.tsx
  log_meal: `Fuel. Log a meal by photo, voice or typing (voice in ${SPOKEN.length} languages). AI estimates calories, protein, carbs, fat, fibre and key vitamins and minerals; the numbers are estimates. Today's ring against your targets, what your food is short of, and Delete on each meal.`,
  // components/platform/PastMeals.tsx
  past_meals: `Past meals: the ${HISTORY_DAYS} days before today, newest first; delete any meal. Opened from "Past meals" beside the Fuel title.`,
  // components/platform/FuelLogger.tsx, "How you usually eat"
  usual_day: `On Fuel: describe how you usually eat, once. Your stack uses it until you have ${FULL_DAYS_FOR_STACK} fully logged days.`,
  // components/platform/Uploader.tsx
  upload: `Upload a blood report from any lab: one PDF up to ${UPLOAD_MAX_MB} MB, or photos of up to ${UPLOAD_MAX_PHOTOS} pages. AI reads every marker for your sport and goal. Blood tests through D-Human are coming soon.`,
  // app/(platform)/(app)/reports/[id]/page.tsx
  report: "Your latest report: each marker with its range and status, the AI read, questions to take to a doctor, and when to retest.",
  // components/platform/ReportsManager.tsx
  reports: "Your reports: open or delete any report you uploaded, or Start fresh to delete them all. A deleted report's read stays counted; meals, targets and profile stay.",
  // app/(platform)/(app)/home/page.tsx
  home: "Home, after a report is read: your verdict for your event or goal, the markers that matter for your sport, and Today's fuel with Log a meal and yesterday's totals.",
  // components/platform/Stack.tsx
  stack: `Stack: supplements only where a marker or a repeated food gap points, food first, with dose, timing, how long and cautions, and brands sold in India with monthly prices. D-Human has no brand partners. Set a monthly budget (${budgets}). No report? ${FULL_DAYS_FOR_STACK} logged days or a usual day is enough to start. Rebuild after a new report or a change to diet, medicines or conditions.`,
  // components/platform/Wraps*.tsx
  wraps: "Wraps: your week, month and year as story cards: what you ate, what moved, one thing to do next. A weekly wrap email goes out on Sunday evenings.",
  // components/platform/Settings.tsx
  settings: `Your profile, in Settings (the person button at the top right): profile, sport, goals, event, diet, health and medicines; language for reads (${LANGUAGES.map((l) => l.label).join(", ")}); blood reports; sign out; replay the app tour; delete everything.`,
  // components/platform/Settings.tsx, the plan card
  plan: "Your plan, in Settings: what you've used, and the pass.",
  // components/platform/EmailSettings.tsx
  emails: "Email settings, in Settings: turn the weekly wrap and other emails on or off. Every email also has a one-tap stop.",
  // app/(guides)/sources-and-safety/page.tsx
  sources: "Sources and safety: how D-Human's AI reads are made and where its numbers come from.",
};

export const APP_MAP = `Screens (link id: what it is):
${ASK_LINKS.map((l) => `- ${l.id}: ${SCREEN_LINES[l.id]}`).join("\n")}
Plans:
- Free to start: ${PLAN.freeReads} report reads and ${PLAN.freeMeals} meal logs per account.
- Pass: ${PRICE_TEXT} for ${PLAN.days} days with ${PLAN.passReads} report reads; one payment through Razorpay; it doesn't renew. Buy it in Settings, or when a limit is reached.
- Everyone: up to ${PLAN.mealsPerDay} meal logs a day and ${ASK_LIMITS.perDay} questions a day to Ask. Stacks, wraps and the usual day use none of these.
Facts:
- Report reads are written by AI (Claude, by Anthropic); no doctor reviews them; they are not a diagnosis.
- Reads, food notes, wraps and stacks come in English, Hindi or Hinglish (Settings). Meals can be logged in ${SPOKEN.map((s) => s.name).join(", ")}. Buttons are in English.
- For adults, 18 and over.
- Questions to Ask clear after the day.
- Not in the app: booking blood tests (coming soon), doctor consultations, sign-in by phone or WhatsApp, connecting watches or other apps.`;

/**
 * App screens Ask deliberately doesn't link to, each with the reason. A new screen under
 * app/(platform)/(app)/ fails tests/ask-app.test.ts until it's in the map or listed here.
 */
export const NOT_IN_ASK: Record<string, string> = {};
