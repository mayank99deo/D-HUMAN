# D-Human search strategy

As of 2026-11-13. Owner: `seo-lead`. For Mayank.

## In one minute

- **The goal:** when someone in India searches for calorie tracking for Indian food, how much protein they need, what their blood report means, or which supplements their results point to, D-Human should be the result they pick.
- **Where we stood today:** search engines had one page to show. It sat on four addresses with no canonical tag, and had no sitemap, no robots.txt and no structured data. Its headline is a brand line with no search words in it.
- **What ships now (Phase 1, in the repo, not yet committed):**
  - One address: `https://www.d-human.fit` (Mayank switched it from `www.dhuman.fit` on 2026-11-13, before anything was indexed; it matches the name).
  - A robots.txt and a sitemap.
  - Structured data.
  - A better landing title.
  - Five new public pages, each answering one search need with sourced numbers: four guides, plus a sources and safety page.
- **What only you can do:** verify the site in Google Search Console and Bing, then submit the sitemap. Decide the items in "Decisions for Mayank". Find the doctor and dietitian who will review health pages. The checklist is at the end.
- **What's next:**
  - **Phase 2:** explainers for the markers that matter most to Indians, reviewed by a doctor. Hindi and Hinglish versions of the guides.
  - **Phase 3:** Indian food nutrition pages, built from a dataset we're allowed to use.
  - **Throughout:** the off-site work that earns links and mentions.
- **About the numbers in this document:** we have no keyword volume tool. Every volume here is "unknown" unless a source is named. The search results described below came from a web search tool that runs from the US, so pages ranking in India may differ. Search Console will give us real Indian query data within a few weeks of verification. Re-rank this plan then.

## 1. Audit

### Technical findings, ranked by impact

| # | Finding (verified 2026-11-13) | Impact | Status |
| --- | --- | --- | --- |
| 1 | The same site answered with 200 on `www.dhuman.fit`, `www.d-human.fit` and `d-human.vercel.app`, with no canonical tag. Search engines saw up to three copies and had to guess which to show. | Splits ranking signals; the vercel.app copy could outrank the real one | **Fixed in Phase 1.** 308 redirects from every other host to `www.d-human.fit` for page requests (`next.config.ts`). `/api`, `/_next` and `/_vercel` are left alone, so open tabs, the Apps Script calls and the payment webhook keep working. A canonical tag and `og:url` are on every public page. |
| 2 | No `robots.txt` and no `sitemap.xml` (both 404). | Slower discovery; nothing to submit to Search Console | **Fixed.** `app/robots.ts` and `app/sitemap.ts` (6 URLs). |
| 3 | Only one indexable page. Its H1 is "Your body speaks data.", which has no search words. | Can't rank for any topic beyond the brand | **Partly fixed.** Five new pages, each with the topic in its H1. The landing H1 is a decision for you (below). |
| 4 | Share previews and absolute URLs pointed at `d-human.vercel.app`. `NEXT_PUBLIC_SITE_URL` is set to it, at least locally. | Shares and crawlers were sent to the wrong host | **Fixed in code.** `lib/site-url.ts` reads any of our other hosts as `www.d-human.fit`, so a stale variable can't point anything at a redirecting host. Tidy the variable anyway (checklist). |
| 5 | No structured data. | No eligibility for rich results; machines can't read prices, breadcrumbs or questions | **Fixed.** Organization, WebSite, WebApplication with the free start and ₹49 pass, BreadcrumbList, and FAQPage where questions are visible. |
| 6 | The main landing title led with the brand and one topic: "D-Human \| Calorie tracking for Indian meals". | Weak match for report and supplement searches | **Fixed.** Now "D-Human \| Indian calorie tracker and AI blood report reads" (58 characters). The description is 153 characters. |
| 7 | Mobile LCP is 3.8–3.9 s in a local Lighthouse run (simulated slow 4G). The headline waits on two preloaded Archivo font files, 89 KB and 84 KB. | Core Web Vitals is a light ranking signal and a heavier conversion one | **Open.** Same on every page, including the landing. Check real users in Speed Insights first. If field LCP is over 2.5 s, look at serving one Archivo file. |
| 8 | No About, Contact, Privacy, Terms or Refund pages. | For health topics, Google's raters look for who runs the site and how to reach them. Razorpay usually needs these pages too. | **Open.** Needs you (legal and company details). |
| 9 | The signed-in app was noindex, but crawlable. | Low; noindex already kept it out | **Tightened.** robots.txt now disallows the app routes and `/api/`. `/signin` stays crawlable on purpose: it's linked from every page, and crawlers can only see its noindex if they may fetch it. |
| 10 | The second domain, `dhuman.fit` and its www (email lives there) | Low | Keep renewing it. The redirects pass any links it has earned to `www.d-human.fit`. |

