// Search: the public pages, their metadata and their structured data, in one place.
// Pure (no Next or React imports beyond types), so tests can import it.
//
// Rules this file keeps:
// - One canonical URL per page, on the canonical host (lib/site-url.ts).
// - Structured data only describes what the page shows. FAQ markup comes from the
//   same array the page renders, so the two can't drift.
// - The signed-in app stays out of search: robots.txt disallows APP_PATHS, and its
//   layouts say noindex. No public page may start with one of those prefixes.

import type { Metadata } from "next";
import { PASS_DETAIL, PLAN, PRICE_TEXT } from "./domain/plan.ts";
import { isWaitlist } from "./site-mode.ts";
import { absoluteUrl } from "./site-url.ts";

export const SITE_NAME = "D-Human";
/** How people type the name without the hyphen; helps search engines show "D-Human" as the site name. */
const ALTERNATE_NAMES = ["DHuman", "D Human"];

/** The guides: one page per search intent. Order is the order in footers and "related" lists. */
export const GUIDES = [
  {
    path: "/calorie-tracker",
    label: "Calorie tracker for Indian food",
    crumb: "Calorie tracker",
    blurb: "Snap, say or type a meal in 12 languages.",
    updated: "2026-11-13",
  },
  {
    path: "/protein-tracker",
    label: "Protein tracker and daily needs",
    crumb: "Protein tracker",
    blurb: "How much protein you need, by weight and training.",
    updated: "2026-11-13",
  },
  {
    path: "/blood-report-analysis",
    label: "Blood test report analysis",
    crumb: "Blood report analysis",
    blurb: "Upload a lab report, get a read in plain words.",
    updated: "2026-11-13",
  },
  {
    path: "/supplements-from-blood-test",
    label: "Supplements from your blood test",
    crumb: "Supplements from your blood test",
    blurb: "Only what a marker or a food gap points to.",
    updated: "2026-11-13",
  },
  {
    path: "/sources-and-safety",
    label: "Sources and safety",
    crumb: "Sources and safety",
    blurb: "Where the numbers come from, and the rules the AI can't break.",
    updated: "2026-11-13",
  },
] as const;

export type GuidePath = (typeof GUIDES)[number]["path"];
export const guide = (path: GuidePath) => GUIDES.find((g) => g.path === path)!;

/** The landing page's own last change, for the sitemap. */
export const HOME_UPDATED = "2026-11-13";

// The landing page's title and description. Waitlist mode keeps the words it always had.
// Open mode: the brand first (people who heard the name search it), then the two jobs
// people search for, inside about 60 characters so results pages show it whole.
export const HOME_TITLE = isWaitlist ? "D-Human | Your body speaks data" : "D-Human | Indian calorie tracker and AI blood report reads";
export const HOME_DESCRIPTION = isWaitlist
  ? "Test first. Supplement second. D-Human tests your blood, gut and body, analyses the results with AI, and recommends supplements only where your markers point. Join the waitlist."
  : "Track calories and protein in Indian meals by photo, voice or text, in 12 languages. Upload a blood report and AI reads it for how you train. Start free.";

/**
 * The signed-in app and the API. robots.txt disallows each as a prefix, so a public
 * page must never start with one (tests/seo.test.ts checks). /signin stays crawlable
 * on purpose: it's linked from every page and says noindex, which crawlers can
 * only see if they may fetch it.
 */
export const APP_PATHS = ["/api/", "/home", "/fuel", "/upload", "/reports/", "/stack", "/wraps", "/settings", "/onboarding", "/dev/"] as const;

// ── Metadata ─────────────────────────────────────────────────────────────

/**
 * Title, description, canonical URL and share tags for a public page. Relative
 * URLs resolve against metadataBase (app/layout.tsx), which is the canonical host
 * in production. The share image comes from app/opengraph-image.png.
 */
