// Search: the public pages, their metadata and their structured data, in one place.
// Pure (no Next or React imports beyond types), so tests can import it.
//
// Rules this file keeps:
// - One canonical URL per page, on the canonical host (lib/site-url.ts).
// - Structured data only describes what the page shows. FAQ markup comes from the
//   same array the page renders, so the two can't drift.
// - The signed-in app stays out of search: robots.txt disallows APP_PATHS, and its
//   layouts say noindex. No public page may start with one of those prefixes.

import type { Metadata, MetadataRoute } from "next";
import { SHARE_IMAGE_SIZES, imagePath, type BlogTopic, type LiveImage, type LivePost, type PostSummary, type PublicAuthor } from "./blog/types.ts";
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
 * only see if they may fetch it. /write is the blog's editor; /email/stop and /feedback are
 * pages opened from lifecycle emails, personal to whoever got the email. Not all of /email/:
 * the emails' own images live in public/email/, and mail apps' image proxies may obey robots.
 */
export const APP_PATHS = [
  "/api/",
  "/home",
  "/fuel",
  "/upload",
  "/reports",
  "/stack",
  "/wraps",
  "/settings",
  "/onboarding",
  "/dev/",
  "/write",
  "/email/stop",
  "/feedback",
] as const;

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

// ── Blog ─────────────────────────────────────────────────────────────────
// Addresses, topic hubs, metadata, structured data, the sitemap's blog entries and the feed.
// Everything here takes posts from lib/blog/registry.ts as arguments, so the pages, sitemap,
// feed and markup all list the same posts and can't drift (and tests can pass in their own).

export const BLOG_PATH = "/blog";
export const BLOG_TITLE = "The D-Human blog";
export const BLOG_DESCRIPTION =
  "Food, blood tests and preventive health, for how India eats and trains. Written by the people building D-Human.";
export const BLOG_FEED_PATH = "/blog/rss.xml";
/** Posts a list page shows before "Older posts" (the SEO lead's /blog/page/2 starts past 30). */
export const BLOG_PER_PAGE = 30;
/** A topic hub with fewer posts is thin: noindex, follow, and out of the sitemap. */
export const HUB_MIN_POSTS = 3;
export const EDITORIAL_PATH = "/editorial-policy";
/** The editorial policy's last real change, for the sitemap and its page. */
export const EDITORIAL_UPDATED = "2026-11-19";
/** Where readers report an error in a post. Both inboxes are read (Mayank, 2026-11-19). */
export const CORRECTIONS_EMAILS = ["hello@dhuman.fit", "mayank99deo@gmail.com"] as const;
export const CORRECTIONS_EMAIL = CORRECTIONS_EMAILS[0];

export const postPath = (slug: string) => `${BLOG_PATH}/${slug}`;
export const topicPath = (topic: BlogTopic) => `${BLOG_PATH}/topics/${topic}`;
export const teamPath = (slug: string) => `/team/${slug}`;
export const blogPagePath = (page: number) => (page <= 1 ? BLOG_PATH : `${BLOG_PATH}/page/${page}`);

/**
 * The five topic hubs (SEO plan §4.3), each tied to the guide it links up to. The intros are
 * placeholders until a person writes the 100 to 200 words each hub needs; hubs stay noindex
 * until they reach HUB_MIN_POSTS posts anyway.
 */
export const BLOG_TOPIC_INFO: Record<BlogTopic, { label: string; guides: readonly GuidePath[]; intro: string }> = {
  calories: {
    label: "Calories and Indian food",
    guides: ["/calorie-tracker"],
    intro: "Counting calories in the food India actually eats: rotis, dal, rice, sabzi and thalis, in household portions.",
  },
  protein: {
    label: "Protein",
    guides: ["/protein-tracker"],
    intro: "How much protein a day, where it comes from on an Indian plate, and how to reach it without guesswork.",
  },
  "blood-tests": {
    label: "Blood tests",
    guides: ["/blood-report-analysis"],
    intro: "What the markers on a blood report measure, how ranges work, and when a result is worth showing a doctor.",
  },
  supplements: {
    label: "Supplements",
    guides: ["/supplements-from-blood-test"],
    intro: "Why to test before buying a supplement, and why food comes first when a marker or a food gap points somewhere.",
  },
  training: {
    label: "Training and sport",
    guides: ["/calorie-tracker", "/blood-report-analysis"],
    intro: "Eating and testing for training, from a first 5 km to a marathon or a lifting block.",
  },
};

