import type { MetadataRoute } from "next";
import { SPOKEN } from "@/lib/domain/speech";
import { isWaitlist } from "@/lib/site-mode";

// Lets phones add D-Human to the home screen as a full-screen web app.
// Same copy rules as lib/seo.ts: "Free to start", no price.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "D-Human",
    short_name: "D-Human",
    description: isWaitlist
      ? "Test first. Supplement second. Join the D-Human waitlist."
      : `Track calories and protein in Indian meals in ${SPOKEN.length} languages, see your weekly Wraps, and let AI read your blood report. Free to start.`,
    lang: "en-IN",
    categories: ["health", "food", "fitness"],
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The D sits inside the central safe zone, so the same artwork works when masked to a circle.
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
