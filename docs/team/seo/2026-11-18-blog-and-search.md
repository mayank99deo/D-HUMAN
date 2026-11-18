# Search fixes and blog SEO plan

As of 2026-11-18. Owner: `seo-lead`. For Mayank and the crew.

Mayank's Google search for "d-human" on his iPhone showed two results:

1. **www.d-human.fit:** the new title and description, with a grey globe instead of our logo.
2. **www.dhuman.fit:** our logo, but the old waitlist description. It says a doctor reviews the results, which is no longer true.

This note covers why, what changed in code, the steps only Mayank can take, and how the coming blog should be built for search.

## 1. The missing logo: what we found

**Verified on 2026-11-18 with curl:**

- The home page on www.d-human.fit returns 200. It has three icon tags in its `<head>`:
  - `favicon.ico` (16, 32 and 48 px inside);
  - `icon.svg`;
  - `apple-icon.png` (180 px).
- Every icon file returns 200 to Googlebot-Image. robots.txt allows them all.
- On the old hosts, icon paths 308 to the same path on www.d-human.fit. That's fine: Google follows redirects.
- The Organization logo in the structured data (`/icons/icon-512.png`, 512 px square) returns 200.
- **Google's own favicon service** (`t1.gstatic.com/faviconV2`) gives the default globe for www.d-human.fit and d-human.fit. It gives our D for www.dhuman.fit and dhuman.fit.

**The cause:** Google keeps one favicon per hostname. It fetched ours for www.dhuman.fit while that was the live address. www.d-human.fit has only been the main address since 13 November, and Google hasn't run its favicon fetch for it yet. Google's guide says this takes "several days to several weeks". The page markup is the same one that earned the logo on the old host. Nothing in our code was blocking it.

**One gap against Google's current guide, now fixed:**

- Google lists the favicon formats it supports: BMP, GIF, ICO, PNG, JPEG, PPM and TIFF. SVG isn't on the list.
- Google recommends an icon larger than 48 × 48 px. Our largest `rel="icon"` was the 48 px image inside the ICO. Only the 180 px Apple icon was larger.
- **Fix:** `app/icon0.png` is a 192 × 192 PNG (4 × 48) of the same D. Next adds `<link rel="icon" sizes="192x192">` for it. Tests now check the size and the square shape.

**What makes the logo show sooner:** request indexing of `https://www.d-human.fit/` in Search Console (step 3 below). It can't be forced. To check progress, open this URL. It shows our D once Google has the icon:
`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://www.d-human.fit&size=64`

## 2. The stale dhuman.fit result: Mayank's steps

**Verified live on 2026-11-18:**

| Request | Answer |
| --- | --- |
| `https://www.dhuman.fit/` | 308 to `https://www.d-human.fit/` |
| `https://www.dhuman.fit/calorie-tracker` | 308 to the same path on www.d-human.fit |
| `https://www.dhuman.fit/robots.txt` and `/sitemap.xml` | 308 to www.d-human.fit |
| `https://d-human.fit/` | 308 to `https://www.d-human.fit/` |
| `https://dhuman.fit/` | 308 to `https://www.dhuman.fit/`, then 308 to www.d-human.fit: **two hops** |

The redirects are right. Google shows the old result because it hasn't fetched www.dhuman.fit since the switch. Its copy predates 11 November: it still has the waitlist page's doctor-review line. (Our strategy note said nothing was indexed before the switch. That was wrong: the old host had been indexed.)

**Nobody can force Google to drop it. These steps make it happen sooner, usually within days to a few weeks.**

### Step 0: Vercel (2 minutes)

In Vercel → Project → Settings → Domains, change `dhuman.fit`'s redirect to `https://www.d-human.fit`, not `www.dhuman.fit`. That makes one hop instead of two. The Change of Address check (step 4) looks for a redirect from the old home page to the new one. Leave `www.dhuman.fit` attached to production. Email is not affected.

### Step 1: Search Console, the new site

If not done yet:

