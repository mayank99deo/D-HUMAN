// The welcome email sent when someone joins the waitlist. Built for email
// clients: tables, inline styles, web-safe fallbacks for the Archivo face,
// and a layout that still reads when images are blocked.

type Options = {
  email: string;
  /** Public https URL of the site, used for links. */
  siteUrl?: string;
  /** Where images load from. Defaults to siteUrl; the preview page passes its own origin. */
  assetUrl?: string;
  /** Set when replies reach a real inbox, so the email can invite them. */
  canReply?: boolean;
};

const INK = "#000000";
const PAPER = "#ffffff";
const GRAPHITE = "#8c8c8c";
const SMOKE = "#5c5c5c";
const RULE = "#d4d4d4";
const FONT = "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif";

const STEPS = [
  ["Test", "Blood, urine, gut and more. Most of it from home."],
  ["Read", "A doctor-reviewed report in plain words."],
  ["Stack", "Supplements matched to your markers, from clean-label brands."],
  ["Retest", "Key markers again at 3–4 months, to show what moved."],
] as const;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Keeps narrow screens from breaking the name at its hyphen.
const BRAND = `<span style="white-space:nowrap">D-Human</span>`;

export function welcomeEmail({ email, siteUrl, assetUrl = siteUrl, canReply = false }: Options) {
  const site = siteUrl?.replace(/\/$/, "");
  const assets = assetUrl?.replace(/\/$/, "");
  const host = site?.replace(/^https?:\/\//, "");
  const share = site
    ? `https://wa.me/?text=${encodeURIComponent(
        `I just joined the D-Human waitlist. Test first, supplement second: ${site}`,
      )}`
    : null;

  const wordmark = assets
    ? `<img src="${assets}/brand/wordmark-white.png" width="168" height="15" alt="D-Human" style="display:block;border:0;width:168px;height:15px">`
    : `<span style="font:700 16px/1 ${FONT};letter-spacing:6px;color:${PAPER}">D-HUMAN</span>`;

  const steps = STEPS.map(([title, body], i) => {
    // The heading's rule already sits above the first step.
    const rule = i === 0 ? "" : `border-top:1px solid ${RULE};`;
    return `
              <tr>
                <td valign="top" width="56" style="padding:20px 0;${rule}font:800 30px/30px ${FONT};font-stretch:125%;color:${INK}">${i + 1}</td>
                <td valign="top" style="padding:20px 0;${rule}font:16px/24px ${FONT};color:${SMOKE}">
                  <strong style="display:block;font-size:18px;line-height:24px;color:${INK}">${title}</strong>${body}
                </td>
              </tr>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
    <title>You're on the D-Human waitlist</title>
    <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&display=swap" rel="stylesheet">
    <style>
      :root { color-scheme: light only; }
      body { margin: 0; padding: 0; background: ${INK}; }
      @media (max-width: 620px) {
        .px { padding-left: 24px !important; padding-right: 24px !important; }
        .headline { font-size: 36px !important; line-height: 38px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${INK}">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">You're on the list. Here is what happens next.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${INK}" style="background:${INK}">
      <tr>
        <td align="center" style="padding:0 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">

            <tr><td class="px" style="padding:40px 40px 48px">${wordmark}</td></tr>

            <tr>
              <td class="px headline" style="padding:0 40px;font:800 48px/50px ${FONT};font-stretch:118%;letter-spacing:-0.5px;color:${PAPER}">
                You're on<br>the list.
              </td>
            </tr>
            <tr>
              <td class="px" style="padding:18px 40px 36px;font:500 18px/26px ${FONT};color:${GRAPHITE}">
                Your body speaks data.<br><span style="white-space:nowrap;color:${PAPER}">Hear it. Use it. Own it.</span>
              </td>
            </tr>

            ${
              assets
                ? `<tr><td bgcolor="${INK}" style="line-height:0;font-size:0"><img src="${assets}/brand/email-header.jpg" width="600" alt="" style="display:block;border:0;width:100%;max-width:600px;height:auto"></td></tr>`
                : ""
            }

            <tr>
              <td bgcolor="${PAPER}" class="px" style="background:${PAPER};padding:40px">
                <p style="margin:0 0 32px;font:17px/27px ${FONT};color:${INK}">
                  Thanks for joining. When early access opens, you'll hear from us first, along with
                  pricing for the Baseline, Core and Complete plans.
                </p>

                <p style="margin:0;padding-top:20px;border-top:2px solid ${INK};font:700 14px/20px ${FONT};color:${INK}">How D-Human works</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${steps}
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px">
                  <tr>
                    <td style="border-left:3px solid ${INK};padding:4px 0 4px 18px;font:700 19px/27px ${FONT};font-stretch:112%;color:${INK}">
                      We recommend a supplement only when a marker points to it. No test result, no pitch.
                    </td>
                  </tr>
                </table>

                ${
                  share
                    ? `<p style="margin:40px 0 16px;font:16px/24px ${FONT};color:${SMOKE}">Know someone who buys supplements blind? Send them the waitlist.</p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td bgcolor="${INK}" style="background:${INK}">
                      <a href="${share}" style="display:inline-block;padding:15px 26px;font:600 16px/20px ${FONT};color:${PAPER};text-decoration:none">Share on WhatsApp</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font:14px/20px ${FONT};color:${SMOKE}">Or send them to <a href="${site}" style="color:${INK}">${escapeHtml(host ?? "")}</a></p>`
                    : ""
                }
              </td>
            </tr>

            <tr>
              <td class="px" style="padding:32px 40px 48px;font:12px/19px ${FONT};color:${GRAPHITE}">
                ${canReply ? `<p style="margin:0 0 12px;color:${PAPER};font-size:14px;line-height:21px">Questions? Reply to this email. It reaches the founding team.</p>` : ""}
                <p style="margin:0">
                  You're getting this because ${escapeHtml(email)} joined the ${BRAND} waitlist${host ? ` at <a href="${site}" style="color:${GRAPHITE}">${escapeHtml(host)}</a>` : ""}.
                  ${BRAND} offers wellness guidance and screening. It does not diagnose or treat any condition.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "You're on the list.",
    "Your body speaks data. Hear it. Use it. Own it.",
    "",
    "Thanks for joining. When early access opens, you'll hear from us first, along with pricing for the Baseline, Core and Complete plans.",
    "",
    "How D-Human works",
    ...STEPS.map(([title, body], i) => `${i + 1}. ${title}. ${body}`),
    "",
    "We recommend a supplement only when a marker points to it. No test result, no pitch.",
    ...(share ? ["", `Know someone who buys supplements blind? Share the waitlist: ${site}`] : []),
    ...(canReply ? ["", "Questions? Reply to this email. It reaches the founding team."] : []),
    "",
    `You're getting this because ${email} joined the D-Human waitlist${host ? ` at ${host}` : ""}.`,
    "D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.",
  ].join("\n");

  return { html, text };
}
