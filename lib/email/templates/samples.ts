// Sample data for every email and variant: the dev preview (/api/email-preview) renders
// these, and tests/email-templates.test.ts checks each one. Demo Priya and made-up numbers;
// the tokens are placeholders (lane C makes the real ones).

import type { EmailKind, FeedbackData, WeekDay } from "../types.ts";
import { ANSWER_LABELS } from "./feedback.ts";
import type { EmailToRender, TemplateFrame } from "./index.ts";

export type Sample = { id: string; title: string; email: EmailToRender; frame: TemplateFrame };

/** The stop link's switch per kind, as lane C's tokens carry it. */
const STOP_KIND: Partial<Record<EmailKind, string>> = { weekly: "weekly", feedback: "questions" };

export function sampleFrame(kind: EmailKind, site: string, overrides: Partial<TemplateFrame> = {}): TemplateFrame {
  const stop = STOP_KIND[kind];
  return {
    sendId: "snd_sample",
    siteUrl: site,
    email: "priya@example.com",
    firstName: "Priya",
    stopUrl: stop ? `${site}/email/stop?t=SAMPLE-STOP-TOKEN&kind=${stop}` : null,
    settingsUrl: "/settings#emails",
    canReply: true,
    ...overrides,
  };
}

// Mon logged, Tue aim, Wed nothing, Thu aim, Fri logged, Sat aim, Sun aim: 6 logged, 4 reached.
const PATTERN = ["logged", "aim", "none", "aim", "logged", "aim", "aim"] as const;
const week = (start: string, pattern: readonly ("logged" | "aim" | "none")[]): WeekDay[] =>
  pattern.map((p, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), logged: p !== "none", proteinReached: p === "aim" };
  });

const feedbackOptions = (site: string, question: FeedbackData["question"]) =>
  Object.entries(ANSWER_LABELS[question]).map(([answer, label]) => ({
    answer,
    label,
    url: `${site}/feedback?t=SAMPLE-FEEDBACK-TOKEN&q=${question}&a=${answer}`,
  }));