1. Add a **Domain property** for `d-human.fit`. Verify it with a DNS TXT record at the registrar.
2. Add a **URL-prefix property** for `https://www.d-human.fit/`. It's verified automatically once the Domain property is.

### Step 2: Search Console, the old site

1. Add a **Domain property** for `dhuman.fit`, verified by DNS TXT. A TXT record doesn't touch email (MX, SPF, DKIM).
2. Add **URL-prefix properties** for `https://www.dhuman.fit/` and `https://dhuman.fit/`. Both are verified automatically.

Google's Change of Address tool doesn't carry www or other subdomains along with the domain. So each old host needs its own property.

### Step 3: tell Google about the new site

In the `https://www.d-human.fit/` property (or the d-human.fit Domain property):

1. **Sitemaps:** submit `https://www.d-human.fit/sitemap.xml`.
2. **URL Inspection:** enter `https://www.d-human.fit/`, click **Test live URL**, then **Request indexing**. Google's favicon guide names this as the way to get the icon picked up.
3. Do the same for the five guides. There's a daily limit, so spread them over two days if needed.

### Step 4: Change of Address

1. Open the `https://www.dhuman.fit/` property.
2. Go to **Settings → Change of address**.
3. Pick `https://www.d-human.fit/` as the new site, then **Validate and update**.
4. Repeat from the `https://dhuman.fit/` property once step 0 is live.

This tells Google the move is permanent. It forwards signals to the new site for 180 days.

**If validation fails because of the status code:** Google's help page mentions only 301 redirects. Our redirects are 308. Google's site-move guide treats 301 and 308 the same. If the tool still refuses, tell the crew. The old-host redirects in `next.config.ts` can send `statusCode: 301` instead, a one-line change.

### Step 5: make Google re-fetch the old page

1. In the `https://www.dhuman.fit/` property, open **URL Inspection** for `https://www.dhuman.fit/`.
2. Click **Request indexing**. Googlebot fetches it, sees the 308, and replaces the old result with the new one.

### Step 6: wipe the false description now

The old description makes a claim we must not make, so clear it rather than wait:

1. In the `https://www.dhuman.fit/` property, go to **Removals → New request**.
2. Choose **Clear snippet in search**. Some screens may call it "Clear cached URL".
3. Enter `https://www.dhuman.fit/`.

This removes the description until Google fetches the page again. When it does, the page redirects, so the old text can't come back. It doesn't affect www.d-human.fit, which is a different domain.

Don't use "Temporarily remove URL" with a prefix, and don't use any removal on d-human.fit.

### Step 7: Bing

1. In Bing Webmaster Tools, import both sites from Search Console.
2. Use the **Site Move** tool from dhuman.fit to d-human.fit.
3. Submit the same sitemap.
4. Submit `https://www.d-human.fit/` under **URL Submission**.

### Step 8: links you control

Point these at `https://www.d-human.fit`:

- Social bios (Instagram, LinkedIn, X), Product Hunt and directory listings.
- The pitch deck and email signatures.
- The Apps Script site URL.

Razorpay's business website: change it only if Razorpay allows that without a new review. The redirect covers it either way.

### Step 9: keep the redirects

- Keep `dhuman.fit` registered and redirecting for at least a year. Email lives there, so in practice that's for good.
- Don't move hosts again. Google warns against chained moves.

### What to watch

Check weekly:

- Search `d-human` and `site:dhuman.fit`.
- The favicon check URL in section 1.
- Search Console → **Pages** in the old property. "Page with redirect" there is the good outcome.

The "D-Human" site name will replace "d-human.fit" in results on the same slow timetable. The WebSite markup for it is already live.

## 3. What changed in code today