### Content findings, ranked by impact

1. **No topical depth.**
   - Competitors have hundreds or thousands of pages per topic. Examples seen in results:
     - Calorie tracking: HealthifyMe, and the Hint app's site with many "calories in X" and protein guides.
     - "Calories in roti" style searches: Tarla Dalal's per-dish calorie pages.
     - Report reading: lab and hospital blogs.
     - Protein guides: pharmacies and supplement brands.
   - We had one page.
2. **No visible trust layer for a health site.** There's no "who wrote this", no named sources on a page, no review, and no contact. Google holds health pages ("Your Money or Your Life" topics) to its highest bar, and thin or unsourced health pages can hold back the whole site. Phase 1 adds named sources on every page and a sources and safety page. A named medical reviewer is still missing.
3. **Strong, true differences we weren't using:**
   - Meal logging by voice or text in 12 Indian languages.
   - Indian household portions.
   - ICMR-NIN 2020 targets.
   - A supplement stack worked out by rules, from markers, with no brand partners.
   - Reads aimed at the person's sport and event.
   - The competitors we saw lead with a big database or a photo scanner.
   - The new pages lead with these differences.
4. **Search intent is split between "tool" and "answer".** People who search "how much protein do I need" want a number before an app. The protein guide answers first, with a table by body weight, then offers the tracker.

## 2. Intent and keyword map

One page per intent; never two pages for one intent. Volumes are unknown: no tool. Hindi and Hinglish queries are what people plausibly type, written out to check in Search Console. They aren't measured.

### Pillar A: calorie tracking for Indian food → `/calorie-tracker` (live in Phase 1)

| Cluster | Example queries | Intent |
| --- | --- | --- |
| App for Indian food | calorie tracker for indian food, indian calorie counter app, calorie counter app india, best calorie app for indian food | Find a tool |
| How to log | photo calorie counter indian food, voice calorie tracker, calorie tracker hinglish | Find a tool, with a feature |
| In Hindi or Hinglish | calorie kaise count kare, khane ki calorie kaise pata kare, कैलोरी कैसे गिनें, calorie counter app hindi | Find a tool or a method |

**What the results pages showed:**

- App store listings for new AI trackers (Calwise, Indian Calorie, InsightBite, Bloomberries).
- HealthifyMe's photo feature, covered in TechCrunch.
- The Hint app (clearcals.com), with a large content library.
- Nutrimate, which logs over WhatsApp.
- Product Hunt launches.
- Nobody we saw leads with logging in 12 Indian languages.

### Pillar B: protein needs and tracking → `/protein-tracker` (live)

| Cluster | Example queries | Intent |
| --- | --- | --- |
| How much | how much protein per day india, protein requirement per day icmr, protein per kg body weight india | Answer |
| Vegetarian | vegetarian protein per day india, protein for vegetarians india | Answer, then foods |
| Training | protein for gym beginners india, protein intake for muscle gain india | Answer |
| Tool | protein tracker app, protein intake calculator india | Find a tool |
| In Hindi or Hinglish | roz kitna protein chahiye, प्रोटीन कितना चाहिए, protein kitna lena chahiye gym | Answer |

**What the results pages showed:**

