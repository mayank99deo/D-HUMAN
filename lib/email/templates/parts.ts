// The shared parts every lifecycle email is built from: tokens, type, the page frame,
// hero, card, button, links, the D-corner callout, the bib, the week as seven squares,
// stat tiles, answer rows and the footer. Pure string builders, no imports from the app,
// so templates render the same in the job, the preview and the tests.
//
// Design: docs/team/specs/2026-11-18-email-and-blog-visuals.md §1. The rules that matter:
// - Tables and inline styles; Archivo with its width axis where it loads (Apple Mail,
//   iOS Mail), Helvetica or Arial everywhere else. `font-stretch` follows the `font`
//   shorthand, which can't take a percentage.
// - Every surface has a real background colour. Inverting mail apps decide by
//   background-color, so a surface painted only by a gradient loses its text. The cut
//   corners (bib, button) are a small triangle painted on top of a real colour.
// - Two style blocks: phones in one, dark mode in the other, so a client that rejects
//   one keeps the other. Class selectors only.
// - Every link is at least 44 px tall; every link carries an explicit line height so
//   the tests can check that.

import type { EmailFrame } from "../types.ts";

// ── Tokens ──────────────────────────────────────────────────────────────────

export const EMAIL = {
  ink: "#000000",
  paper: "#ffffff",
  graphite: "#8c8c8c", // secondary text on ink, 6.25:1
  smoke: "#5c5c5c", // secondary text on paper, 6.69:1; the empty day's outline
  rule: "#d4d4d4",
  dash: "#a6a6a6", // the bib's tear-off line
  storyOff: "#333333", // unfilled story-bar segments
  serum: "#b5d2c0", // the one colour: a day the protein aim was reached, always with a check
  dark: { card: "#111111", text: "#ffffff", secondary: "#a3a3a3", rule: "#333333", option: "#8c8c8c" },
  width: 600,
} as const;

export const FONT = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";
/** For food titles in other scripts: the phone's own fonts, never Anek in email. */
const SCRIPT_FONT = "'Noto Sans Devanagari','Kohinoor Devanagari','Devanagari Sangam MN','Helvetica Neue',Helvetica,Arial,sans-serif";

const font = (weight: number, size: number, line: number, stretch?: number, tracking?: number) =>
  `font:${weight} ${size}px/${line}px ${FONT}` +
  (stretch ? `;font-stretch:${stretch}%` : "") +
  (tracking ? `;letter-spacing:${tracking}px` : "");

/** The type scale (visuals spec §1, "Type"). Phone sizes live in PHONE_CSS. */
export const TYPE = {
  headline: font(800, 48, 50, 118, -0.5),
  headlineLong: font(800, 40, 44, 118, -0.5), // a word over 11 characters, such as a long name
  sub: font(500, 18, 26),
  bibNumber: font(800, 128, 112, 125, -3),
  bibName: font(700, 26, 30, 125),
  bibNameLong: font(700, 20, 24, 125),
  bibLabel: font(600, 14, 18, 112),
  bigStat: font(800, 80, 72, 125, -1.5),
  protein: font(800, 56, 56, 125, -1),
  smallStat: font(800, 32, 34, 125),
  smallStatLong: font(800, 22, 28, 112),
  stepNumber: font(800, 30, 30, 125),
  question: font(700, 26, 31, 112, -0.3),
  lead: font(700, 18, 25),
  callout: font(700, 19, 27, 112),
  body: font(400, 17, 27),
  secondary: font(400, 16, 24),
  note: font(400, 15, 22),
  small: font(400, 14, 21),
  label: font(700, 14, 20),
  button: font(700, 16, 20),
  option: font(600, 17, 22),
  dayLetter: font(600, 12, 16),
  footer: font(400, 13, 20),
} as const;

