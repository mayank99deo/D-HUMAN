import type { Metadata } from "next";

// /write: where the founders write the blog. Kept out of search (robots.txt disallows it
// too, through APP_PATHS in lib/seo.ts) and outside the app's shell, so writers needn't
// finish the app's onboarding. Every page checks the writer on the server.
export const metadata: Metadata = {
  title: { default: "Write", template: "%s | Write | D-Human" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function WriteLayout({ children }: LayoutProps<"/write">) {
  return children;
}