const RSS_ALTERNATE = { "application/rss+xml": [{ url: BLOG_FEED_PATH, title: BLOG_TITLE }] };
/** Google Discover shows large images only with this; the app's own noindex still wins there. */
const INDEX_LARGE_IMAGES = { index: true, follow: true, "max-image-preview": "large" } as const;

/** A blog list or team page. Thin pages (an empty hub, an author with no posts) say noindex, follow. */
export function blogPageMetadata({ path, title, description, index = true }: { path: string; title: string; description: string; index?: boolean }): Metadata {
  const base = pageMetadata({ path, title, description });
  return {
    ...base,
    alternates: { canonical: path, types: RSS_ALTERNATE },
    robots: index ? INDEX_LARGE_IMAGES : { index: false, follow: true },
  };
}

/** The post's link preview: its own share image (drawn at Publish), else the site's. */
function postShareImages(post: Pick<LivePost, "title" | "share">) {
  if (!post.share) return [SHARE_IMAGE];
  const { width, height } = SHARE_IMAGE_SIZES.og;
  return [{ url: imagePath(post.share.imageId, post.share.files.og), width, height, type: "image/jpeg", alt: post.title }];
}

const postTitle = (post: Pick<LivePost, "title" | "seoTitle">) => `${post.seoTitle?.trim() || post.title} | ${SITE_NAME}`;
const postDescription = (post: Pick<LivePost, "dek" | "seoDescription">) => post.seoDescription.trim() || post.dek;

export function postMetadata(post: LivePost): Metadata {
  const path = postPath(post.slug);
  const title = postTitle(post);
  const description = postDescription(post);
  const images = postShareImages(post);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path, types: RSS_ALTERNATE },
    robots: INDEX_LARGE_IMAGES,
    openGraph: {
      type: "article",
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: "en_IN",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedOn ?? post.publishedAt,
      authors: [absoluteUrl(teamPath(post.author.slug))],
      section: post.topic ? BLOG_TOPIC_INFO[post.topic].label : undefined,
      images,
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

/** A date-time in India's time zone, as structured data wants it ("2026-12-01T09:00:00+05:30"). */
export function istDateTime(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 330 * 60_000);
  return shifted.toISOString().replace(/\.\d{3}Z$/, "+05:30");
}

/** The largest file of a photo, as an absolute URL, with its size. */
function largestImage(image: LiveImage): { url: string; width: number; height: number } {
  const file = image.files.reduce((a, b) => (b.width > a.width ? b : a));
  return { url: absoluteUrl(imagePath(image.id, file.name)), width: file.width, height: Math.round((image.height * file.width) / image.width) };
}

/**
 * Images for Article markup and the sitemap, best first: the share image in 16:9, 4:3 and 1:1
 * (Google's ask), else its link-preview size, else the cover photo. None for a drawn cover.
 */
export function articleImages(post: Pick<PostSummary, "share" | "cover">): { url: string; width: number; height: number }[] {
  if (post.share) {
    const { imageId, files } = post.share;
    const kinds = (["16x9", "4x3", "1x1"] as const).filter((k) => files[k]);
    const chosen = kinds.length ? kinds : (["og"] as const);
    return chosen.map((k) => ({ url: absoluteUrl(imagePath(imageId, files[k]!)), ...SHARE_IMAGE_SIZES[k] }));
  }
  return post.cover ? [largestImage(post.cover)] : [];
}

const blogIds = {
  blog: () => `${absoluteUrl(BLOG_PATH)}#blog`,
  person: (slug: string) => `${absoluteUrl(teamPath(slug))}#person`,
};

const personRef = (author: PublicAuthor): Json => ({
  "@type": "Person",
  "@id": blogIds.person(author.slug),
  name: author.name,
  url: absoluteUrl(teamPath(author.slug)),
});

type Crumb = { name: string; path?: string };

function breadcrumbLd(url: string, crumbs: Crumb[]): Json {
  return {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.path ? { item: absoluteUrl(c.path) } : {}),
    })),
  };
}

const BLOG_CRUMBS: Crumb[] = [
  { name: SITE_NAME, path: "/" },
  { name: "Blog", path: BLOG_PATH },
];