| File | Change |
| --- | --- |
| `app/icon0.png` (new) | A 192 × 192 PNG favicon, the same D as `public/icons/icon-192.png`. |
| `lib/seo.ts` | A new home description: "Track calories and protein in Indian meals by photo, voice or text, in Hindi and 11 more languages, with weekly Wraps. AI reads your blood report; supplements only where markers point. Free to start." It is ordered so phones, which show about 135 characters, reach Wraps. Also: `APP_FEATURES`, a 10-line `featureList` in the WebApplication markup (photo, voice and text logging; all 12 languages by name; targets; food gaps; Past meals; Wraps; AI report reads; the stack and budget; retest), a new app description, and `HOME_UPDATED` set to 2026-11-18. |
| `app/manifest.ts` | A new description ("Free to start", Wraps), plus `id`, `lang` and `categories`. |
| `tests/seo.test.ts` | New checks: the feature list; the copy rules on all of this text (no doctor-review claim, no "accurate", no price, no "free" except "Free to start"); Wraps within the first 135 characters; the PNG favicon's size and shape; a 48 px image in the ICO; and the logo file matching its markup. |

The title is unchanged ("D-Human | Indian calorie tracker and AI blood report reads"). So is the landing H1.

**Follow-up for the landing (designer, then orchestrator):** Wraps and Past meals are in the markup and the description, but nowhere on a public page. Structured data should describe what the page shows. Add one line for each to the Fuel slide's details in `components/site/Fuel.tsx`, or to the calorie tracker guide. For example:

- "Wraps: your week, month and year of meals as a short story."
- "Past meals: the last 28 days, day by day."

## 4. Blog SEO architecture

Another agent designs the blog's look. This section covers what search needs from it.

### 4.1 What the blog is for, and what it isn't

Three kinds of public page each own a different search intent, so they never compete:

| Page type | Owns | Example |
| --- | --- | --- |
| Guides (`/calorie-tracker` and others) | "I want a tool that does X" | calorie tracker for indian food |
| Marker pages (`/markers/...`, Phase 2) | "What does my result mean?" | vitamin d 15 ng/ml meaning |
| Blog posts (`/blog/...`) | How-to, why, and lifestyle questions that lead to a guide | how to count calories in indian food |

**Rules that follow from this:**

- A post never targets a guide's main query, and never publishes ranges or thresholds for a marker. It links to the guide or the marker page instead.
- Before writing, check the post's main query against `STRATEGY.md` §2. If a guide already owns it, add to the guide instead.

### 4.2 URLs

```
/blog                         all posts, newest first
/blog/page/2                  more, when there are over 30 posts
/blog/<slug>                  a post
/blog/topics/<topic>          a topic hub
/blog/rss.xml                 the feed
/team/<person>                an author or reviewer
/editorial-policy             how we write, source, review and correct
/hi/blog/<slug>               a Hindi post (later), with hreflang to its English pair
```

- **Slugs:** lowercase English words joined by hyphens, about 3 to 6 words. No dates or stop words. Hindi posts get Latin slugs (`/hi/blog/calorie-kaise-gine`), which are easier to share than encoded Devanagari.
- **The topic stays out of the post's URL,** so a post can change topic without changing its address. Search Console reports group posts by a slug list kept in the post registry (4.9).
- **A changed slug always gets a 308 from the old one.** Keep the old slugs in the registry, and have `next.config.ts` build the redirects from them.
- **Never start a public URL with an app path.** robots.txt blocks `/home`, `/fuel`, `/upload`, `/reports`, `/stack`, `/wraps`, `/settings`, `/onboarding`, `/dev/` and `/api/` as prefixes. So a page at `/homemade-...` or `/fuel-for-...` would be invisible to search. Everything under `/blog/` and `/team/` is safe.

### 4.3 Topics, not tags

**Five topics, matching the guide pillars:**

| Topic | URL | Pillar guide it links up to |
| --- | --- | --- |
| Calories and Indian food | `/blog/topics/calories` | `/calorie-tracker` |
| Protein | `/blog/topics/protein` | `/protein-tracker` |
| Blood tests | `/blog/topics/blood-tests` | `/blood-report-analysis` |
| Supplements | `/blog/topics/supplements` | `/supplements-from-blood-test` |
| Training and sport | `/blog/topics/training` | `/calorie-tracker`, `/blood-report-analysis` |