export function emailSamples(site: string, assetUrl?: string): Sample[] {
  const frame = (kind: EmailKind, o: Partial<TemplateFrame> = {}) => sampleFrame(kind, site, { assetUrl, ...o });
  const weekBase = {
    weekStart: "2026-11-16",
    weekEnd: "2026-11-22",
    proteinTargetG: 96,
    avgProteinG: 88,
    reportsRead: 0,
    wrapUrl: "/wraps?week=2026-11-16",
  };

  return [
    {
      id: "welcome",
      title: "Welcome",
      email: { kind: "welcome", data: { bib: "24", label: "Regular runner", archetype: "running", proteinTargetG: 96 } },
      frame: frame("welcome"),
    },
    {
      id: "welcome-no-weight",
      title: "Welcome, weight unknown (no protein number)",
      email: { kind: "welcome", data: { bib: "31", label: "Regular lifter", archetype: "strength", proteinTargetG: null } },
      frame: frame("welcome"),
    },
    {
      id: "welcome-fresh",
      title: "Welcome, no name or age, starting from zero, no reply inbox",
      email: { kind: "welcome", data: { bib: "01", label: "Fresh start", archetype: "starting", proteinTargetG: 58 } },
      frame: frame("welcome", { firstName: "You", canReply: false }),
    },
    {
      id: "welcome-long",
      title: "Welcome, long name and label",
      email: { kind: "welcome", data: { bib: "38", label: "Competitive hybrid athlete", archetype: "hyrox", proteinTargetG: 132 } },
      frame: frame("welcome", { firstName: "Venkataraghavan" }),
    },
    {
      id: "welcome-unfinished",
      title: "Didn't finish setting up",
      email: { kind: "welcome_unfinished", data: {} },
      frame: frame("welcome_unfinished", { firstName: null }),
    },
    {
      id: "weekly",
      title: "Weekly, full: protein aim reached",
      email: {
        kind: "weekly",
        data: {
          ...weekBase,
          version: "full",
          days: week(weekBase.weekStart, PATTERN),
          daysLogged: 6,
          mealsLogged: 14,
          proteinReachedDays: 4,
          topFood: { title: "Poha", times: 4 },
          loggedMostlyBy: "photo",
          upFromDays: 3,
        },
      },
      frame: frame("weekly"),
    },
    {
      id: "weekly-no-aim",
      title: "Weekly, full: aim not reached yet, logged mostly by voice",
      email: {
        kind: "weekly",
        data: {
          ...weekBase,
          version: "full",
          days: week(weekBase.weekStart, ["logged", "logged", "none", "logged", "logged", "none", "logged"]),
          daysLogged: 5,
          mealsLogged: 9,
          proteinReachedDays: 0,
          avgProteinG: 62,
          topFood: null,
          loggedMostlyBy: "voice",
          upFromDays: null,
        },
      },
      frame: frame("weekly"),
    },
    {
      id: "weekly-script",
      title: "Weekly, full: top food in Hindi, first weekly email, across a month",
      email: {
        kind: "weekly",
        data: {
          ...weekBase,
          weekStart: "2026-11-30",
          weekEnd: "2026-12-06",
          wrapUrl: "/wraps?week=2026-11-30",
          version: "full",
          days: week("2026-11-30", ["aim", "logged", "logged", "none", "aim", "logged", "logged"]),
          daysLogged: 6,
          mealsLogged: 11,
          proteinReachedDays: 2,
          topFood: { title: "दाल चावल और आलू की सब्ज़ी", times: 3, lang: "hi" },
          loggedMostlyBy: "voice",
          upFromDays: 2,
          firstOfKind: true,
        },
      },
      frame: frame("weekly", { firstName: "Ankit" }),
    },
    {
      id: "weekly-light",
      title: "Weekly, light: 2 days",
      email: {
        kind: "weekly",
        data: {
          ...weekBase,
          version: "light",
          days: week(weekBase.weekStart, ["none", "none", "logged", "none", "aim", "none", "none"]),
          daysLogged: 2,
          mealsLogged: 3,
          proteinReachedDays: 1,
          topFood: null,
          loggedMostlyBy: "text",
          upFromDays: null,
          canLogMore: true,
        },
      },
      frame: frame("weekly"),
    },
    {
      id: "weekly-light-one",
      title: "Weekly, light: 1 day, no name, meal logs used up",
      email: {
        kind: "weekly",
        data: {
          ...weekBase,
          version: "light",
          days: week(weekBase.weekStart, ["none", "none", "none", "none", "none", "logged", "none"]),
          daysLogged: 1,
          mealsLogged: 1,
          proteinReachedDays: 0,
          topFood: null,
          loggedMostlyBy: "photo",
          upFromDays: null,
          canLogMore: false,
        },
      },
      frame: frame("weekly", { firstName: null }),
    },
    {
      id: "weekly-report",
      title: "Weekly, report only",
      email: {
        kind: "weekly",
        data: {
          ...weekBase,
          version: "report",
          days: week(weekBase.weekStart, ["none", "none", "none", "none", "none", "none", "none"]),
          daysLogged: 0,
          mealsLogged: 0,
          proteinReachedDays: 0,
          avgProteinG: null,
          topFood: null,
          loggedMostlyBy: null,
          upFromDays: null,
          reportsRead: 1,
        },
      },
      frame: frame("weekly"),
    },
    {
      id: "feedback",
      title: "Feedback, used it",
      email: { kind: "feedback", data: { path: "used", survey: "fb-1", question: "feel", options: feedbackOptions(site, "feel") } },
      frame: frame("feedback"),
    },
    {
      id: "feedback-barely",
      title: "Feedback, barely used it, no reply inbox",
      email: { kind: "feedback", data: { path: "barely", survey: "fb-1", question: "gotinway", options: feedbackOptions(site, "gotinway") } },
      frame: frame("feedback", { canReply: false }),
    },
  ];
}
