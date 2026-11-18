// The lifecycle email templates, one per kind. Each is a pure function
// (data, frame) => { subject, preheader, html, text } (the contract in lib/email/types.ts).
// The jobs lane picks the data; lib/email/send.ts adds the headers (List-Unsubscribe and
// the rest). Parts and design rules: ./parts.ts. Copy: docs/team/specs/2026-11-18-lifecycle-emails.md.

import type { EmailKind, EmailTemplate, FeedbackData, RenderedEmail, WeeklyData, WelcomeData, WelcomeUnfinishedData } from "../types.ts";
import { feedbackEmail } from "./feedback.ts";
import type { TemplateFrame } from "./parts.ts";
import { weeklyEmail, type WeeklyExtras } from "./weekly.ts";
import { welcomeEmail } from "./welcome.ts";
import { welcomeUnfinishedEmail } from "./welcome-unfinished.ts";

export { feedbackEmail, weeklyEmail, welcomeEmail, welcomeUnfinishedEmail };
export type { TemplateFrame, WeeklyExtras };

export type TemplateData = {
  welcome: WelcomeData;
  welcome_unfinished: WelcomeUnfinishedData;
  weekly: WeeklyData & WeeklyExtras;
  feedback: FeedbackData;
};

/** Every kind has a template, and each fits the contract's EmailTemplate type. */
export const TEMPLATES: { [K in EmailKind]: EmailTemplate<TemplateData[K]> } = {
  welcome: welcomeEmail,
  welcome_unfinished: welcomeUnfinishedEmail,
  weekly: weeklyEmail,
  feedback: feedbackEmail,
};

export type EmailToRender = { [K in EmailKind]: { kind: K; data: TemplateData[K] } }[EmailKind];

/** Render one email. Throws when a stoppable kind has no stop link in its frame. */
export function renderEmail(email: EmailToRender, frame: TemplateFrame): RenderedEmail {
  switch (email.kind) {
    case "welcome":
      return welcomeEmail(email.data, frame);
    case "welcome_unfinished":
      return welcomeUnfinishedEmail(email.data, frame);
    case "weekly":
      return weeklyEmail(email.data, frame);
    case "feedback":
      return feedbackEmail(email.data, frame);
  }
}

/** Gmail clips a message over 102 KB of HTML and hides what follows, the stop link included. */
export const GMAIL_CLIP_BYTES = 102 * 1024;
/** Our ceiling (visuals spec §1, "Size budget"): room for tracked links and longer names. */
export const HTML_BUDGET_BYTES = 40 * 1024;