// Block 1, phones. Block 2, dark mode (Apple Mail, iOS Mail, Outlook for Mac); Gmail ignores
// it and inverts on its own. In dark mode surfaces go dark; the bib stays paper, as in the app.
const PHONE_CSS = `@media (max-width:620px){
.px{padding-left:24px!important;padding-right:24px!important}
.logo{padding-left:12px!important;padding-right:12px!important}
.h1{font-size:36px!important;line-height:38px!important}
.h1-long{font-size:28px!important;line-height:32px!important}
.bib-pad{padding-left:24px!important;padding-right:24px!important}
.bib-num{font-size:96px!important;line-height:84px!important}
.stat{font-size:64px!important;line-height:60px!important}
.stat-protein{font-size:44px!important;line-height:46px!important}
.btn-wrap{width:100%!important}
.btn a{display:block!important;text-align:center!important}
}`;

const DARK_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.card{background:${EMAIL.dark.card}!important}
.t-ink{color:${EMAIL.dark.text}!important}
.t-smoke{color:${EMAIL.dark.secondary}!important}
.rule{border-color:${EMAIL.dark.rule}!important}
.rule-ink{border-color:${EMAIL.dark.text}!important}
.bar{background:${EMAIL.dark.text}!important}
.btn{background-color:${EMAIL.paper}!important;background-image:linear-gradient(135deg,${EMAIL.dark.card} 7px,transparent 7px)!important}
.btn a{color:${EMAIL.ink}!important}
.link-ink{color:${EMAIL.dark.text}!important}
.opt{border-color:${EMAIL.dark.option}!important}
.opt a{color:${EMAIL.dark.text}!important}
}`;

// ── Text helpers ────────────────────────────────────────────────────────────

export const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Keeps narrow screens from breaking the name at its hyphen. */
export const BRAND = `<span style="white-space:nowrap">D-Human</span>`;

export const DISCLAIMER = "D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.";

/**
 * A first name fit for a greeting, or null. The persona's fallback "You" counts as no
 * name (it would read "You're in, You."). Control characters go, spaces collapse.
 */
export function cleanName(name: string | null | undefined): string | null {
  const clean = (name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return clean && clean.toLowerCase() !== "you" ? clean : null;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "16 to 22 November", or "30 November to 6 December" across a month. Dates are "YYYY-MM-DD". */
export function dateSpan(start: string, end: string): string {
  const [, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  const month = (m: number) => MONTHS[m - 1] ?? "";
  return sm === em ? `${sd} to ${ed} ${month(em)}` : `${sd} ${month(sm)} to ${ed} ${month(em)}`;
}

/** Cut a title at a word, with "…", past `max` characters. */
export function clip(title: string, max = 28): string {
  const t = title.replace(/\s+/g, " ").trim();
  if ([...t].length <= max) return t;
  const cut = [...t].slice(0, max).join("");
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${(atWord.length >= max / 2 ? atWord : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

// ── Frame and links ─────────────────────────────────────────────────────────

/**
 * The frame the templates take: the contract's EmailFrame plus two optional extras.
 * assetUrl: where images load from (the preview passes its own origin); defaults to siteUrl.
 * postalAddress: the footer's address line. undefined reads EMAIL_POSTAL_ADDRESS; null or
 * an empty string leaves the line out (Mayank hasn't chosen an address yet).
 */
export type TemplateFrame = EmailFrame & { assetUrl?: string; postalAddress?: string | null };

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function postalAddress(frame: TemplateFrame): string | null {
  const value = frame.postalAddress === undefined ? process.env.EMAIL_POSTAL_ADDRESS : frame.postalAddress;
  return value?.trim() || null;
}

export const assetBase = (frame: TemplateFrame) => trimSlash(frame.assetUrl || frame.siteUrl);

/**
 * An absolute link for the email. Paths resolve against the site; links to our own site
 * get `e=<sendId>` (UX spec §7.4) before any #fragment, once. Other sites are left alone.
 */
export function link(frame: TemplateFrame, pathOrUrl: string): string {
  const site = trimSlash(frame.siteUrl);
  const absolute = pathOrUrl.startsWith("/") && !pathOrUrl.startsWith("//") ? `${site}${pathOrUrl}` : pathOrUrl;
  let ours = false;
  try {
    ours = new URL(absolute).origin === new URL(site).origin;
  } catch {
    ours = false;
  }
  if (!ours || !frame.sendId) return absolute;
  const hashAt = absolute.indexOf("#");
  const [base, hash] = hashAt === -1 ? [absolute, ""] : [absolute.slice(0, hashAt), absolute.slice(hashAt)];
  if (/[?&]e=/.test(base)) return absolute;
  return `${base}${base.includes("?") ? "&" : "?"}e=${encodeURIComponent(frame.sendId)}${hash}`;
}

// ── The page ────────────────────────────────────────────────────────────────

// Zero-width padding after the preheader, so mail apps don't pull body text into the preview.
const PREHEADER_PAD = "&#8199;&#847;".repeat(40);

export function page(o: { subject: string; preheader: string; frame: TemplateFrame; rows: string[] }): string {
  const assets = assetBase(o.frame);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(o.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&amp;display=swap" rel="stylesheet">
<style>
${PHONE_CSS}
</style>
<style>
${DARK_CSS}
</style>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(o.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.ink}" style="background-color:${EMAIL.ink}">
<tr><td align="center" style="padding:0 12px">
<table role="presentation" width="${EMAIL.width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${EMAIL.width}px">
<tr><td class="logo" style="padding:28px 28px 36px"><img src="${esc(assets)}/email/wordmark.png" width="192" height="40" alt="D-Human" style="display:block;border:0;width:192px;height:40px;color:${EMAIL.paper};font:700 14px/40px ${FONT};letter-spacing:4px"></td></tr>
${o.rows.join("\n")}
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Long names don't break into the margin: they wrap only when nothing else can. */
const WRAP = "overflow-wrap:break-word;word-wrap:break-word";
const longestWord = (text: string) => Math.max(0, ...text.split(/\s+/).map((w) => [...w].length));

/**
 * Headline (a real h1) and its one line in graphite, on ink. `sub` is HTML. A word over
 * 11 characters (a long name) steps the headline down a size, so it fits a 390 px phone.
 */
export function hero(o: { headline: string; sub?: string; above?: string }): string {
  const long = longestWord(o.headline) > 11;
  return [
    o.above ?? "",
    `<tr><td class="px" style="padding:0 40px"><h1 class="h1${long ? " h1-long" : ""}" style="margin:0;${long ? TYPE.headlineLong : TYPE.headline};${WRAP};color:${EMAIL.paper}">${esc(o.headline)}</h1></td></tr>`,
    o.sub ? `<tr><td class="px" style="padding:16px 40px 32px;${TYPE.sub};color:${EMAIL.graphite}">${o.sub}</td></tr>` : `<tr><td style="height:32px;font-size:0;line-height:0">&nbsp;</td></tr>`,
  ].join("\n");
}

/** The band slot sits between the hero and the card, padded like the text. */
export const band = (html: string, bottom = 40) => `<tr><td class="px" style="padding:0 40px ${bottom}px">${html}</td></tr>`;

/** The contour field, for account emails with no personal data. Decorative. */
export function contourBand(frame: TemplateFrame): string {
  return `<tr><td bgcolor="${EMAIL.ink}" style="background-color:${EMAIL.ink};line-height:0;font-size:0;padding-bottom:0"><img src="${esc(assetBase(frame))}/brand/email-header.jpg" width="600" alt="" style="display:block;border:0;width:100%;max-width:600px;height:auto"></td></tr>`;
}

/** The paper card. Dark mode turns it #111 and its text white. */
export const card = (html: string) =>
  `<tr><td class="card px" bgcolor="${EMAIL.paper}" style="background-color:${EMAIL.paper};padding:36px 40px 44px">\n${html}\n</td></tr>`;

/** A label above a 2 px rule, as in the guides. */
export const ruleLabel = (label: string, marginTop = 0) =>
  `<p class="t-ink rule-ink" style="margin:${marginTop}px 0 0;padding-top:14px;border-top:2px solid ${EMAIL.ink};${TYPE.label};color:${EMAIL.ink}">${esc(label)}</p>`;

/** A paragraph on the card. `html` is trusted markup; escape what goes in. */
export const para = (html: string, o: { tone?: "ink" | "smoke"; type?: string; margin?: string } = {}) => {
  const tone = o.tone ?? "smoke";
  return `<p class="t-${tone}" style="margin:${o.margin ?? "12px 0 0"};${o.type ?? TYPE.secondary};color:${tone === "ink" ? EMAIL.ink : EMAIL.smoke}">${html}</p>`;
};

/**
 * The primary button: a real background colour with a 7 px triangle in the card's colour
 * over the top-left corner, the site's cut corner. Without gradients it's square. 52 px tall,
 * full width on phones. Paper on ink in dark mode.
 */
export function button(label: string, href: string, marginTop = 32): string {
  return `<table role="presentation" class="btn-wrap" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px"><tr><td class="btn" bgcolor="${EMAIL.ink}" style="background-color:${EMAIL.ink};background-image:linear-gradient(135deg,${EMAIL.paper} 7px,transparent 7px)"><a href="${esc(href)}" style="display:inline-block;padding:16px 28px;${TYPE.button};color:${EMAIL.paper};text-decoration:none">${esc(label)}</a></td></tr></table>`;
}

