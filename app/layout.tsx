import type { Metadata, Viewport } from "next";
import { Anek_Devanagari, Archivo } from "next/font/google";
import { Suspense } from "react";
import { Vitals } from "@/components/Vitals";
import { isWaitlist } from "@/lib/site-mode";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

// Hindi reads only. Not preloaded: the browser fetches the Devanagari file only
// when a page shows Devanagari text, so English pages don't pay for it.
const devanagari = Anek_Devanagari({
  subsets: ["devanagari"],
  axes: ["wdth"],
  variable: "--font-devanagari",
  display: "swap",
  preload: false,
});

const description = isWaitlist
  ? "Test first. Supplement second. D-Human tests your blood, gut and body, analyses the results with AI, and recommends supplements only where your markers point. Join the waitlist."
  : "Track calories and protein in Indian meals from a photo, your voice or a few words, in English, Hindi or Hinglish. Add a blood report and D-Human's AI reads it for the way you train. Start free.";

// Waitlist mode keeps its old title; the open site leads with calorie tracking.
const title = isWaitlist ? "D-Human | Your body speaks data" : "D-Human | Calorie tracking for Indian meals";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl() ?? "http://localhost:3000"),
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: "D-Human",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  // Home-screen web app on iPhone: own title, black status bar.
  appleWebApp: {
    capable: true,
    title: "D-Human",
    statusBarStyle: "black",
  },
  // Stops iOS turning numbers like "2.2 lakh" or "+91" into phone links.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${archivo.variable} ${devanagari.variable}`} data-scroll-behavior="smooth">
      <body>
        {children}
        {/* It reads the URL, so it waits in its own Suspense boundary instead of holding up the page. */}
        <Suspense fallback={null}>
          <Vitals />
        </Suspense>
      </body>
    </html>
  );
}
