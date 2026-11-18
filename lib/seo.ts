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
import { HISTORY_DAYS } from "./domain/meals.ts";
import { PLAN } from "./domain/plan.ts";
import { SPOKEN } from "./domain/speech.ts";
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
    updated: "2026-11-18",
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
    updated: "2026-11-17",
  },
  {
    path: "/sources-and-safety",
    label: "Sources and safety",
    crumb: "Sources and safety",
    blurb: "Where the numbers come from, and the rules the AI can't break.",
    updated: "2026-11-18",
  },
] as const;

export type GuidePath = (typeof GUIDES)[number]["path"];
export const guide = (path: GuidePath) => GUIDES.find((g) => g.path === path)!;

/** The landing page's own last change, for the sitemap. 2026-11-18: description and app markup. */
export const HOME_UPDATED = "2026-11-18";

// The landing page's title and description. Waitlist mode keeps the words it always had.
// Open mode: the brand first (people who heard the name search it), then the two jobs
// people search for, inside about 60 characters so results pages show it whole.
// The description adds what the title doesn't say. Phones show about its first 135
// characters, so the order is: how you log, the languages, Wraps, then the blood report
// and supplements. Copy rules: "Free to start" (never "free" alone), no price, no
// "accurate", and reads are AI-analysed, never reviewed by a doctor.
export const HOME_TITLE = isWaitlist ? "D-Human | Your body speaks data" : "D-Human | Indian calorie tracker and AI blood report reads";
export const HOME_DESCRIPTION = isWaitlist
  ? "Test first. Supplement second. D-Human tests your blood, gut and body, analyses the results with AI, and recommends supplements only where your markers point. Join the waitlist."
  : `Track calories and protein in Indian meals by photo, voice or text, in Hindi and ${SPOKEN.length - 1} more languages, with weekly Wraps. AI reads your blood report; supplements only where markers point. Free to start.`;

/**
 * The signed-in app and the API. robots.txt disallows each as a prefix, so a public
 * page must never start with one (tests/seo.test.ts checks). /signin stays crawlable
 * on purpose: it's linked from every page and says noindex, which crawlers can
 * only see if they may fetch it.
 */
export const APP_PATHS = ["/api/", "/home", "/fuel", "/upload", "/reports", "/stack", "/wraps", "/settings", "/onboarding", "/dev/"] as const;

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

const listed = (names: readonly string[]) => `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * What the app does, one feature a line, for search engines and AI answers. Every line is
 * true of the app today (each names the code it comes from), and none is coming soon.
 * Wraps and Past meals aren't on the landing page yet: give them a line there (the Fuel
 * slide) so the markup and the page say the same things.
 */
export const APP_FEATURES: readonly string[] = [
  // lib/ai/food.ts, lib/domain/food-table.ts
  "Calorie and protein tracking for Indian meals, counted in Indian household portions",
  "Log a meal by photo, by voice or in a few typed words",
  // lib/domain/speech.ts
  `Meal logging in ${SPOKEN.length} languages: ${listed(SPOKEN.map((s) => s.name))}`,
  // lib/domain/nutrition.ts
  "Daily calorie and protein targets set for your body and training, with vitamins and minerals against ICMR-NIN 2020 allowances",
  "Food gaps from two weeks of meals, or from a usual day described once",
  // lib/domain/meals.ts, components/platform/PastMeals.tsx
  `Past meals: the ${HISTORY_DAYS} days before today, day by day`,
  // lib/ai/wrap.ts
  "Weekly, monthly and yearly Wraps: a short story of what you ate and what moved",
  // lib/platform/analyze.ts, lib/domain/safety.ts
  "AI-analysed blood report reads in plain words, from a PDF or photos, in English, Hindi or Hinglish, aimed at how you train. Not a diagnosis.",
  // lib/domain/supplements.ts, lib/domain/budget.ts
  "A supplement stack only where a blood marker or a food gap points, with doses, cautions and food first, fitted to a monthly budget",
  "A retest date from your read, to see what moved",
];

/**
 * The app and its free start, as the landing page's Start free form states it. Open mode only.
 * No pass price: the landing page doesn't show it, and structured data must match the page.
 */
export function appLd(): Json {
  return {
    "@type": "WebApplication",
    "@id": ids.app(),
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: `Calorie and protein tracking for Indian meals by photo, voice or text in ${SPOKEN.length} languages, with weekly, monthly and yearly Wraps. AI-analysed reads of blood test reports, and supplements only where a marker or a food gap points.`,
    featureList: APP_FEATURES,
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
        description: "Blood report reads and calorie and protein tracking to start, with just an email.",
      },
    ],
  };
}

/** The landing page's graph: who we are, the site, and (open mode) the app with its free start. */
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