- An online pharmacy's health library (Truemeds).
- Supplement brands' blogs (MuscleBlaze, Horlicks).
- Tracker apps' blogs (clearcals).
- A body-composition device maker's blog (InBody India).
- They often quote ICMR-NIN's 0.83 g per kg. We cite the primary source: the brief note was read directly, with tables 2a, 3 and 4.

### Pillar C: blood report analysis → `/blood-report-analysis` (live)

| Cluster | Example queries | Intent |
| --- | --- | --- |
| AI tool | blood test report analysis, blood report analysis ai, lab report reader online, upload blood report get explanation | Find a tool |
| Understand | how to read blood test report, full body checkup report explained, understand my blood report | Answer, then a tool |
| By panel | cbc report analysis, thyroid report meaning, lipid profile report explained | Answer (Phase 2 explainers) |
| In Hindi or Hinglish | blood report kaise samjhe, blood test report kaise padhe, ब्लड टेस्ट रिपोर्ट कैसे पढ़ें, blood report hindi me | Answer or tool |

**What the results pages showed:**

- Lab and hospital blogs (Pathkind, Mahajan Imaging, BLAL, Jaslok, Apollo 24|7, 1mg articles).
- Diagnostic marketplaces bundling "report analysis" with a test package (PharmEasy).
- Small AI startups: ReportSense, Saral Report, Bharat Swasth, Unived.
- None we saw aims the read at the person's sport or goal.

### Pillar D: supplements from a blood test → `/supplements-from-blood-test` (live)

| Cluster | Example queries | Intent |
| --- | --- | --- |
| Personalised | supplements based on blood test, which supplements should i take, personalised supplements india | Answer and tool |
| Do I need it | do i need a multivitamin, vitamin d supplement needed or not, iron tablet without test | Answer (careful, YMYL) |

**What the results pages showed:**

- Supplement companies' own "test then buy" pages (Unived, Wellbeing Nutrition's BloodView).
- Foreign health-tech guides.
- An Indian supplement review site.
- **Our angle no one else can copy honestly:** we sell nothing and have no brand partners.

### Pillar E: marker explainers → `/markers/...` (Phase 2, not built)

- **Queries:** vitamin d 15 ng/ml meaning, ferritin low means, hba1c normal range india, tsh high meaning in hindi, b12 low symptoms, ldl cholesterol high, hs crp high.
- **Volume:** likely the biggest informational set (inferred, not measured).
- **Why not now:** it's the most sensitive content. Build it only with a doctor's review.

### Pillar F: Indian food nutrition → `/food/...` (Phase 3, not built)

- **Queries:** calories in roti, protein in paneer 100g, dal calories per katori, idli calories.
- **Who ranks today:** Tarla Dalal, FatSecret India, app blogs, Redcliffe Labs and Rotimatic.
- **What it needs:** a sourced dataset (IFCT 2017) and permission to use it. One page per food only where the page has real per-portion numbers.

### Also

- **Brand and navigational:** d-human, dhuman, d human app, dhuman login. Phase 1 adds "DHuman" and "D Human" as alternate names in the structured data.
- **Sport-specific (Phase 3 or later):** HYROX nutrition India, marathon blood test, ferritin for runners. These fit the persona engine and could become sport hubs.

## 3. Site architecture and URLs

```
/                                 brand and overview (both jobs, Start free)
/calorie-tracker                  pillar A
/protein-tracker                  pillar B
/blood-report-analysis            pillar C
    /markers/                     Phase 2 hub; /markers/vitamin-d, /markers/ferritin, ...
/supplements-from-blood-test      pillar D
/food/                            Phase 3 hub; /food/roti, /food/paneer, ...
/sources-and-safety               trust page (sources, AI, safety rules, data)
/about /contact /privacy /terms /refunds     Phase 1b, need Mayank
/hi/...                           Phase 2b, Hindi versions with hreflang
```

**URL rules:**

