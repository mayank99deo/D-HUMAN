import { siteUrl } from "@/lib/site-url";
import { welcomeEmail } from "@/lib/waitlist/welcome-email";

// Development only: open /api/email-preview to see the welcome email in a browser.
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });

  const origin = new URL(request.url).origin;
  const { html } = welcomeEmail({
    email: "you@example.com",
    siteUrl: siteUrl() ?? origin,
    assetUrl: origin,
    canReply: Boolean(process.env.RESEND_REPLY_TO),
  });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
