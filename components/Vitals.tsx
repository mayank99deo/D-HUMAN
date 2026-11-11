"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";

// Vercel Speed Insights (enabled for this project in Vercel). Report and food URLs
// carry ids and query strings; strip them so only the page's shape leaves the browser.
const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function scrub(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    u.pathname = u.pathname.replace(ID, "[id]");
    return u.toString();
  } catch {
    return url.split("?")[0].replace(ID, "[id]");
  }
}

export function Vitals() {
  return <SpeedInsights beforeSend={(event) => ({ ...event, url: scrub(event.url) })} />;
}