- Lowercase English words joined by hyphens.
- No dates and no trailing slash.
- Never change a live URL without a 301 or 308.
- **Never start a public URL with an app prefix:** `/home`, `/fuel`, `/upload`, `/reports/`, `/stack`, `/wraps`, `/settings`, `/onboarding`, `/dev/`, `/api/`. robots.txt blocks these as prefixes, and `tests/seo.test.ts` fails if a guide breaks the rule.
- The list of public pages lives in `lib/seo.ts` (`GUIDES`). The sitemap, footer links and related links all read from it.

## 4. Page templates

**Pillar guide** (`components/site/Guide.tsx`, used by all five pages):

1. Breadcrumb, an H1 with the topic, a lead paragraph that answers the search directly, and Start free.
2. Key facts beside them.
3. How it works, in four steps.
4. Topic sections.
5. What it doesn't do.
6. Questions (visible, and the same array feeds the FAQ markup).
7. A closing Start free, sources, and links to the other guides.

The guides are static. They are built from the landing page's own type, grid and black-and-white sections.

**Marker explainer (Phase 2):**

1. What the marker is.
2. The units Indian labs print, and conversions.
3. The typical range, with "your lab's own range wins".
4. What moves it, food first.
5. When it's worth showing a doctor.
6. How D-Human reads it.
7. Sources.
8. A review box: reviewer's name, qualification and date, only for a real reviewer who agreed.

**Food page (Phase 3):**

1. Values per 100 g and per household portion, from IFCT 2017.
2. Macros and the 8 micronutrients D-Human tracks.
3. How cooking changes it (oil, ghee).
4. Source.
5. "Log it in D-Human".

## 5. Internal linking

- **From the landing page (open mode):**
  - Fuel links to the calorie tracker and protein targets.
  - Blood reports links to blood report analysis.
  - The phone slide links to supplements from your blood test.
  - Short labels keep every slide within one screen at 1024 × 768.
- **Between guides:**
  - Inline links where one topic leads to another: calorie to protein, report to stack, stack to report, and report to safety.
  - A "More from D-Human" grid.
  - Footer links on every guide.
- **Later:** marker pages link up to `/blood-report-analysis` and across to `/supplements-from-blood-test`. Food pages link up to `/calorie-tracker`. Hubs list their children.
- **Anchor text:** say what the page is ("Calorie tracker", "How blood report analysis works"), never "click here".
- **Not done:** guide links in the landing page's footer. The last slide is sized to a 13rem footer, and extra links made it overflow the screen. The section links cover the same pages.

## 6. Structured data

| Where | Types | Notes |
| --- | --- | --- |
| `/` | Organization, WebSite, WebApplication with two Offers (₹0 free start, ₹49 pass) | Prices come from `lib/domain/plan.ts`, as the Start free form shows them. Waitlist mode drops the app. |
| Guides | FAQPage (when questions are shown) or WebPage, plus BreadcrumbList | Same FAQ array as the page. `dateModified` from `lib/seo.ts`. |

**What to expect:**

- **FAQ rich results:** Google shows them only for well-known government and health sites (since 2023). We keep the markup because it describes the page accurately and other engines and AI answers read it. Don't expect FAQ snippets.
- **App rich results:** these need ratings. We have none and won't invent any.
- **Later:**
  - MedicalWebPage with `reviewedBy` and `lastReviewed` on explainers, once a real reviewer exists.
  - Person for that reviewer.
  - Article on long guides.

## 7. Health content and review plan

- **Who writes:** the D-Human team. `seo-lead` drafts. Every page is checked against the code it describes before it ships.
- **Who reviews:**
  - A registered medical practitioner for marker explainers, the blood report and supplement guides, and the safety wording.
  - A registered dietitian for the nutrition pages.
  - This is the open "doctor review" item. Until it's done, pages say "Written by the D-Human team from the sources above. Not medical advice." They never claim a review.
- **Source standard:**
  - Primary sources only: ICMR-NIN, IFCT 2017, peer-reviewed papers, and the lab's printed range.
  - Name the source on the page next to the number, and list it with a link at the end.
  - No number without a source.
  - The 76% vitamin D figure keeps its house attribution: research across 2.2 lakh lab tests in 27 Indian cities, 2023.