- **Each post has one topic.**
- **A topic hub has an intro of 100 to 200 words written by a person,** then its posts. Until it has 3 posts, it's `noindex, follow` and stays out of the sitemap. Thin hubs hurt the site.
- **No tag pages.** They make many thin, near-duplicate pages. Keep keywords in the registry for planning only.

### 4.4 Authors, reviewers and E-E-A-T

Google holds health and money topics to its highest bar for experience, expertise, authority and trust. Readers, and Google's raters, look for who wrote a page, why they know the subject, and who checked it.

**Author pages at `/team/<person>`:**

- One page each for Mayank Narayan and the co-founder. **Needed from Mayank:** the co-founder's name and what each of you will publish about yourselves.
- Each page has:
  - a real photo, name and role at D-Human;
  - a short bio of real experience, in their own words;
  - the topics they write about;
  - links to profiles they control (LinkedIn, X, GitHub);
  - a list of their posts.
- **No invented or inflated credentials.** A founder isn't a medical reviewer unless they hold a registration.

**Reviewers:**

- A registered medical practitioner, and ideally a registered dietitian, under their real names. This is the existing open item in `STRATEGY.md` §10.
- Each gets a `/team/` page with their qualification and the year it was earned.

**Markup:**

- Each `/team/` page carries ProfilePage markup with a Person as its main entity: name, jobTitle, `worksFor` pointing to our Organization, image, `sameAs` and description.
- Posts point to that Person by its `@id`.

**On every post:**

- "Written by <name>, <role>" linking to `/team/<person>`.
- "Reviewed by <name>, <qualification>, on <date>", shown **only** when that person reviewed this version.
- "Published <date>". When it has changed, also "Updated <date>", with one line on what changed.

**`/editorial-policy`:** how topics are chosen, the source standard, who reviews what, and how to report an error. It also says no brand partners, and how AI is used. Suggested wording: "Drafts may be prepared with AI tools. A named person checks every fact against its source and is accountable for the page." Never list an AI as an author.

### 4.5 Structured data

