// The feedback email (UX spec §5): about 10 days in, one question answered by one tap.
// Two paths: "used" asks the must-have question, "barely" asks what got in the way.
// The answers are links from the feedback lane (/feedback?t=…&q=…&a=…); the page they
// open saves the answer, so a link scanner opening every option records nothing here.
// No band: the question is the content.

import type { FeedbackData, RenderedEmail } from "../types.ts";
import {
  EMAIL,
  TYPE,
  brandify,
  card,
  choices,
  cleanName,
  esc,
  footer,
  hero,
  link,
  page,
  para,
  textOf,
  type TemplateFrame,
} from "./parts.ts";

export const FEEDBACK_SUBJECT = "Two taps to shape D-Human";

const QUESTION: Record<FeedbackData["question"], string> = {
  feel: "How would you feel if you could no longer use D-Human?",
  gotinway: "What got in the way?",
};

const COPY = {
  used: {
    intro: "D-Human is new, and you've been using it for about 10 days. What you tell us decides what we build next.",
    after: "Tapping opens a short page with up to 3 more questions. Skip any of them.",
    preheader: "Tap an answer right here. Up to three more on the next page, all optional.",
    why: "You're getting this because you use D-Human. We ask at most once every 3 months.",
  },
  barely: {
    intro: "You signed up for D-Human about 10 days ago. If it hasn't stuck yet, we'd like to know why. No wrong answers.",
    after: "Tapping opens a short page with 2 more questions. Skip any of them.",
    preheader: "Tap an answer right here. Two more on the next page, both optional.",
    why: "You're getting this because you signed up for D-Human. We ask at most once every 3 months.",
  },
} as const;

/**
 * The answers' words for the two questions asked in the email, keyed by the answer values
 * in FEEDBACK_QUESTIONS. "I ran out of meal logs" rather than the UX spec's "My free meal
 * logs ran out": the copy rule keeps "free" for "Free to start" only.
 */
export const ANSWER_LABELS: Record<FeedbackData["question"], Record<string, string>> = {
  feel: {
    very: "Very disappointed",
    somewhat: "Somewhat disappointed",
    not: "Not disappointed",
    not_used: "I haven't used it much",
  },
  gotinway: {
    too_slow: "Logging meals took too long",
    numbers_off: "The meal numbers looked off",
    logs_ran_out: "I ran out of meal logs",
    no_report: "I don't have a blood report to upload",
    not_yet: "I haven't got to it yet",
    other: "Something else",
  },
};

const REPLY = "Rather write? Reply to this email. The founding team reads every reply.";

export function feedbackEmail(data: FeedbackData, frame: TemplateFrame): RenderedEmail {
  if (data.options.length === 0) throw new Error("feedback email: no answer options");
  const name = cleanName(frame.firstName);
  const copy = COPY[data.path];
  const question = QUESTION[data.question];
  const intro = name ? `Hi ${name}. ${copy.intro}` : copy.intro;
  const options = data.options.map((o) => ({ label: o.label, href: link(frame, o.url) }));

  const foot = footer({ frame, stopLabel: "Stop questions like this", why: copy.why });

  const cardHtml = [
    `<p class="t-ink" style="margin:0 0 24px;${TYPE.question};color:${EMAIL.ink}">${brandify(esc(question))}</p>`,
    choices(options),
    para(esc(copy.after), { type: TYPE.note, margin: "20px 0 0" }),
    frame.canReply ? para(esc(REPLY), { type: TYPE.note, margin: "12px 0 0" }) : "",
  ]
    .filter(Boolean)
    .join("\n");

  const html = page({
    subject: FEEDBACK_SUBJECT,
    preheader: copy.preheader,
    frame,
    rows: [hero({ headline: "One question, one tap.", sub: brandify(esc(intro)) }), card(cardHtml), foot.html],
  });

  const text = textOf([
    ["One question, one tap.", intro],
    [question, "Tap an answer:", ...options.map((o) => `- ${o.label}: ${o.href}`)],
    copy.after,
    frame.canReply && REPLY,
    foot.text,
  ]);

  return { subject: FEEDBACK_SUBJECT, preheader: copy.preheader, html, text };
}