- **Copy rules:**
  - Never diagnose.
  - Reads are AI-analysed, never doctor-reviewed.
  - No lab or supplement brand names on public pages.
  - No promises about results or rankings.
  - No safety thresholds published until a doctor has reviewed them.
- **Upkeep:**
  - Update `updated` in `lib/seo.ts` whenever a page's substance changes; it feeds the sitemap and the page.
  - Recheck sources yearly, or when ICMR-NIN revises them.
- **Found while sourcing:**
  - `lib/domain/nutrition.ts` uses 2.5 µg a day of vitamin B12 for adults, and 13.2 mg of zinc for women.
  - ICMR-NIN's 2020 brief note (tables 3 and 4) says 2.2 µg and 13.0 mg.
  - The full 2020 book may differ, so check it.
  - The guides leave both numbers out until this is settled. Route to `staff-engineer`.

## 8. Measurement

- **Search Console** (you set it up):
  - Impressions, clicks, CTR and average position per page and per query.
  - The "Page indexing" report.
  - Core Web Vitals.
  - Group queries by the pillars above.
- **Bing Webmaster Tools:** the same, imported from Search Console.
- **Vercel Web Analytics** (on): visits per page and referrers, so search traffic shows as google.com or bing.com.
- **Sign-ups from search:**
  - Today we can see visits to a guide and visits to `/signin`, but not who signed up from where.
  - **Proposal for `staff-engineer`:** store the first landing page and referrer type (search, social, direct) in sessionStorage. Save it on the profile when the account is made.
  - Needs a privacy check first.
- **AI answers:** once a month, ask ChatGPT, Perplexity and Google (AI Overviews) the top question in each pillar. Note whether D-Human is cited.
- **Baseline today:** nothing indexed beyond the landing page, and no query data.
- **Cadence:** weekly for the first eight weeks after verification, then monthly.

## 9. Roadmap

### Phase 1: ships with this change

- One host, with redirects and canonicals.
- robots.txt and the sitemap.
- Structured data.
- Five pages: calorie tracker, protein tracker, blood report analysis, supplements from your blood test, and sources and safety.
- The landing title, description and section links.

### Phase 1b: needs you, next 1–2 weeks

- Search Console and Bing.
- Submit the sitemap.
- About, Contact, Privacy, Terms and Refund pages (Razorpay needs most of them anyway).
- The H1 decision.
- Tidy `NEXT_PUBLIC_SITE_URL`.

### Phase 2: weeks 3–8, if a reviewer is in place

1. **Marker explainers.** Start with about 10 markers that come up most on Indian full-body reports:
   - Vitamin D, B12 and ferritin.
   - Haemoglobin.
   - HbA1c and fasting glucose.
   - TSH.
   - LDL, HDL and triglycerides.
   - hs-CRP.
   - Creatinine.
   - ALT.

   Each one only with a doctor's review.
2. **"How to read a full body checkup report":** one long guide linking to each explainer.
3. **A protein calculator on `/protein-tracker`:** a small interactive tool; the table stays.
4. **Hindi versions of the four guides at `/hi/...`,** with hreflang. Only after a native speaker reviews them. That's already an open item for the landing page's Hindi.

### Phase 3: months 2–4

1. **Food pages from IFCT 2017,** for the 50 most-logged dishes. Fuel's own logs can tell us which, without personal data. Only after we know IFCT's terms allow it.
2. **Sport hubs:** running, HYROX, gym and trekking, tied to the persona engine.
3. **More languages:** if Search Console shows demand in Tamil, Bengali or Marathi, guides in those languages, with native review.

### Off-site, starting now and ongoing

- **Listings:**
  - Product Hunt launch.
  - Indian startup directories and press: YourStory, Inc42.
  - App stores, if a store app ships. A Play Store listing via a Trusted Web Activity is cheap.
- **PR stories that are true and new:**
  - Logging meals by voice in 12 Indian languages.
  - Supplement advice from a company that sells no supplements.
  - Reads aimed at your race.
