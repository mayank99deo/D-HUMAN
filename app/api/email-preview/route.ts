import { renderEmail } from "@/lib/email/templates";
import { emailSamples } from "@/lib/email/templates/samples";
import { siteUrl } from "@/lib/site-url";
import { welcomeEmail } from "@/lib/waitlist/welcome-email";

// Development only (404 in production). Every email and variant with sample data:
//   /api/email-preview                         the list, with subjects, preheaders and sizes
//   /api/email-preview?kind=weekly-light       one email as HTML (ids from the list)
//   /api/email-preview?kind=weekly-light&format=text   its plain-text part
//   /api/email-preview?kind=waitlist           the waitlist welcome
// Dark mode: switch the browser or DevTools to prefers-color-scheme: dark (Apple Mail's view).
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const origin = url.origin;
  const site = siteUrl() ?? origin;
  const kind = url.searchParams.get("kind");
  const asText = url.searchParams.get("format") === "text";

  if (kind === "waitlist") {
    const email = welcomeEmail({
      email: "you@example.com",
      siteUrl: site,
      assetUrl: origin,
      canReply: Boolean(process.env.RESEND_REPLY_TO),
    });
    return asText ? plain(email.text) : html(email.html);
  }

  // Images load from this server, so new files in public/email show before they're deployed.
  const samples = emailSamples(site, origin);
  const sample = kind ? samples.find((s) => s.id === kind) : undefined;
  if (kind && !sample) return new Response("No such sample", { status: 404 });
  if (sample) {
    const email = renderEmail(sample.email, sample.frame);
    return asText ? plain(`Subject: ${email.subject}\nPreheader: ${email.preheader}\n\n${email.text}`) : html(email.html);
  }

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = samples
    .map((s) => {
      const email = renderEmail(s.email, s.frame);
      const kb = (Buffer.byteLength(email.html) / 1024).toFixed(1);
      const href = `?kind=${encodeURIComponent(s.id)}`;
      return `<tr><td><a href="${href}">${esc(s.title)}</a><br><a href="${href}&amp;format=text">Plain text</a></td><td>${esc(email.subject)}<br><span>${esc(email.preheader)}</span></td><td>${kb} KB</td></tr>`;
    })
    .join("\n");
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email preview</title>
<style>body{margin:0;padding:24px 16px;background:#000;color:#fff;font:15px/22px Helvetica,Arial,sans-serif}a{color:#fff;display:inline-block;padding:6px 0}table{border-collapse:collapse;width:100%;max-width:1100px}td{vertical-align:top;padding:12px 16px 12px 0;border-top:1px solid #333}span{color:#8c8c8c}h1{font-size:24px;margin:0 0 16px}</style></head>
<body><h1>Email preview</h1><p><a href="?kind=waitlist">Waitlist welcome</a></p><table>${rows}</table></body></html>`);
}

const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const plain = (body: string) => new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