export function pageMetadata({ path, title, description }: { path: string; title: string; description: string }): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: SITE_NAME, locale: "en_IN", type: "website", images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [SHARE_IMAGE] },
  };
}

/**
 * app/opengraph-image.png. Next adds it by itself only to the page in its own folder;
 * a page that sets its own share tags has to name it. Keep the alt text in step with
 * app/opengraph-image.alt.txt.
 */
const SHARE_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "D-Human: Your body speaks data. Hack your health.",
};

// ── Structured data (schema.org JSON-LD) ─────────────────────────────────

type Json = { [key: string]: unknown };

const ids = {
  org: () => `${absoluteUrl("/")}#organization`,
  site: () => `${absoluteUrl("/")}#website`,
  app: () => `${absoluteUrl("/")}#app`,
};

export function organizationLd(): Json {
  return {
    "@type": "Organization",
    "@id": ids.org(),
    name: SITE_NAME,
    alternateName: ALTERNATE_NAMES,
    url: absoluteUrl("/"),
    logo: { "@type": "ImageObject", url: absoluteUrl("/icons/icon-512.png"), width: 512, height: 512 },
  };
}

export function websiteLd(): Json {
  return {
    "@type": "WebSite",
    "@id": ids.site(),
    name: SITE_NAME,
    alternateName: ALTERNATE_NAMES,
    url: absoluteUrl("/"),
    inLanguage: "en-IN",
    publisher: { "@id": ids.org() },
  };
}

/** The app with its two prices, as the landing page's Start free form states them. Open mode only. */
export function appLd(): Json {
  return {
    "@type": "WebApplication",
    "@id": ids.app(),
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description:
      "Calorie and protein tracking for Indian meals by photo, voice or text in 12 languages, and AI-analysed reads of blood test reports.",
    applicationCategory: "HealthApplication",
    operatingSystem: "Any (runs in a web browser)",
    inLanguage: "en-IN",
    publisher: { "@id": ids.org() },
    offers: [
      {
        "@type": "Offer",
        name: "Free start",
        price: "0",
        priceCurrency: PLAN.currency,
        description: `${PLAN.freeReads} report reads and ${PLAN.freeMeals} meal logs.`,
      },
      {
        "@type": "Offer",
        name: `${PLAN.days}-day pass`,
        price: String(PLAN.pricePaise / 100),
        priceCurrency: PLAN.currency,
        description: `${PRICE_TEXT} for ${PLAN.days} days: ${PASS_DETAIL}`,
      },
    ],
  };
}

/** The landing page's graph: who we are, the site, and (open mode) the app with its prices. */
export function homeLd(): Json {
  return {
    "@context": "https://schema.org",
    "@graph": isWaitlist ? [organizationLd(), websiteLd()] : [organizationLd(), websiteLd(), appLd()],
  };
}

export type Faq = { q: string; a: string };

/** A guide's graph: the page (an FAQ page when it shows questions) and its breadcrumbs. */
export function guideLd({ path, name, description, faqs }: { path: GuidePath; name: string; description: string; faqs?: Faq[] }): Json {
  const url = absoluteUrl(path);
  const g = guide(path);
  const page: Json = {
    "@type": faqs?.length ? "FAQPage" : "WebPage",
    "@id": `${url}#page`,
    url,
    name,
    description,
    inLanguage: "en-IN",
    dateModified: g.updated,
    isPartOf: { "@id": ids.site() },
    publisher: { "@id": ids.org() },
    breadcrumb: { "@id": `${url}#breadcrumb` },
  };
  if (faqs?.length) {
    page.mainEntity = faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }));
  }
  return {
    "@context": "https://schema.org",
    "@graph": [
      page,
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: g.crumb, item: url },
        ],
      },
    ],
  };
}

/** JSON for a <script type="application/ld+json">, with "<" escaped so text can't close the tag. */
export const ldJson = (data: Json) => JSON.stringify(data).replace(/</g, "\\u003c");