/** A secondary action: underlined text padded to 44 px. Never a second filled button. */
export const textLink = (label: string, href: string) =>
  `<a class="link-ink" href="${esc(href)}" style="display:inline-block;padding:12px 0;line-height:20px;color:${EMAIL.ink};text-decoration:underline">${esc(label)}</a>`;

/**
 * The D-corner callout: a 40 × 4 bar, a 10 px gap, then a 4 px stem down the text, the
 * top-left corner of the D in the wordmark. Once per email, for the line that matters.
 */
export function dCorner(text: string, marginTop = 24): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px">
<tr><td class="bar" width="40" height="4" bgcolor="${EMAIL.ink}" style="width:40px;height:4px;background-color:${EMAIL.ink};font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td colspan="2" height="10" style="height:10px;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td colspan="2" class="t-ink rule-ink" style="border-left:4px solid ${EMAIL.ink};padding:0 0 0 18px;${TYPE.callout};color:${EMAIL.ink}">${esc(text)}</td></tr>
</table>`;
}

// ── The bib (welcome) ───────────────────────────────────────────────────────

const pin = `<div style="width:10px;height:10px;border-radius:5px;background-color:${EMAIL.ink};font-size:0;line-height:0">&nbsp;</div>`;
const pinRow = (pad: string) =>
  `<tr><td style="padding:${pad};font-size:0;line-height:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="10">${pin}</td><td>&nbsp;</td><td width="10">${pin}</td></tr></table></td></tr>`;

