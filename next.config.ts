import type { NextConfig } from "next";
import { SESSION_COOKIE } from "./lib/auth/cookie.ts";
import { LEGACY_HOSTS, SITE_ORIGIN } from "./lib/site-url.ts";

// Page requests on any other host that serves this deployment go to the canonical
// host (lib/site-url.ts) with a 308, path and query kept, so search engines see one
// site instead of four copies. Left alone: /api (open tabs, the Google Apps Script
// and payment webhooks call it on whatever host they were given), /_next (assets of
// pages already open) and /_vercel (analytics). The host value is a regex, anchored
// by Next, so its dots are escaped.
const HOST_REDIRECT_SOURCE = "/:path((?!(?:api|_next|_vercel)(?:/|$)).*)";
const hostRedirects = LEGACY_HOSTS.map((host) => ({
  source: HOST_REDIRECT_SOURCE,
  has: [{ type: "host" as const, value: host.replace(/\./g, "\\.") }],
  destination: `${SITE_ORIGIN}/:path`,
  permanent: true,
}));

// Someone signed in on this browser who comes back to the landing page goes straight
// to their home screen. Matched on the cookie at Vercel's routing layer, so the landing
// page stays static for everyone else and no function runs. 307, so browsers don't keep
// it: after signing out (the cookie is deleted) the landing page shows again. A cookie
// whose session is gone lands on /signin, as /home sends anyone signed out there.
// After the host redirects, so other hosts first move to the canonical one.
const signedInRedirect = {
  source: "/",
  has: [{ type: "cookie" as const, key: SESSION_COOKIE }],
  destination: "/home",
  permanent: false,
};

const nextConfig: NextConfig = {
  cacheComponents: true,
  async redirects() {
    return [...hostRedirects, signedInRedirect];
  },
  partialPrefetching: true,
  // The embedded dev database ships WebAssembly that has to load from node_modules.
  serverExternalPackages: ["@electric-sql/pglite"],
  // ...which production never uses (it has DATABASE_URL), so it stays out of every
  // deployed function: it was 62 of the 65 MB each one shipped, slowing cold starts.
  outputFileTracingExcludes: { "/*": ["node_modules/@electric-sql/pglite/**/*", ".data/**/*"] },
  // Baseline security headers for every page and API route. Camera and microphone
  // stay allowed for this site only: Fuel uses them for meal photos and voice.
  // Payment is allowed for Razorpay's checkout frame (the ₹49 pass).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: 'camera=(self), microphone=(self), geolocation=(), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")' },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