The shape follows Google's Article guide. Add a `postLd()` beside `guideLd()` in `lib/seo.ts`, and reuse the Organization and WebSite `@id`s.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://www.d-human.fit/blog/<slug>#page",
      "url": "https://www.d-human.fit/blog/<slug>",
      "name": "<title>",
      "isPartOf": { "@id": "https://www.d-human.fit/#website" },
      "breadcrumb": { "@id": "https://www.d-human.fit/blog/<slug>#breadcrumb" },
      "primaryImageOfPage": { "@id": "https://www.d-human.fit/blog/<slug>#image" },
      "reviewedBy": { "@id": "https://www.d-human.fit/team/<reviewer>#person" },
      "lastReviewed": "2026-12-01"
    },
    {
      "@type": "BlogPosting",
      "@id": "https://www.d-human.fit/blog/<slug>#post",
      "mainEntityOfPage": { "@id": "https://www.d-human.fit/blog/<slug>#page" },
      "headline": "<title, short enough not to be cut off>",
      "description": "<meta description>",
      "image": ["<1200x675>", "<1200x900>", "<1200x1200>"],
      "datePublished": "2026-12-01T09:00:00+05:30",
      "dateModified": "2026-12-01T09:00:00+05:30",
      "author": [{ "@id": "https://www.d-human.fit/team/<author>#person" }],
      "publisher": { "@id": "https://www.d-human.fit/#organization" },
      "inLanguage": "en-IN",
      "articleSection": "<topic>",
      "about": [{ "@type": "Thing", "name": "<main subject>" }],
      "citation": ["<source text or URL>", "..."],
      "isPartOf": { "@id": "https://www.d-human.fit/blog#blog" }
    },
    {
      "@type": "BreadcrumbList",
      "@id": "https://www.d-human.fit/blog/<slug>#breadcrumb",
      "itemListElement": ["D-Human /", "Blog /blog", "<Topic> /blog/topics/<topic>", "<Post>"]
    }
  ]
}
```

- **`reviewedBy` and `lastReviewed`:** only when a real review happened. They sit on the WebPage, since they're WebPage properties in schema.org.
- **The Person nodes:** in full on `/team/<person>`, with `@id` `.../team/<person>#person`. Repeat name and url inline on posts, so each page stands on its own.
- **Dates:** with time and the Indian time zone. They must match the dates shown on the page. Change `dateModified` only for a real change to the substance, never for a typo or redesign.
- **`/blog`:** a `Blog` with `@id` `.../blog#blog` and its latest `blogPost` entries.
- **Topic hubs:** a `CollectionPage` with breadcrumbs.
- **What not to use:** FAQ markup on posts (Google doesn't show it for us; keep it for guides). MedicalWebPage until a reviewer exists. Any rating or review markup.

### 4.6 Metadata, canonicals and images

- **Titles:** under 60 characters, main query first, "| D-Human" at the end.
- **Descriptions:** 120 to 155 characters, saying what the reader gets. Same copy rules as the site (below).
- **Canonical:** every post, hub and team page points to itself on `https://www.d-human.fit`, with no trailing slash and no query string. `/blog/page/2` points to itself, not to page 1.
- **Copies elsewhere:** on LinkedIn, publish an excerpt that links back. LinkedIn can't set a canonical. On Medium, use its import tool, which sets the canonical to us.
- **Hindi pairs:** each version points to itself, with `alternates.languages` both ways (`en-IN`, `hi-IN`) and `x-default` on the English one. Only publish a Hindi post after a native speaker has read it. No machine translations.
- **A `postMetadata()` helper, not `pageMetadata()`:**
  - `openGraph.type: "article"`, with `publishedTime`, `modifiedTime`, `authors` and `section`.
  - `alternates.types` with `application/rss+xml` for `/blog/rss.xml`.
  - Don't pass the site's share image. A post's own `opengraph-image` file wins over metadata in code (see Next's metadata docs), but leaving it out avoids two og:image tags.
- **Share images:**
  - `app/blog/[slug]/opengraph-image.tsx` with `ImageResponse`, 1200 × 630. White on black, the post title in Archivo set wide, and the D-Human wordmark. Alt text is the title. No stock photos of people or pills.
  - For the Article markup, Google wants large images in 16:9, 4:3 and 1:1. Make one route that renders the same card at 1200 × 675, 1200 × 900 and 1200 × 1200.
  - If a post has its own hero image, it must be at least 1200 px wide.
- **Robots meta:** when the blog ships, add `max-image-preview:large` to the root layout's metadata (`robots: { "max-image-preview": "large" }`). Google Discover needs it to show large images. The app's own `robots: { index: false }` still overrides it there.

### 4.7 Sitemap and RSS