/**
 * The app's race bib as a table, so it reads with images off: paper with the app's 22 px
 * cut corner (a 15 px gradient stop in ink over a white background colour), four pin
 * holes, the ink wordmark and the label, the age as the number, the first name as written,
 * the sport pictogram (outlined, so a darkened bib keeps it readable), and the tear-off strip.
 */
export function bib(o: {
  frame: TemplateFrame;
  number: string;
  name: string | null;
  label: string;
  pictogram: { file: string; alt: string };
  next: { label: string; href: string };
}): string {
  const assets = esc(assetBase(o.frame));
  const aria = `${o.name ? `${o.name}, ` : ""}${o.label}, bib number ${o.number}`;
  // Short names sit beside the pictogram, as in the app; longer ones take the bib's full
  // width on their own line, a size down past 12 characters, so a 390 px phone never scrolls.
  const nameLength = o.name ? [...o.name].length : 0;
  const nameBeside = nameLength <= 9;
  const namePara = o.name
    ? `<p style="margin:6px 0 0;${nameLength > 12 ? TYPE.bibNameLong : TYPE.bibName};${WRAP};color:${EMAIL.ink}">${esc(o.name)}</p>`
    : "";
  return `<table role="group" aria-label="${esc(aria)}" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.paper}" style="background-color:${EMAIL.paper};background-image:linear-gradient(135deg,${EMAIL.ink} 15px,transparent 15px)">
${pinRow("12px 18px 0")}
<tr><td class="bib-pad" style="padding:10px 40px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top"><img src="${assets}/email/wordmark-ink.png" width="120" height="18" alt="D-Human" style="display:block;border:0;width:120px;height:18px;color:${EMAIL.ink};font:700 11px/18px ${FONT};letter-spacing:3px"></td>
<td valign="top" align="right" style="${TYPE.bibLabel};color:${EMAIL.ink}">${esc(o.label)}</td>
</tr></table></td></tr>
<tr><td class="bib-pad" style="padding:8px 40px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="bottom">
<p class="bib-num" aria-hidden="true" style="margin:0;${TYPE.bibNumber};color:${EMAIL.ink}">${esc(o.number)}</p>
${nameBeside ? namePara : ""}
</td>
<td valign="bottom" align="right" width="80"><img src="${assets}/email/pictograms/${esc(o.pictogram.file)}.png" width="80" height="80" alt="${esc(o.pictogram.alt)}" style="display:block;border:0;width:80px;height:80px;color:${EMAIL.ink};font:400 13px/18px ${FONT}"></td>
</tr>${o.name && !nameBeside ? `\n<tr><td colspan="2">${namePara}</td></tr>` : ""}</table></td></tr>
<tr><td class="bib-pad" style="padding:0 40px;border-top:2px dashed ${EMAIL.dash}"><a href="${esc(o.next.href)}" style="display:block;padding:14px 0 10px;font:600 15px/20px ${FONT};color:${EMAIL.ink};text-decoration:none">${esc(o.next.label)}</a></td></tr>
${pinRow("0 18px 12px")}
</table>`;
}

