// The welcome email, sent once when someone finishes onboarding (UX spec §3).
// Masthead, "You're in", the bib, then the paper card: their protein number (only when
// their weight is known), three ways to start, the D-corner line, one button.
// No stop link: it's a one-off. It tells them what comes next and where to turn it off.

import { PLAN } from "../../domain/plan.ts";
import type { Archetype } from "../../domain/persona.ts";
import type { RenderedEmail, WelcomeData } from "../types.ts";
import {
  TYPE,
  EMAIL,
  band,
  bib,
  button,
  card,
  cleanName,
  dCorner,
  esc,
  footer,
  hero,
  link,
  page,
  para,
  ruleLabel,
  textLink,
  textOf,
  type TemplateFrame,
} from "./parts.ts";

/** Alt text for each sport pictogram (public/email/pictograms/<archetype>.png). */
export const PICTOGRAM_ALT: Record<Archetype, string> = {
  running: "Runner",
  hyrox: "Hybrid athlete",
  strength: "Lifter",
  trekking: "Trekker",
  cycling: "Cyclist",
  swimming: "Swimmer",
  yoga: "Yogi",
  team: "Team player",
  walking: "Walker",
  starting: "Fresh start",
};

export const pictogramFor = (archetype: string): Archetype =>
  archetype in PICTOGRAM_ALT ? (archetype as Archetype) : "starting";

export const FREE_LINE = `Free to start: ${PLAN.freeReads} report reads and ${PLAN.freeMeals} meal logs. No card needed.`;

const STEPS = [
  ["Log a meal", "Snap it, say it or type it, in English, Hindi, Hinglish or 9 more Indian languages. AI estimates the calories and protein."],
  ["Read a blood report you already have", "Upload the PDF or photos. AI reads it marker by marker and points out what matters for your training. It isn't a diagnosis."],
  ["Watch your week add up", "Every Sunday evening, a short wrap of your week so far: what you ate, what went well, and one thing to try."],
] as const;

const CALLOUT = "We suggest a supplement only when a marker or a real food gap points to it.";

export function welcomeEmail(data: WelcomeData, frame: TemplateFrame): RenderedEmail {
  const name = cleanName(frame.firstName);
  const protein = data.proteinTargetG != null && data.proteinTargetG > 0 ? Math.round(data.proteinTargetG) : null;
  const archetype = pictogramFor(data.archetype);
  const label = data.label.trim() || "Fresh start";
  const number = data.bib.trim() || "01";

  const subject = protein
    ? name ? `You're in, ${name}. Here's your number.` : "You're in. Here's your number."
    : name ? `Welcome to D-Human, ${name}` : "Welcome to D-Human";
  const preheader = protein
    ? "Your bib, your protein aim, and the quickest way to log a meal."
    : "Your bib, and the quickest way to log your first meal.";
  const headline = name ? `You're in, ${name}.` : "You're in.";

  const fuel = link(frame, "/fuel");
  const upload = link(frame, "/upload");

  const steps = STEPS.map(([title, body], i) => {
    const rule = i === 0 ? "" : `border-top:1px solid ${EMAIL.rule};`;
    const cls = i === 0 ? "" : " rule";
    return `<tr>
<td class="t-ink${cls}" valign="top" width="52" style="padding:18px 0;${rule}${TYPE.stepNumber};color:${EMAIL.ink}">${i + 1}</td>
<td class="t-smoke${cls}" valign="top" style="padding:18px 0;${rule}${TYPE.secondary};color:${EMAIL.smoke}"><strong class="t-ink" style="display:block;font-size:18px;line-height:24px;color:${EMAIL.ink}">${esc(title)}</strong>${esc(body)}</td>
</tr>`;
  }).join("\n");

  const numberBlock = protein
    ? [
        ruleLabel("Your number"),
        `<p class="t-ink stat-protein" style="margin:10px 0 0;${TYPE.protein};color:${EMAIL.ink}">${protein} g</p>`,
        `<p class="t-ink" style="margin:6px 0 0;${TYPE.lead};color:${EMAIL.ink}">of protein a day</p>`,
        para("Set from your weight, how you train and your goal. Fuel adds it up for you, meal by meal.", { margin: "8px 0 36px" }),
      ].join("\n")
    : "";

  const cardHtml = [
    numberBlock,
    ruleLabel("Three ways to start"),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px">\n${steps}\n</table>`,
    dCorner(CALLOUT),
    button("Log your first meal", fuel),
    para(`Or ${textLink("upload a report", upload)}`, { type: TYPE.note, margin: "4px 0 0" }),
    para(esc(FREE_LINE), { type: TYPE.small, margin: "12px 0 0" }),
  ].join("\n");

  const why = `You're getting this because you signed up to D-Human with ${frame.email}. From now on we'll email you a weekly wrap on Sunday evenings and, now and then, a quick question. Choose what you get in Email settings.`;
  const foot = footer({
    frame,
    top: frame.canReply ? ["Questions or ideas? Reply to this email. It reaches the founding team."] : [],
    stopLabel: null,
    why,
  });

  const html = page({
    subject,
    preheader,
    frame,
    rows: [
      hero({ headline, sub: `Your body speaks data.<br><span style="white-space:nowrap;color:${EMAIL.paper}">Hack your health.</span>` }),
      band(
        bib({
          frame,
          number,
          name,
          label,
          pictogram: { file: archetype, alt: PICTOGRAM_ALT[archetype] },
          next: { label: "Next: log your first meal", href: fuel },
        }),
      ),
      card(cardHtml),
      foot.html,
    ],
  });

  const text = textOf([
    [headline, "Your body speaks data. Hack your health."],
    [`Your bib: ${number}${name ? `, ${name}` : ""}. ${label}.`, `Next: log your first meal: ${fuel}`],
    protein ? [`Your number: ${protein} g of protein a day.`, "Set from your weight, how you train and your goal. Fuel adds it up for you, meal by meal."] : null,
    ["Three ways to start", ...STEPS.map(([title, body], i) => `${i + 1}. ${title}. ${body}`)],
    CALLOUT,
    [`Log your first meal: ${fuel}`, `Or upload a report: ${upload}`],
    FREE_LINE,
    foot.text,
  ]);

  return { subject, preheader, html, text };
}
