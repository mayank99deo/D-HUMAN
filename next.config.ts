import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The embedded dev database ships WebAssembly that has to load from node_modules.
  serverExternalPackages: ["@electric-sql/pglite"],
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