- **`app/sitemap.ts` reads the post registry,** like it reads `GUIDES` today. It lists:
  - `/blog`;
  - every post, with `lastModified` set to its updated date;
  - topic hubs with 3 or more posts;
  - `/team/` pages and `/editorial-policy`.

  Add `images` (the post's 16:9 image) to each post's entry. Next 16 supports image sitemaps. Draft and noindexed pages stay out.
- **`app/blog/rss.xml/route.ts`:** RSS 2.0 with the latest 20 posts. Each item has a title, the canonical link, a guid, the description, `pubDate`, `dc:creator` and a category.
  - It reads only the registry, so with Cache Components it is prerendered at build time. No `use cache` is needed.
  - Link it from `/blog` and every post's `<head>`. Google uses linked feeds for Discover's Follow button.
- **Hand-off:** `tests/seo.test.ts` should get the same checks the guides have. Every post is in the sitemap once, with a self canonical, under no robots-blocked prefix, and every dated field matches the registry.

### 4.8 Internal links

- **Every post:**
  - One or two links in its first third to its pillar guide, with descriptive anchor text ("how D-Human counts calories in Indian portions", never "click here").
  - One closing Start free link to `/signin`. Don't link to app screens: robots.txt blocks them.
  - 2 or 3 related posts from the same topic.
  - A link to `/sources-and-safety` in its sources box.
- **Every guide** gets a "Read more" list of 2 or 3 posts from its topic. The guide pages need a small edit when the first posts ship.
- **The landing page:** a Blog link in the header and footer. The UI agent decides where; `app/page.tsx` is untouched today.
- **Breadcrumbs, shown and marked up:** D-Human › Blog › Topic › Post.

### 4.9 Where posts live

- **One registry, in the style of `GUIDES`:** for example `lib/blog/posts.ts`, or front matter in `content/blog/*.mdx` checked with zod. Each entry holds:
  - slug, old slugs, title, description and topic;
  - author and reviewer ids, and the review date;
  - published and updated dates, and the main query;
  - its sources, and its hero image.

  The sitemap, RSS, hubs, related lists and structured data all read from it, so they can't drift.
- **Format:** MDX or TSX is `staff-engineer`'s call. MDX adds `@next/mdx`. TSX needs no new package and matches the guides.
- **Posts are static.** No comments: they bring spam and claims we'd have to moderate.

### 4.10 Rules for health posts

Google calls these "Your Money or Your Life" topics. Every health post must meet all of these:

1. **Every number has a named source** next to it, and a sources list at the end with links. Primary sources only: ICMR-NIN 2020, USDA FoodData Central, peer-reviewed papers, official price data. IFCT 2017 only after ICMR-NIN's written permission (`components/site/sources.ts`).
2. **Posts marked "doctor" below don't publish without a doctor's review.** These are posts about markers, doses or risks of excess. Nutrition how-tos need a dietitian's review where one is available. Until then they say "Written by the D-Human team from the sources above. Not medical advice."
3. **Never diagnose.** Say marker, range, risk and "worth showing a doctor". No ranges or thresholds in posts; link to the marker page, and say "your lab's printed range wins".
4. **No doses beyond what the reviewer has signed off.** No lab or supplement brand names, and no test prices.
5. **D-Human's reads are always described as AI-analysed,** never doctor-reviewed. The product is "Free to start", never "free". Meal numbers are estimates, never "accurate".
6. **Dates on show:** published, updated with what changed, and reviewed. Re-review every 12 months, or when a source is revised.
7. **A standard footer:** "Not medical advice. If you feel unwell, see a doctor."

### 4.11 The first 12 posts

- **Search volumes are unknown.** We have no keyword tool. Check each main query in Keyword Planner, and in Search Console once it has data, then re-order.
- **Queries are what people in India plausibly type.**
- **"Weeks" count from the blog's launch.**
- **Review column:** "doctor" means it can't publish without a doctor's review. "dietitian" means a dietitian's review is preferred, but the post isn't blocked.

| Wk | Title (draft) | Main query, then related | Topic | Links to | Review | Key sources |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | How to count calories in Indian food: roti, dal, rice and sabzi | how to count calories in indian food; calories in roti; calorie counting indian diet | Calories | `/calorie-tracker` | dietitian | Khanna 2007 and Raina 2011 portions, USDA FDC, ICMR-NIN 2020 |
| 2 | High-protein vegetarian Indian foods, per katori and per 100 g | high protein vegetarian indian food; veg protein sources india; protein in paneer | Protein | `/protein-tracker` | dietitian | USDA FDC, ICMR-NIN 2020 (table 2a, cereal-pulse-milk mix) |
| 3 | High-protein Indian breakfasts with 20 g of protein or more | high protein indian breakfast; protein breakfast vegetarian india | Protein | `/protein-tracker` | dietitian | USDA FDC, textbook portions |
| 4 | Calories in a thali: veg and non-veg, worked out | thali calories; veg thali calories; calories in indian lunch | Calories | `/calorie-tracker` | dietitian | USDA FDC, textbook portions (worked examples, labelled as such) |
| 5 | खाने की कैलोरी कैसे गिनें (Hindi pair of week 1, at `/hi/blog/calorie-kaise-gine`) | कैलोरी कैसे गिनें; calorie kaise count kare; roti me kitni calorie hoti hai | Calories | `/calorie-tracker` | native speaker, dietitian | as week 1 |
| 6 | Protein per rupee: the cheapest protein in Indian food | cheapest protein source india; protein per rupee; budget protein vegetarian | Protein | `/protein-tracker` | dietitian | USDA FDC, Department of Consumer Affairs retail prices (dated) |
| 7 | Why test your blood before buying supplements | blood test before supplements; should i take supplements without a blood test | Supplements | `/supplements-from-blood-test`, `/blood-report-analysis` | **doctor** | ICMR-NIN 2020, the house vitamin D figure, peer-reviewed papers on excess intake |
| 8 | Why so many Indians are low in vitamin D | vitamin d deficiency india; vitamin d test; why vitamin d low india | Blood tests | `/blood-report-analysis`, `/markers/vitamin-d` later | **doctor** | house attribution (2.2 lakh tests, 27 cities, 2023), ICMR-NIN 2020 |
| 9 | Vitamin B12 on a vegetarian diet | vitamin b12 vegetarian india; b12 rich vegetarian foods; b12 deficiency vegetarian | Blood tests | `/blood-report-analysis`, `/protein-tracker` | **doctor** | ICMR-NIN 2020 table 3 (2.2 µg; settle the `nutrition.ts` 2.5 µg question first) |
| 10 | What a full body checkup in India includes, and what each part tells you | full body checkup test list; full body checkup what is included | Blood tests | `/blood-report-analysis` | **doctor** | panel names from `lib/domain/markers.ts`, no lab names or prices |
| 11 | Ferritin and haemoglobin: why a normal Hb can hide low iron | ferritin test; low ferritin normal hemoglobin; ferritin for runners | Blood tests | `/blood-report-analysis`, `/supplements-from-blood-test` | **doctor** | peer-reviewed papers; iron only with a doctor, as the stack rule says |
| 12 | Your first marathon in India: what to eat, and what to test | marathon diet india; what to eat before a marathon; blood test for runners | Training | `/calorie-tracker`, `/blood-report-analysis` | **doctor** for the iron part, dietitian | ISSN 2017 and a sports nutrition position stand, ICMR-NIN 2020 |

**What these posts deliberately leave out:**

- "How much protein do I need" (the protein guide owns it).
- "Calorie tracker app" (the calorie guide owns it).
- Ranges for single markers (Phase 2 marker pages).
- "Diet plan for weight loss" (D-Human doesn't make meal plans, so that page would miss what searchers want).

**Remap in `STRATEGY.md` §2:** "protein for vegetarians" moves from the protein guide to post 2. The guide keeps "how much".

**If no doctor is on board by week 7,** publish weeks 1 to 6 first and hold 7 to 12. Don't publish them without the review.

### 4.12 Measuring it

- **Search Console:** filter pages by `/blog/` and group posts by topic with a regex built from the registry. Weekly for 8 weeks after launch, then monthly. Look at impressions, clicks, CTR and position for each post's main query.
- **Vercel Web Analytics:** visits per post, and visits from a post to `/signin`.
- **Later:** sign-ups by first page, once the first-touch capture in `STRATEGY.md` §8 is built and its privacy check is done.

## 5. Needs Mayank

1. Steps 0 to 8 above, in Vercel, Search Console and Bing.
2. The co-founder's name, and what each founder will publish about themselves for `/team/` pages.
3. A registered doctor, and ideally a dietitian, to review posts 7 to 12. This is the existing open item.
4. Whether to add the Wraps and Past meals line to the landing page (section 3's follow-up).

`STRATEGY.md` §6 still lists a ₹49 offer in the landing's markup. That was removed on 2026-11-14 and is still out; this note supersedes that line.
