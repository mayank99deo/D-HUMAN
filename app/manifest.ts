import type { MetadataRoute } from "next";

// Lets phones add D-Human to the home screen as a full-screen web app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "D-Human",
    short_name: "D-Human",
    description: "Test first. Supplement second. Join the D-Human waitlist.",
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