/** A post: its page, the BlogPosting and breadcrumbs (SEO plan §4.5). */
export function postLd(post: LivePost): Json {
  const url = absoluteUrl(postPath(post.slug));
  const images = articleImages(post);
  const page: Json = {
    "@type": "WebPage",
    "@id": `${url}#page`,
    url,
    name: post.title,
    description: postDescription(post),
    inLanguage: "en-IN",
    isPartOf: { "@id": ids.site() },
    breadcrumb: { "@id": `${url}#breadcrumb` },
    // reviewedBy and lastReviewed belong here, and only once a named reviewer has actually
    // reviewed this version. No post records a review yet, so neither is ever written.
  };
  const graph: Json[] = [page];
  if (images.length) {
    page.primaryImageOfPage = { "@id": `${url}#image` };
    graph.push({ "@type": "ImageObject", "@id": `${url}#image`, ...images[0] });
  }
  graph.push(
    {
      "@type": "BlogPosting",
      "@id": `${url}#post`,
      mainEntityOfPage: { "@id": `${url}#page` },
      headline: post.title,
      description: postDescription(post),
      ...(images.length ? { image: images.map((i) => i.url) } : {}),
      datePublished: istDateTime(post.publishedAt),
      dateModified: istDateTime(post.updatedOn ?? post.publishedAt),
      author: [personRef(post.author)],
      publisher: { "@id": ids.org() },
      inLanguage: "en-IN",
      ...(post.topic ? { articleSection: BLOG_TOPIC_INFO[post.topic].label } : {}),
      ...(post.sources.length ? { citation: post.sources.map((s) => s.url ?? s.name) } : {}),
      isPartOf: { "@id": blogIds.blog() },
    },
    breadcrumbLd(url, [...BLOG_CRUMBS, ...(post.topic ? [{ name: BLOG_TOPIC_INFO[post.topic].label, path: topicPath(post.topic) }] : []), { name: post.title }]),
  );
  return { "@context": "https://schema.org", "@graph": graph };
}

const postingRef = (post: PostSummary): Json => ({
  "@type": "BlogPosting",
  "@id": `${absoluteUrl(postPath(post.slug))}#post`,
  headline: post.title,
  url: absoluteUrl(postPath(post.slug)),
  datePublished: istDateTime(post.publishedAt),
  author: [personRef(post.author)],
});

/** /blog: the Blog and its latest posts. */
export function blogIndexLd(posts: readonly PostSummary[]): Json {
  const url = absoluteUrl(BLOG_PATH);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": blogIds.blog(),
        url,
        name: BLOG_TITLE,
        description: BLOG_DESCRIPTION,
        inLanguage: "en-IN",
        publisher: { "@id": ids.org() },
        isPartOf: { "@id": ids.site() },
        breadcrumb: { "@id": `${url}#breadcrumb` },
        blogPost: posts.slice(0, 10).map(postingRef),
      },
      breadcrumbLd(url, [{ name: SITE_NAME, path: "/" }, { name: "Blog" }]),
    ],
  };
}

/** A topic hub: a collection of its posts. */
export function topicLd(topic: BlogTopic, posts: readonly PostSummary[]): Json {
  const url = absoluteUrl(topicPath(topic));
  const { label, intro } = BLOG_TOPIC_INFO[topic];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${url}#page`,
        url,
        name: label,
        description: intro,
        inLanguage: "en-IN",
        isPartOf: { "@id": ids.site() },
        breadcrumb: { "@id": `${url}#breadcrumb` },
        mainEntity: {
          "@type": "ItemList",
          itemListElement: posts.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: absoluteUrl(postPath(p.slug)) })),
        },
      },
      breadcrumbLd(url, [...BLOG_CRUMBS, { name: label }]),
    ],
  };
}

/** /team/<person>: a profile page whose main entity is the Person posts point to by @id. */
export function profileLd(author: PublicAuthor): Json {
  const url = absoluteUrl(teamPath(author.slug));
  const person: Json = {
    "@type": "Person",
    "@id": blogIds.person(author.slug),
    name: author.name,
    url,
    worksFor: { "@id": ids.org() },
  };
  if (author.role) person.jobTitle = author.role;
  if (author.bio) person.description = author.bio;
  if (author.photo) person.image = largestImage(author.photo).url;
  if (author.links.length) person.sameAs = author.links.map((l) => l.url);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "ProfilePage", "@id": `${url}#page`, url, name: author.name, mainEntity: { "@id": person["@id"] }, isPartOf: { "@id": ids.site() }, breadcrumb: { "@id": `${url}#breadcrumb` } },
      person,
      breadcrumbLd(url, [...BLOG_CRUMBS, { name: author.name }]),
    ],
  };
}