// ── The week (weekly wrap) ──────────────────────────────────────────────────

/** Six segments above the headline, the first filled, as at the top of a wrap in the app. */
export function storyBar(): string {
  const seg = (on: boolean) => {
    const c = on ? EMAIL.paper : EMAIL.storyOff;
    return `<td height="2" bgcolor="${c}" style="height:2px;background-color:${c};font-size:0;line-height:0">&nbsp;</td>`;
  };
  const gap = `<td width="4" style="width:4px;font-size:0;line-height:0">&nbsp;</td>`;
  const cells = [seg(true), ...Array.from({ length: 5 }, () => seg(false))].join(gap);
  return `<tr><td class="px" style="padding:0 40px 20px"><table role="presentation" aria-hidden="true" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table></td></tr>`;
}

const CHECK = `font:700 20px/20px Arial,sans-serif;color:${EMAIL.ink}`;

/**
 * The week as seven squares, Monday first. Logged: paper. Protein aim reached: serum with a
 * black check (U+2713 in Arial, so phones don't swap in an emoji). Nothing logged: a smoke
 * outline, empty, never red. Hidden from screen readers; the summary under it says the same
 * in words, whatever a mail app does to the fills.
 */
export function weekSquares(days: { logged: boolean; proteinReached: boolean }[], summary: string): string {
  const letters = ["M", "T", "W", "T", "F", "S", "S"];
  const gap = `<td width="6" style="width:6px;font-size:0;line-height:0">&nbsp;</td>`;
  const head = letters
    .map((l) => `<td align="center" style="padding-bottom:6px;${TYPE.dayLetter};color:${EMAIL.graphite}">${l}</td>`)
    .join(gap);
  const cells = letters
    .map((_, i) => {
      const d = days[i];
      if (d?.proteinReached)
        return `<td align="center" height="44" bgcolor="${EMAIL.serum}" style="height:44px;background-color:${EMAIL.serum};${CHECK}">&#10003;</td>`;
      if (d?.logged) return `<td height="44" bgcolor="${EMAIL.paper}" style="height:44px;background-color:${EMAIL.paper};font-size:0;line-height:0">&nbsp;</td>`;
      return `<td height="42" bgcolor="${EMAIL.ink}" style="height:42px;background-color:${EMAIL.ink};border:1px solid ${EMAIL.smoke};font-size:0;line-height:0">&nbsp;</td>`;
    })
    .join(gap);
  const swatch = (bg: string, check: boolean) =>
    `<td width="14" height="14" align="center" bgcolor="${bg}" style="width:14px;height:14px;background-color:${bg};${check ? `font:700 11px/14px Arial,sans-serif;color:${EMAIL.ink}` : "font-size:0;line-height:0"}">${check ? "&#10003;" : "&nbsp;"}</td>`;
  const legendText = (text: string, pad: string) =>
    `<td style="padding:${pad};font:400 13px/20px ${FONT};color:${EMAIL.paper}">${text}</td>`;
  return `<table role="presentation" aria-hidden="true" width="350" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:350px;table-layout:fixed">
<tr>${head}</tr>
<tr>${cells}</tr>
</table>
<table role="presentation" aria-hidden="true" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px"><tr>${swatch(EMAIL.serum, true)}${legendText("Protein aim reached", "0 18px 0 8px")}${swatch(EMAIL.paper, false)}${legendText("Logged", "0 0 0 8px")}</tr></table>
<p style="margin:10px 0 0;font:400 13px/20px ${FONT};color:${EMAIL.graphite}">${esc(summary)}</p>`;
}

