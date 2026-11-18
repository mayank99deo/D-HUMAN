// "Didn't finish setting up": once, 24 hours after an account was made, if onboarding
// isn't done (UX spec §3, variant B). We may know nothing about them yet, so the band
// is the contour field, not a bib, and nothing personal shows. No stop link: it's a one-off.

import type { RenderedEmail, WelcomeUnfinishedData } from "../types.ts";
import { FREE_LINE } from "./welcome.ts";
import { TYPE, brandify, button, card, contourBand, esc, footer, hero, link, page, para, textOf, type TemplateFrame } from "./parts.ts";

const SUBJECT = "Your bib is half printed";
const PREHEADER = "A few questions about your training and food, and your bib is ready.";
const HEADLINE = "Your bib is half printed.";
const SUB = "You signed in to D-Human but didn't finish setting up.";
const BODY =
  "A few questions about your training, your food and your goal, and you get your bib, your daily protein aim, and Fuel for logging meals by photo, voice or text.";
const ONLY_ONCE = "This is the only reminder we'll send about it.";

export function welcomeUnfinishedEmail(_data: WelcomeUnfinishedData, frame: TemplateFrame): RenderedEmail {
  const onboarding = link(frame, "/onboarding");
  const foot = footer({
    frame,
    top: frame.canReply ? ["Stuck on a question? Reply to this email. It reaches the founding team."] : [],
    stopLabel: null,
    why: `You're getting this because someone signed in to D-Human with ${frame.email}. If that wasn't you, ignore this email; nobody can sign in without the code we send to this inbox.`,
  });

  const html = page({
    subject: SUBJECT,
    preheader: PREHEADER,
    frame,
    rows: [
      hero({ headline: HEADLINE, sub: brandify(esc(SUB)) }),
      contourBand(frame),
      card(
        [
          para(esc(BODY), { tone: "ink", type: TYPE.body, margin: "0" }),
          button("Finish setting up", onboarding),
          para(esc(FREE_LINE), { type: TYPE.small, margin: "20px 0 0" }),
          para(esc(ONLY_ONCE), { type: TYPE.small, margin: "8px 0 0" }),
        ].join("\n"),
      ),
      foot.html,
    ],
  });

  const text = textOf([[HEADLINE, SUB], BODY, `Finish setting up: ${onboarding}`, [FREE_LINE, ONLY_ONCE], foot.text]);
  return { subject: SUBJECT, preheader: PREHEADER, html, text };
}