/** /editorial-policy: a plain page and its breadcrumbs. */
export function editorialLd(): Json {
  const url = absoluteUrl(EDITORIAL_PATH);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#page`,
        url,
        name: "Editorial policy",
        inLanguage: "en-IN",
        dateModified: EDITORIAL_UPDATED,
        isPartOf: { "@id": ids.site() },
        publisher: { "@id": ids.org() },
        breadcrumb: { "@id": `${url}#breadcrumb` },
      },
      breadcrumbLd(url, [{ name: SITE_NAME, path: "/" }, { name: "Editorial policy" }]),
    ],
  };
}

const lastChange = (post: PostSummary) => post.updatedOn ?? post.publishedAt;
const newest = (posts: readonly PostSummary[]) => posts.map(lastChange).reduce((a, b) => (b > a ? b : a));

/** Topics with enough posts to be indexed, in BLOG_TOPIC_INFO's order. */
export function indexedTopics(posts: readonly PostSummary[]): BlogTopic[] {
  return (Object.keys(BLOG_TOPIC_INFO) as BlogTopic[]).filter((t) => posts.filter((p) => p.topic === t).length >= HUB_MIN_POSTS);
}

/**
 * The blog's sitemap entries. Nothing until a post is live (an empty blog stays out of search);
 * then /blog, each post with its image, hubs with enough posts, the authors who have posts,
 * and the editorial policy.
 */
export function blogSitemap({ posts, authors }: { posts: readonly PostSummary[]; authors: readonly PublicAuthor[] }): MetadataRoute.Sitemap {
  if (!posts.length) return [];
  const writers = authors.filter((a) => posts.some((p) => p.author.id === a.id));
  return [
    { url: absoluteUrl(BLOG_PATH), lastModified: istDateTime(newest(posts)) },
    ...posts.map((p) => {
      const images = articleImages(p).slice(0, 1).map((i) => i.url);
      return { url: absoluteUrl(postPath(p.slug)), lastModified: istDateTime(lastChange(p)), ...(images.length ? { images } : {}) };
    }),
    ...indexedTopics(posts).map((t) => ({ url: absoluteUrl(topicPath(t)), lastModified: istDateTime(newest(posts.filter((p) => p.topic === t))) })),
    ...writers.map((a) => ({ url: absoluteUrl(teamPath(a.slug)), lastModified: istDateTime(newest(posts.filter((p) => p.author.id === a.id))) })),
    { url: absoluteUrl(EDITORIAL_PATH), lastModified: EDITORIAL_UPDATED },
  ];
}

/**
 * The whole sitemap, given the live posts and authors (app/sitemap.ts reads them from the
 * registry; tests pass their own). Dates are each page's last real change, not the build's.
 */
export function siteMap(blog: { posts: readonly PostSummary[]; authors: readonly PublicAuthor[] }): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl("/"), lastModified: HOME_UPDATED },
    ...GUIDES.map((g) => ({ url: absoluteUrl(g.path), lastModified: g.updated })),
    ...blogSitemap(blog),
  ];
}

/** Characters XML 1.0 allows; anything else (stray control characters) is dropped. */
function xmlAllowed(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000;
}
const XML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export const xmlText = (s: string) => Array.from(s).filter(xmlAllowed).join("").replace(/[&<>"']/g, (ch) => XML_ENTITIES[ch]);

/** RSS 2.0, the latest 20 posts, descriptions only (SEO plan §4.7). */
export function blogRss(posts: readonly PostSummary[]): string {
  const blogUrl = absoluteUrl(BLOG_PATH);
  const items = posts.slice(0, 20).map((p) => {
    const url = absoluteUrl(postPath(p.slug));
    return [
      "    <item>",
      `      <title>${xmlText(p.title)}</title>`,
      `      <link>${xmlText(url)}</link>`,
      `      <guid isPermaLink="true">${xmlText(url)}</guid>`,
      `      <description>${xmlText(postDescription(p))}</description>`,
      `      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
      `      <dc:creator>${xmlText(p.author.name)}</dc:creator>`,
      ...(p.topic ? [`      <category>${xmlText(BLOG_TOPIC_INFO[p.topic].label)}</category>`] : []),
      "    </item>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xmlText(BLOG_TITLE)}</title>`,
    `    <link>${xmlText(blogUrl)}</link>`,
    `    <description>${xmlText(BLOG_DESCRIPTION)}</description>`,
    "    <language>en-IN</language>",
    `    <atom:link href="${xmlText(absoluteUrl(BLOG_FEED_PATH))}" rel="self" type="application/rss+xml"/>`,
    // The newest post's date, not the build's, so the feed only changes when the blog does.
    ...(posts.length ? [`    <lastBuildDate>${new Date(newest(posts)).toUTCString()}</lastBuildDate>`] : []),
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
