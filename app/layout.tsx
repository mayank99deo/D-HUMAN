import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const description =
  "Test first. Supplement second. D-Human tests your blood, gut and body, has a doctor review the results, and recommends supplements only where your markers point. Join the waitlist.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl() ?? "http://localhost:3000"),
  title: "D-Human | Your body speaks data",
  description,
  openGraph: {
    title: "D-Human | Your body speaks data",
    description,
    siteName: "D-Human",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "D-Human | Your body speaks data",
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
    <html lang="en-IN" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