- **Partnerships:** running clubs, HYROX gyms and trek organisers. They link to us and mention us to the people we're for.
- **Original data, later:** aggregated, anonymised, consented findings, such as what Indians log for breakfast. These earn links. Legal and privacy sign-off first.
- **Answers in communities:** Reddit and Quora answers that help, with the source, by a named person. Never spam.
- **Video:** short explainers from the studio, posted with descriptive titles. YouTube results show up in Indian health searches.

## 10. Decisions for Mayank

1. **The landing H1.**
   - **Option A:** keep "Your body speaks data." as the H1. Topics live in the title and guides. This is what ships now.
   - **Option B (my recommendation):** make the existing line "Calorie and protein tracking for Indian meals." the H1, and show "Your body speaks data." exactly as now, as a styled paragraph. Nothing changes visually; only the heading semantics do.
   - The gain is modest: the title matters more, and the guides carry the topics.
2. **AI crawlers.** robots.txt allows every crawler, including AI search and training bots. Allowing them gives the best chance of being cited in ChatGPT, Perplexity and AI Overviews. Blocking training-only bots is possible while keeping search bots.
3. **The public "not reviewed by a doctor" line.** Pages say "Not medical advice" and that reads aren't doctor-reviewed. They don't say the guides themselves are unreviewed. Once a reviewer exists, add a dated review box.
4. **Who appears as the author.** Health sites do better with a real, named person: a founder page, and a reviewer with qualifications. Your call on what to publish about the team.
5. **IFCT 2017.** Before Phase 3, confirm we may publish food values from it, with attribution. This may need permission from ICMR-NIN.
6. **Naming competitors.** "Alternative to X" pages can rank, but they name other apps. The house rule only forbids naming lab and supplement brands. I'd hold off for now.

## 11. Mayank's checklist

1. **Deploy** this change after review. Then check that the redirects work:
   ```bash
   curl -sI https://d-human.vercel.app/ | grep -iE "^HTTP|^location"
   curl -sI https://www.dhuman.fit/calorie-tracker | grep -iE "^HTTP|^location"
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://d-human.vercel.app/api/waitlist/details
   curl -s https://www.d-human.fit/robots.txt
   curl -s https://www.d-human.fit/sitemap.xml
   ```
   - The first two should give 308 with `location: https://www.d-human.fit/...`.
   - The POST should give 400 or 403, never 308: the API isn't redirected.
   - Then view source on `https://www.d-human.fit/calorie-tracker`. Look for `rel="canonical"` and `application/ld+json`.
2. **Google Search Console:**
   - Add a **Domain property** for `d-human.fit`. Verify it with the DNS TXT record Google gives you, at your domain registrar. It covers www and the apex.
   - Submit `https://www.d-human.fit/sitemap.xml`.
   - Use URL Inspection → Request indexing for `/` and the five guides.
   - Optional: add `dhuman.fit` too, to watch its redirects.
3. **Bing Webmaster Tools:** sign in, import the sites from Search Console, and submit the same sitemap.
4. **Vercel** (optional, tidy):
   - Set `NEXT_PUBLIC_SITE_URL` to `https://www.d-human.fit`, or delete it, then redeploy.
   - Code already treats the old value as the canonical host.
   - Make sure `www.dhuman.fit` and `d-human.vercel.app` stay attached to production, so the code redirects reach them.
   - `dhuman.fit` (no www) is set in Domains to redirect to `www.dhuman.fit`, so it takes two hops. Point that redirect at `www.d-human.fit` to make it one.
5. **Webhooks** (tidy, not urgent):
   - Point the Apps Script's site URL at `https://www.d-human.fit`.
   - Point the Razorpay webhook there when you set it up.
   - The old addresses keep working, because `/api` isn't redirected.
6. **Trust pages:**
   - Approve wording for About, Contact (a real email address you read), Privacy, Terms and Refunds.
   - Tell `seo-lead` and `staff-engineer` to build them.
7. **Reviewer:** find a registered doctor, and ideally a dietitian, who'll review health pages under their real name.
8. **DMARC** (existing open item): helps email deliverability and domain trust.