/** The big number and its label in 700. */
export const bigStat = (value: string, label: string) =>
  `<p class="t-ink stat" style="margin:0;${TYPE.bigStat};color:${EMAIL.ink}">${esc(value)}</p>
<p class="t-ink" style="margin:12px 0 0;${TYPE.lead};color:${EMAIL.ink}">${esc(label)}</p>`;

export type Tile = { value: string; label: string; lang?: string };

const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Two small numbers, each under a 2 px rule, no boxes (the guides' facts list). A value in
 * another script carries its lang and the phone's own fonts; long values step down a size.
 */
export function statTiles(tiles: Tile[]): string {
  const tile = (t: Tile | undefined) => {
    if (!t) return `<td valign="top" width="48%" style="font-size:0;line-height:0">&nbsp;</td>`;
    const script = t.lang && LANG.test(t.lang) && !t.lang.startsWith("en");
    const long = [...t.value].length > 8;
    const type = long ? TYPE.smallStatLong : TYPE.smallStat;
    const value = script
      ? `<span lang="${esc(t.lang!)}" dir="auto" style="font-family:${SCRIPT_FONT};line-height:1.3;letter-spacing:0">${esc(t.value)}</span>`
      : esc(t.value);
    return `<td valign="top" width="48%" class="rule-ink" style="border-top:2px solid ${EMAIL.ink};padding-top:12px">
<p class="t-ink" style="margin:0;${type};color:${EMAIL.ink}">${value}</p>
<p class="t-smoke" style="margin:4px 0 0;font:400 15px/21px ${FONT};color:${EMAIL.smoke}">${esc(t.label)}</p>
</td>`;
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px"><tr>
${tile(tiles[0])}
<td width="4%" style="font-size:0;line-height:0">&nbsp;</td>
${tile(tiles[1])}
</tr></table>`;
}

// ── Answers (feedback) ──────────────────────────────────────────────────────

/**
 * Answer rows: each a full-width row with a 1 px ink border and one plain link filling it,
 * 56 px tall, 8 px apart, stacked (onboarding's square choice chip). No forms, no scripts:
 * the answer travels in the link, and the page saves it (scanners open every link).
 */
export function choices(options: { label: string; href: string }[]): string {
  const rows = options.map(
    (o) =>
      `<tr><td class="opt" style="border:1px solid ${EMAIL.ink}"><a href="${esc(o.href)}" style="display:block;padding:16px 18px;${TYPE.option};color:${EMAIL.ink};text-decoration:none">${esc(o.label)}</a></td></tr>`,
  );
  const gap = `<tr><td style="height:8px;font-size:0;line-height:0">&nbsp;</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows.join(`\n${gap}\n`)}
</table>`;
}

// ── Footer ──────────────────────────────────────────────────────────────────

export type FooterInput = {
  frame: TemplateFrame;
  /** A white line on top: the reply invitation, or the weekly email's "New:" line. */
  top?: string[];
  /** The stop link's words for this kind ("Stop weekly wraps"); null for one-off welcomes. */
  stopLabel: string | null;
  /** Why they got this email. Plain text; escaped here. */
  why: string;
  /** A sentence before the disclaimer ("Meal numbers are AI estimates…"). */
  aiNote?: string;
};

/**
 * The footer on ink: the top lines, the stop link and Email settings as separate 44 px
 * tap targets (never dot-separated), why they got it, the disclaimer, and the postal
 * address when one is set. Returns the HTML row and the plain-text lines.
 */
export function footer(o: FooterInput): { html: string; text: string[] } {
  const { frame } = o;
  if (o.stopLabel && !frame.stopUrl) throw new Error(`email footer: "${o.stopLabel}" needs frame.stopUrl`);
  const settings = link(frame, frame.settingsUrl);
  const stop = o.stopLabel && frame.stopUrl ? link(frame, frame.stopUrl) : null;
  const address = postalAddress(frame);
  const disclaimer = `${o.aiNote ? `${o.aiNote} ` : ""}${DISCLAIMER}`;
  const footLink = (label: string, href: string, color: string, gap: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:12px 0;${gap ? "margin-right:24px;" : ""}line-height:20px;color:${color};text-decoration:underline">${esc(label)}</a>`;

  const paras = [
    ...(o.top ?? []).map((t) => ({ html: esc(t), style: `font-size:15px;line-height:22px;color:${EMAIL.paper}` })),
    {
      html: [stop && o.stopLabel ? footLink(o.stopLabel, stop, EMAIL.paper, true) : "", footLink("Email settings", settings, EMAIL.graphite, false)].join(""),
      style: "",
    },
    { html: brandify(esc(o.why)), style: "" },
    { html: brandify(esc(disclaimer)), style: "" },
    ...(address ? [{ html: `${BRAND}, ${esc(address)}`, style: "" }] : []),
  ];
  const html = `<tr><td class="px" style="padding:32px 40px 48px;${TYPE.footer};color:${EMAIL.graphite}">
${paras.map((p, i) => `<p style="margin:0 0 ${i === paras.length - 1 ? 0 : 12}px${p.style ? `;${p.style}` : ""}">${p.html}</p>`).join("\n")}
</td></tr>`;

  const text = [
    "---",
    ...(o.top ?? []),
    ...(stop && o.stopLabel ? [`${o.stopLabel}: ${stop}`] : []),
    `Email settings: ${settings}`,
    "",
    o.why,
    disclaimer,
    ...(address ? [`D-Human, ${address}`] : []),
  ];
  return { html, text };
}

/** Keep "D-Human" whole on narrow screens, in already-escaped text. */
export const brandify = (escaped: string) => escaped.replace(/D-Human/g, BRAND);

// ── Plain text ──────────────────────────────────────────────────────────────

/** Joins sections with blank lines and drops empty ones. */
export const textOf = (sections: (string | string[] | null | false | undefined)[]) =>
  sections
    .filter((s): s is string | string[] => Boolean(s) && (!Array.isArray(s) || s.length > 0))
    .map((s) => (Array.isArray(s) ? s.join("\n") : s))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
