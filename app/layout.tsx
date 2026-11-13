import type { Metadata, Viewport } from "next";
import { Anek_Devanagari, Archivo } from "next/font/google";
import { Suspense } from "react";
import { Vitals } from "@/components/Vitals";
import { HOME_DESCRIPTION, HOME_TITLE } from "@/lib/seo";
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

// The landing page's words are the default for every page (lib/seo.ts). Public pages set
// their own title, description and canonical URL; the app's pages set noindex.
const title = HOME_TITLE;
const description = HOME_DESCRIPTION;

export const metadata: Metadata = {
  // The canonical host in production (lib/site-url.ts), so canonical tags, share
  // images and og:url all point at https://www.d-human.fit whichever host served the page.
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
