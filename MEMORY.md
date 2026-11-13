# D-Human project memory

The running record of this project: where things stand, why they are the way they are, what bit us, and every update and push. Read it before starting work. Add to the log after every change, and record the commit hash after every push. Never write secret values here; variable names only.

## Snapshot

- **Platform (Phase 1, pushed 2026-11-09 in `99168f2`):** sign-in by emailed code, onboarding, blood report upload read by Claude, a persona dashboard (bib, verdict aimed at an event, metrics that matter, contour fingerprint), food logging by photo, voice or text, wraps and a supplement stack. Pages in `app/(platform)/`, design and architecture in `docs/platform/PHASE-1.md`. Needs `DATABASE_URL`, `ANTHROPIC_API_KEY` and `AUTH_SECRET` in Vercel before it works live; the landing page doesn't link to it yet.
- **Open to everyone, with a paywall (2026-11-11):** the landing page shows "Start free" and "Sign in" instead of the waitlist (`NEXT_PUBLIC_SITE_MODE=waitlist` brings the old page back after a redeploy; nothing was deleted). Free: 2 report reads and 20 meal logs. Then ₹49 for 30 days through Razorpay (one payment, no renewal): 3 reads in the pass, and 5 meal logs a day for everyone. Needs `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in Vercel and the webhook in Razorpay's dashboard (steps in `docs/platform/PHASE-1.md`); until then the paywall says "Payments open soon".
- **Reports are AI-analysed only (2026-11-11):** no doctor review for now; never say a doctor reviews reports. "See a doctor" flags for the person's own doctor stay.
- **What:** the D-Human waitlist landing page. Tagline: "Your body speaks data. Hack your health." (until 2026-10-30: "Hear it. Use it. Own it.") D-Human tests first (blood, gut, body), analyses the results with AI, recommends supplements only where markers point, and retests.
- **Live:** https://www.dhuman.fit (`dhuman.fit` redirects there), https://www.d-human.fit (`d-human.fit` redirects there; same deployment, which Mayank uses on his phone) and https://d-human.vercel.app. Vercel personal account `mayank-f847`. Every push to `main` auto-deploys in about 20 seconds. The claude.ai Vercel connector is signed into a different account and cannot see this project.
- **Repo:** https://github.com/mayank99deo/D-HUMAN, branch `main`.
- **Stack:** Next.js 16.4.2 (App Router, Cache Components on), React 19.3, Tailwind CSS 4, Motion 14.6, zod 4, resend 6.34. Platform: drizzle-orm 0.45 (Postgres via `postgres` 4.1, or embedded `@electric-sql/pglite` 0.5 locally), `@anthropic-ai/sdk` 1.6 (Haiku 5.5 and Sonnet 5.5 per job, see Decisions). Node 24 via fnm.
- **Signups:** browser → `/api/waitlist` → Google Apps Script web app (`google-apps-script/Code.gs`) → the `Waitlist` tab of the Google Sheet (13 columns). The optional follow-up answers go to `/api/waitlist/details` with an HMAC token. Second source: a Google Form, built by `setupForm()` in the same script. Its trigger files each answer in the `Waitlist` tab with Source `google-form` and calls `/api/waitlist/form` (authorised with the webhook secret) for the welcome email and Resend contact.
- **Email:** Resend. `dhuman.fit` is verified there (DKIM, plus MX and SPF on `send.dhuman.fit`; no DMARC yet). The sender defaults to `D-Human <hello@dhuman.fit>`. The welcome email template is `lib/waitlist/welcome-email.ts`; preview it in dev at `/api/email-preview`.
- **Domains:** as of 2026-10-27 `dhuman.fit` points at Vercel and 308-redirects to `www.dhuman.fit`, which serves the site. Mail for `@dhuman.fit` runs on Google Workspace. Links and images use `lib/site-url.ts` (`NEXT_PUBLIC_SITE_URL`, else Vercel's production domain); share previews still point at `d-human.vercel.app` (see Open items).
- **Launch film:** in the studio, `~/Projects/studio/projects/d-human-launch` (16:9) and `d-human-launch-reel` (9:16); notes in each `REVIEW.md`. New video work goes in the studio, not this repo.
- **Video:** two HyperFrames projects, each with `SPEC.md` and `REVIEW.md`. `video/intro/` is the 13 s product intro. `video/loop/` is the 20 s phone-screen loop (600 x 1296) that plays in the "Test first" section; its web copy and stills live in `public/media/loop/` (re-encode steps in its `REVIEW.md`). Preview with the plugin CLI's `preview`, render with `render`; caches and `renders/` are git-ignored.
- **Environment variables (names only):** Payments: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Landing: `NEXT_PUBLIC_SITE_MODE` (optional). Waitlist: `GOOGLE_SHEETS_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_SECRET` (must equal `WEBHOOK_SECRET` in Apps Script), `RESEND_API_KEY` (full access), `RESEND_FROM`, `RESEND_REPLY_TO`, `RESEND_SEGMENT_ID`, `NEXT_PUBLIC_SITE_URL` (optional). Platform: `DATABASE_URL` (or `POSTGRES_URL` from Vercel's Supabase integration), `ANTHROPIC_API_KEY`, `AUTH_SECRET`, `CLAUDE_MODEL` (optional), `D_HUMAN_AI_MOCK` (local only). Local values live in `.env.local`, which is git-ignored; there `RESEND_API_KEY` is empty (the real key is only in Vercel).
- **Local dev:** port 3000 belongs to the Pepvoga project on this Mac, and 3001 is often held by an old server; the platform was built on `D_HUMAN_AI_MOCK=1 npm run dev -- -p 3017`. The embedded database lives in `.data/pglite` (git-ignored). `/api/dev/session?as=ankit|mayank|fresh&to=/path` signs in as a demo person (404 in production).
- **Mobile:** installable as a home-screen web app (`app/manifest.ts`, icons in `public/icons`, Apple web-app tags). Lighthouse mobile on 2026-10-28 (with the phone loop): Performance 93–95, Accessibility, Best Practices and SEO 100; blocking time 50–70 ms, LCP 2.9 s, CLS 0, 347 KiB on load (the video loads only near the screen). No overflow and no tap target under 44 px at 320, 375 or 430 px.

## Decisions

- **The crew (2026-11-11):** nine role agents in `.claude/agents/`, run by the main session as orchestrator (agents can't start agents). They are AI roles, not people; medical review, legal and money decisions stay with Mayank and qualified humans.

- **Brand:** monochrome only, true `#000` and `#fff` ("white pack, black ink"). Archivo with its width axis, set wide to echo the logo. The primary button's cut top-left corner borrows the notch in the logo's D. No accent colour; errors are marked with a "!" glyph.
- **Page scope (2026-11-11, pilot):** the open landing page leads with Fuel (calorie tracking) and the three languages, then blood reports, then "blood tests through D-Human, coming soon", then a closing Start free. Waitlist mode keeps the 2026-10-28 page (hero, vitamin D, loop). Tests and Plans stay hidden.
- **Platform design (2026-11-09):** black and white stay the brand; the only colour comes from blood, used for marker status and always paired with a glyph: serum `#B5D2C0` (in range), plasma straw `#E2D3A2` (edge of range), haem `#E3A5A2` (out of range), plus faint washes of the same behind verdicts, bibs and wraps. Archivo only; the wide axis carries numbers and verdicts. The signature pieces: the race bib (age as the number, an animated sports pictogram of the persona), the verdict aimed at the person's event, the contour fingerprint of their markers, and the orbit while a report is read. Nue Health's in-range colour is purple; ours stays blood-derived so we don't look alike.
- **Models (2026-11-09):** cost first. Haiku 5.5 for transcription-like and frequent jobs (report values, meals, wraps, stack translations), Sonnet 5.5 where judgement or web search matters (the read, events, brand searches). Since 2026-11-11 the stack itself is code. Opus 5.5 only if a job's quality falls short; switch one job with `CLAUDE_MODEL_<JOB>`.
- **Plans (2026-11-11, Mayank):** free 2 reads and 20 meal logs per account (history counts); a ₹49 one-time pass for 30 days with 3 reads; at most 5 meal logs a day for everyone. One-time payment, not a subscription (Mayank chose this over Razorpay Subscriptions). Rules in `lib/domain/plan.ts`; the landing page's price line reads the same constants. Uses are counted in a `usage` ledger, released when a read or meal fails, kept when a report is deleted.
- **Landing mode (2026-11-11):** `lib/site-mode.ts` reads `NEXT_PUBLIC_SITE_MODE`; open mode is the default. Waitlist mode renders the old page unchanged. The platform ignores the mode, so existing users keep their links.
- **Vercel Web Analytics and Speed Insights (2026-11-11):** both on, via `components/Vitals.tsx` in the root layout (`@vercel/analytics`, `@vercel/speed-insights`), with ids and query strings stripped from URLs before they're sent.
- **Essential panel (2026-11-11):** reports are read against Nue Health's panel (Core 77, Advanced 93 per sex; `docs/research/nuehealth-biomarkers.md`): Claude copies those markers and only lab-flagged extras, and ratios are worked out in code, never by Claude. Mayank asked for this to cut API cost.
- **Brands in stacks (2026-11-09):** Mayank asked for named brands. The platform's stack names 2–3 brands sold in India per item, found by Claude's web search, under a plain note that D-Human has no brand partners and earns nothing from them. The landing page still names no brands.
- **Safety floor (2026-11-09):** reads are AI and say so; they never diagnose. Conservative doctor and urgent thresholds in `lib/domain/markers.ts` (checked only when units match) force a "Doctor first" verdict whatever Claude writes. Stacks only add an item for a low or edge marker or a repeated food gap; iron only with low ferritin and a doctor check.
- **Copy:** taken from the pitch deck. No disease claims; use "screening", "markers" and "risk". Only sourced numbers: 76% vitamin D deficient across 2.2 lakh lab tests in 27 Indian cities, 2023 (source in the pitch deck). Never name lab or supplement brands on the landing page (the platform's stack is the one exception, for supplements; see "Brands in stacks"); attribute as "research across…". Anything else shown as data is labelled illustrative. No test-plan prices until partner pricing is confirmed (the platform's ₹49 pass is Mayank's price).
- **Motion:** the hero's hand-written WebGL contour field (inspired by illumelabs.ai's cinematic hero, not copied); the vitamin D chart's fill and picker (Motion); silk threads on the Join buttons; the "Test first" phone loop (a HyperFrames render, played only in view, with the four steps as chapter controls and a Pause button). All respect reduced motion: the phone shows chapter stills instead, as it does for Data Saver. The silk threads are also off on touch screens.
- **Chart picker:** each of the 100 squares is a fixed person (seeded, so the same on server and browser) with five markers: vitamin D follows the chart, the others (B12, ferritin, magnesium, hsCRP) are illustrative, and the flagged ones become their stack. Squares can be tapped; keyboards use the button.
- **Contour field architecture:** drawn in a Web Worker on an OffscreenCanvas (`renderer.ts` + `field.worker.ts`), started only after load, at idle, and when near the screen; 30 fps cap; a still frame on software rendering or reduced motion. Falls back to the main thread where workers can't run WebGL (e.g. Safari 16.4).
- **Touch:** hover styles only under `(hover: hover)`, pressed (`:active`) feedback instead, tap targets of at least 44 px, email keyboard shows "Send".
- **Devices (2026-11-12, Mayank asked for the best experience on phone, tablet and laptop):**
  - **Phones:** one column, tab bar at the bottom.
  - **The app's top bar is fixed, not sticky (2026-11-13),** over a 3.5rem spacer (`pt-14` in the app layout), and html's `scroll-padding-top` equals it. See the iPhone gotcha.
  - **Phones turned sideways:** the `short` variant in `globals.css` (landscape, at most 32rem tall). The app's top bar scrolls away (`short:max-lg:absolute`) and the tab bar is compact, icon beside label, so the page keeps the height. Use `short:max-lg:` so laptops in a short window keep the rail.
  - **Tablets, from `md` (768 px):** the home bib and verdict sit side by side, everything else full width below. Onboarding's buttons follow the question instead of sitting at the bottom of a tall screen.
  - **Laptops, from `lg` (1024 px):** the side rail. Home keeps the bib pinned on the left; Fuel keeps today's ring pinned on the left while meals are logged on the right. Home's markers pair up only from `xl` (1280 px).
  - **Kept as one reading column:** the report, Stack, Settings and Upload (`max-w-2xl`/`3xl`), because they read as documents and forms.
  - **Headlines that sit in a column are sized to the column** with container units (`@container`, `cqi`), not to the window: the verdict (a smaller size when over 60 characters) and the landing's "Test first. Supplement second." beside the phone.
- **Waitlist:** email only up front, then optional questions. Bots are caught by a honeypot field and a best-effort limit of 5 attempts a minute per IP (kept in memory, so per server instance).
- **Apps Script:** escapes values that could run as formulas or lose leading zeros; `setup()` builds and formats the tab and never deletes data.
- **Google Form (2026-11-01):** one list, two ways in. Answers land in the `Waitlist` tab; Google's `Form responses` tab is only the raw record. Same optional questions and labels as the site, matched by question ID so wording can change. An email already on the list keeps its row and first Source, and the form fills blanks only, because unlike the site it can't prove who is typing. It has no honeypot or rate limit, and each new address it accepts gets a welcome email.

## Gotchas

- **Stale CSS in dev:** Turbopack's dev cache once served CSS missing a new `@utility`. Stop the server, delete `.next/dev`, restart.
- **WebGL in dev:** React Strict Mode runs effects twice. Never call `WEBGL_lose_context().loseContext()` in cleanup, or the reused canvas stays dead (a white hero).
- **Vercel variables:** changes only apply after a Redeploy. Enter values without quotes. Duplicate keys in one "Add" dialog fail with "already exists".
- **Testing Apps Script with curl:** `curl -X POST -L` keeps POST on the redirect and gets "Page not found". `fetch`, which the app uses, works.
- **WebGL blocks the page while it starts:** creating a context is synchronous; it measured about 0.4 s on this Mac's GPU and about 2 s on a cold software renderer (what Lighthouse uses), on top of waiting behind the GPU process while it paints the page. That took mobile Performance down to 39. Keep WebGL setup in the worker.
- **Vercel region:** functions default to Washington DC (`iad1`) even though Indian visitors enter at Mumbai; with the database in Mumbai that adds about a quarter second per query. `vercel.json` pins `bom1`. Check with the `x-vercel-id` header: `bom1::bom1::…` means edge and function are both in Mumbai.
- **Measuring performance:** run Lighthouse against a production build (`next build` + `next start`), not `next dev`. Command: `npx -y lighthouse@12.8.2 <url> --form-factor=mobile --screenEmulation.mobile --chrome-flags="--headless=new --enable-unsafe-swiftshader --use-angle=swiftshader"`.
- **Script-made forms and the public:** publishing is not enough. Anyone-with-the-link is a separate Drive permission (`type: anyone`, `view: published`, `role: reader`), and the owner can always open the form, so check signed out. `setupForm()` does both. Themes can't be scripted, so the header image is a manual upload.
- **The waitlist Sheet is out of reach from chats:** it isn't in the Drive of `mayank29deo@gmail.com`, the account the claude.ai Google connectors use, and no connector can run Apps Script. Script changes have to be pasted and run by hand.
- **Safe live check:** POST `/api/waitlist/details` with a fake token. 403 means the Sheets secret is configured; 500 means it is missing. Writes nothing.
- **Reduced motion in render:** Motion's `useReducedMotion()` reads the media query on the client's first render, so using it to choose markup causes a hydration mismatch. Use `useSyncExternalStore` with a server snapshot of `false` (as `LoopPhone.tsx` does).
- **WebP from ffmpeg:** Homebrew's ffmpeg has no WebP encoder. Export PNG frames and convert with `sharp` from `node_modules` (`node --input-type=module`, `import sharp from "sharp"`).
- **Cache Components and sessions:** anything that compares against the clock during render (`new Date()` in the session query) must come after `connection()`, or Next flags it while prerendering; `getSessionUser()` calls it first. A Suspense fallback must not read the URL (`usePathname`) on dynamic routes, so the nav's fallback is the URL-free `NavView`.
- **SVG and hydration:** Node and Chrome can differ in the last digit of `Math.cos`, which breaks hydration of computed SVG coordinates. Round them (`toFixed(2)`), as `Contour.tsx` and `Orbit.tsx` do. SVG also collapses runs of spaces in text; use em spaces.
- **Rotating SVG groups:** `transform-box: fill-box` spins a group around its own bounding box, which for text on part of a circle is off-centre; the orbit uses `view-box`.
- **PGlite:** it won't create its parent folder (`lib/db/index.ts` does), and two processes must never open the same data folder; give a second server its own `PGLITE_DIR`.
- **Headless screenshots on phones:** Chrome's `--window-size` can't go under about 500 px wide. Use DevTools device emulation; the session's `cdp.mjs` script in the scratchpad did that, plus clicks, typing and file uploads.
- **Full-page screenshots lie about screen-sized slides:** stretching the emulated window to the page's height (how `cdp.mjs` takes a full page) makes every `svh`/`dvh` slide that tall too, so the landing looked 19,000 px long in landscape. Judge those pages from screen-sized shots taken while scrolling.
- **Migrations and Supabase:** `drizzle/0000_init.sql` was hand-edited to be safe to run twice (`IF NOT EXISTS`, foreign keys in `DO … duplicate_object` blocks), so pasting it in Supabase's SQL editor and the deploy's own migration can both happen in either order. Keep new migrations the same way. Supabase serves `public` over its Data API, so every table has RLS on with no policies (`.enableRLS()` in the schema); a non-owner role saw 0 rows in a test, the owner all of them.
- **Migrations need Postgres 15+** from `0002` on (`NULLS NOT DISTINCT`); Supabase and PGlite both qualify. A dev server started before a new migration keeps the old schema until it's restarted (uploads 500 on the new `started_at` column).
- **Headless Chrome and the mic:** `getUserMedia` never resolves headlessly on this Mac even with permission granted, so real mic levels can't be tested here; use a synthetic stream or a device.
- **Scrolling chip rows:** hidden radios (`sr-only`, absolutely placed) inside a sideways-scrolling row widen the page unless the scroller is `relative`.
- **Function size on Vercel:** files reachable from server code are traced into every function. PGlite (62 MB) and the local `.data` folder were, until `outputFileTracingExcludes` in `next.config.ts`. Check sizes with the `.nft.json` files under `.next/server/app` after a build.
- **Drizzle journal times:** migrations run if their journal `when` is later than the last one applied, so a hand-written entry must sit in time order or databases that ran a later one skip it. `tests/migrations.test.ts` checks the order. Hand-written migrations also need a snapshot: generate with drizzle-kit, then rewrite its SQL to be safe to run twice.
- **iPhone tab switches opened part-way down (fixed 2026-11-13):** after a navigation Next.js only resets to the top (`scrollTop = 0`) when the new page's top edge sits at or below html's `scroll-padding-top`; otherwise it calls `scrollIntoView`. The padding was 5rem (for the landing's header) against the app's 3.5rem bar, so every tab switch took the `scrollIntoView` path. iPhone Safari ignores the root's scroll padding there (webkit.org/b/179379), so pages opened 56 px down with their first lines under the bar; on Home, Safari's scroll anchoring then carried the page to the verdict when the skeleton was swapped for the dashboard. Rules: keep `scroll-padding-top` equal to the app bar (the landing's anchor targets add `scroll-mt-6`), and keep the bar `fixed`, not `sticky`: iOS 26 ignores `scrollTo(0, 0)` near a stuck sticky element (webkit.org/b/304489). Check: count `scrollIntoView` calls on tab switches; it should be 0.
- **Safari's engine on this Mac:** Playwright's WebKit runs headlessly from the session scratchpad (`npx playwright install webkit`) and can sign in with a `dh_session` cookie minted by `/api/dev/session` on the dev server. It reproduces engine behaviour (scrolling, scroll anchoring, layout), not iOS toolbars, safe areas or touch momentum. Production-build checks of the app need `ANTHROPIC_API_KEY=` and `D_HUMAN_AI_MOCK=1` on `next start`, or meals call the live API.
- **Git identity:** not configured on this Mac, so commits are authored `Mayank Narayan <mayanknarayan@Mayanks-MacBook.local>`, which GitHub doesn't link to the account.

## Open items

- [x] Platform live (2026-11-09): Supabase tables in place; `DATABASE_URL` (or the integration's `POSTGRES_URL`), `ANTHROPIC_API_KEY` and `AUTH_SECRET` set in Vercel and redeployed. Checked live: sign-in codes save and send. The local key Mayank deleted on 2026-11-11 was a separate one; the Vercel key wasn't checked after that. Mayank put a new, working local key in `.env.local` on 2026-11-13.
- [ ] Razorpay: add the three variables in Vercel (test keys first) and the webhook in Razorpay's dashboard (URL, secret, events `payment.captured`, `payment.authorized`, `order.paid`), pay once in test mode end to end, then switch to live keys
- [ ] Razorpay usually wants Terms, Privacy, Refund and Contact pages on the site; none exist yet (Mayank's legal call, including whether passes are refundable)
- [ ] Footer says imaging and clinical tests are run by licensed partner centres; check that's still true now that people upload their own reports
- [ ] Refunds don't take a pass away yet; decide whether they should
- [ ] Landing follow-ups: a native speaker to check the Hindi and Hinglish examples in `components/site/Languages.tsx`; confirm the open-mode footer line; re-render or reframe the loop video (it shows home test booking and a clean-label bar); cut Anek Devanagari (726 KB) down to the weights used, for Hindi users in the app; local Lighthouse mobile was 85–87 before and after the redesign, so the 93–95 in the Snapshot is out of date
- [ ] Native-speaker check of the landing card's rotation texts (Hinglish, Hindi, Tamil, Bengali in `components/site/LanguageTabs.tsx` / `native.ts`) and of a few real meal replies in each language
- [ ] Typed Marathi gets a Hindi reply (both use Devanagari); spoken Marathi is right. Fix: send the remembered "Speaking in" pick as a hint for typed Devanagari
- [ ] Open mode still downloads about 65 KB of unused waitlist-page JavaScript (vitamin D chart, phone video, Motion) because `app/page.tsx` imports both trees
- [ ] Tour: "once" means finished or skipped; closing the tab mid-tour shows it again. Mayank to confirm, or mark it done when it opens
- [ ] Decide: free reads left unused are lost when someone buys a pass (history counts after it ends); deleting an account resets the free allowance and erases payment records (DPDP and accounting both matter here)
- [ ] Run `tests/billing.test.ts` once against real Postgres: PGlite runs one query at a time, so it can't prove the locks under real parallel load
- [ ] Re-run Lighthouse on the live site after the open landing page and Speed Insights
- [ ] Decide: purging report files after a read, Supabase Pro, share-card content, Hindi and Hinglish versions of the fixed doctor wording, and what to do about accounts made before the 18+ rule
- [ ] Human review before inviting people: a doctor on the safety thresholds and wording, and a DPDP Act privacy check
- [ ] Platform: run the live Claude read once against `tests/fixtures/sample-report.pdf` and a real report, and compare the `[ai] extract` cost line with the 2026-11-09 one (the essential-panel prompt hasn't run live yet)
- [ ] Platform next: doctor review of reads, phone/WhatsApp sign-in, Hindi app labels, speech-to-text for browsers without the Web Speech API, uploads over 4 MB

- [ ] Add DMARC: TXT on `_dmarc.dhuman.fit` with `v=DMARC1; p=none;`
- [ ] Share previews: set `NEXT_PUBLIC_SITE_URL` to `https://www.dhuman.fit` in Vercel (or delete it so the production domain is used) and redeploy; the og:image still points at `d-human.vercel.app`
- [ ] Set the git name and email so commits link to the GitHub account
- [ ] Optional: a Resend segment "Waitlist" and `RESEND_SEGMENT_ID`
- [ ] Later: reverse-engineer the architecture of other sites and platforms

## Log

Newest first. One entry per change; pushes carry their commit hash.

### 2026-11-13
- **iPhone: tabs opened part-way down, and blank pages while loading (Mayank, on his iPhone in the Google app's browser):**
  - **Reported:** the text at the top of each page wasn't visible until he scrolled up, pages looked stale after switching tabs, and his screenshot showed Home opening on the verdict.
  - **Cause, reproduced in WebKit:** Next called `scrollIntoView` on 19 of 21 tab switches, because html's scroll padding (5rem) was taller than the app bar (3.5rem). With iPhone Safari's handling of that call mimicked (it ignores the padding), every switch to Home ended 400 px down, on the verdict, matching his screenshot. Details in Gotchas.
  - **Fixed:**
    - html `scroll-padding-top` is 3.5rem, the app bar's height. The landing's `#join` and closing section add `scroll-mt-6`, so its anchors still land 80 px down (checked at 390 and 1280 px).
    - The app's top bar is `fixed` over a `pt-14` spacer instead of `sticky` (`Nav.tsx`, app layout). It still scrolls away on sideways phones and starts after the rail on laptops.
    - Tab pages show their own title, "Loading…" and, after 6 s, a Reload offer while their data streams in (`components/platform/PageLoading.tsx` for Fuel, Upload, Wraps, Stack and Settings). They were an empty black page until the server answered.
    - The tab bar's black carries on below it (`after:`), so the page no longer shows through the strip under it when the browser hides its toolbars (seen in his screenshot). Off at laptop width.
  - **Checked:**
    - In WebKit as an iPhone, plain and with iOS behaviour mimicked: 21 tab switches from 0, 30 and 600 px down, 0 `scrollIntoView` calls, every page at the top with its first line under the bar.
    - Fresh data after switching: a meal logged behind the page shows on Fuel and Home.
    - With navigations held 1.5 s, each tab shows its title and "Loading…" by 0.3 s.
    - Header and tab bar geometry unchanged at 390, 844×390, 768, 1024 and 1440 px; no sideways scroll.
    - Typecheck, lint, 185 tests and the production build.
  - **Not checked:** a real iPhone; WebKit on a Mac has no iOS toolbars or safe areas, so the tab bar's bottom edge needs his phone.

### 2026-11-12
- **Push `c237fc8`:** the device layouts.
- **Every screen fitted to phones, phones turned sideways, tablets and laptops (Mayank's request):**
  - **Audit first:** every app screen and the landing at 360, 390, 844×390, 932×430, 768, 820, 1024, 1180, 1280, 1440 and 1920 px. Nothing scrolled sideways anywhere, and form fields were already 16 px, so iPhones don't zoom in on them.
  - **What was wrong:**
    - Sideways phones: the two bars took nearly a third of the height, and the bib filled the screen.
    - Portrait tablets: the phone layout stretched, with a 720 px bib.
    - Landscape iPad (1024): the verdict ran to 8 lines and the marker cards were squeezed into pairs.
    - Laptops: Fuel was a narrow column.
    - Landing: "Supplement" in the loop slide's headline touched the phone at 1024 px and ran under it at 1920.
    - Tap targets: हिंदी's tab was 23 px wide; contour dots were 29 px on a 360 px phone.
  - **Fixed:**
    - `short` variant: on sideways phones the top bar scrolls away and the tab bar is compact. Settings' save bar sits exactly on the tab bar in both sizes (it floated 23 px above it).
    - Home: bib and verdict side by side from 768 px; markers pair up only from 1280 px.
    - Fuel: two columns on laptops (`FuelLogger.tsx`; the diff is mostly re-indenting).
    - Verdict and the landing's loop headline: sized to their column. The verdict on the landscape iPad went from 8 lines to 5, and the loop headline now clears the phone by 60–98 px at 1024 to 1920.
    - Wraps: story numbers are bounded by screen height too, so every slide fits sideways.
    - Onboarding: buttons follow the question on tablets and laptops.
    - Tap targets: language tabs at least 44 px wide; contour dots as large as the gap to their neighbours allows (33 px with 20 markers at 360 px).
  - **Checked:** typecheck, lint, 185 tests and the production build, then screen-sized shots at 390, 844×390, 768, 1024 and 1440 px of home, Fuel, Settings, wraps, onboarding and the tour. No sideways scroll at any size. Waitlist mode is untouched (only open-mode components changed).
  - **Not checked:** real devices (iPad Safari, Android Chrome in landscape) and the home-screen app with its safe areas.

### 2026-11-11
- **Push `d617370`:** the voice logging upgrade.
- **Voice logging: live mic, auto-log after a pause, reply in the language actually spoken (Mayank's request):**
  - **Mic bars** (`components/platform/VoiceMeter.tsx`) sit beside "Listening in…".
    - Real levels come from a second mic stream only on desktop Chromium, once the recogniser has the mic and permission is already granted, within 1.2 s, and never again after an `audio-capture` error.
    - Everywhere else the bars follow recognition events.
    - Reduced motion: the bars stay still and no stream opens.
  - **Auto-log** (`components/platform/autolog.ts`, a pure state machine with tests):
    - After a final result, 2 s of silence (or `speechend` / Chrome's `onend`) starts a 2 s countdown, "Logging in 2…", with Keep talking and Edit above the fold.
    - The Log button reads "Log now" during it.
    - Typing, Edit, Stop, Cancel, errors and a hidden tab disarm it. It never starts when the plan blocks meals.
    - Only one log per countdown.
  - **Reply language:** the picked language is a hint. The model returns `reply_language` (new in `MealSchema`), and writes in the language and script the words actually use, so Hindi spoken with English picked gets a Hinglish reply.
    - `settleReply` in `speech.ts` validates it; it's stored in `micros.lang`, and `langTag` sets `hi-Latn` and similar.
    - A quiet "Sounds like Hindi? Listen in हिंदी" suggestion appears when English is picked and the words look like Hindi in Latin letters.
    - Typed Latin words from a Hindi-language user now expect a Latin-letter reply.
  - **Checked:** typecheck, lint, 185 tests (20 new), the build, and headless Chrome with a stand-in recogniser (bars move, auto-log fires once, Edit cancels, the suggestion shows, a Hinglish reply). A real mic and Android timing are only verifiable on devices.
- **Push `9847375`:** the 5-slide landing page.
- **Landing page in 5 slides, alternating black and white (Mayank's request):**
  - **Slides:**
    1. Hero, black.
    2. Fuel with the rotating multilingual card, white (`LanguageTabs` has a `tone` prop).
    3. Blood reports, black: "Know your numbers before you buy another bottle.", the 76% line, and "Coming soon: blood tests through D-Human".
    4. The phone loop back as it was, white, in three columns on desktop: "Test first. Supplement second.", the phone, the four steps.
    5. Start free plus the footer, black.
  - Open mode's Retest step now says "Key markers again when your read says". The phone's poster loads only near the slide, which kept LCP at 3.6 s.
  - **Checked:** Lighthouse mobile 88–90 locally (unchanged); waitlist mode identical by pixels; no overflow at 320, 390, 430 or 1440 px; typecheck, lint, 165 tests and the build pass.
- **Push `93850a9`:** meals in 12 languages and the 4-slide landing page.
- **Meals in 12 Indian languages, and a 4-slide landing page (Mayank's request):**
  - **Voice (staff engineer):** Fuel's Say has a "Speaking in" row with 12 languages (`lib/domain/speech.ts`): English, Hinglish, हिंदी, বাংলা, मराठी, తెలుగు, தமிழ், ગુજરાતી, ಕನ್ನಡ, മലയാളം, ਪੰਜਾਬੀ, اردو.
    - It defaults to the app language and remembers the last pick (`dh-spoken`).
    - Speech recognition listens in that language; a refusal says to type instead.
    - Where Chrome's on-device Translator already has the language (desktop only, rare), the words go to English in the browser (`components/platform/translate.ts`, 2.5 s limit, never starts a download). The server sends Claude their words plus that English.
    - The meal's title and tip come back in the language spoken. Typed meals go by script; Latin script or no words falls back to the app language. `input_text` keeps their own words.
    - Reads, wraps and stacks stay en/hi/hinglish.
    - Fixed on the way: transcripts over 1000 characters, late speech refilling the box, and listening errors showing off screen.
    - A line under the row says browsers may use their maker's servers to turn voice into words. In Chrome they do, so "transcribed in the browser itself" isn't literally true.
  - **Landing (designer), 4 slides in open mode:**
    1. Hero.
    2. Fuel, with a calorie card rotating through English, Hinglish, हिंदी, தமிழ், বাংলা every 3.5 s. Tabs can be tapped; it pauses on hover and focus, and stays still with reduced motion.
    3. Blood reports: the 76% figure, Upload, Read, Stack and Retest, and "Coming soon: blood tests through D-Human".
    4. Start free plus the footer.
    - The page is 3,869 px tall at 390 px, down from 8,076. Local Lighthouse mobile 82–89 (was 82–86), LCP 3.5 s (was 4.1).
    - Languages, TestsSoon, PlayOnView and Hindi components were folded in and deleted.
    - System fonts are used for Devanagari and Bengali, so the 726 KB Anek file isn't fetched.
    - Waitlist mode was compared by pixels and is still identical.
  - **Checked:** typecheck, lint, 165 tests (25 new), the production build (functions still about 3 MB), and the voice screens in demo mode with a stand-in recogniser and translator. Not checked: a real microphone, the real Translator, a live Claude call in other languages, and which language tags real browsers accept (`pa-Guru-IN` and `ur-IN` are least certain).
- **Push `93c7b23`:** the Fuel-first landing page, the tour, "tests coming soon" and the loading fix, live in about 50 s (migration `0006` ran on Supabase). Checked live: the new title and sections on `/`, no waitlist wording, the tour and billing routes give 401 signed out, and a function's first response after the deploy took 0.45 s (1.15 s before), then 0.21 s.
- **Fuel-first landing page, first-run tour, "tests coming soon" (Mayank's requests):**
  - **Landing, open mode (crew designer):**
    - Hero leads with calorie and protein tracking for Indian meals and shows English / हिंदी / Hinglish.
    - New `Fuel` section: Snap, Say, Type, a logged-meal card and a Today ring, all labelled illustrative, playing once in view through `PlayOnView`.
    - New `Languages` section: the same meal note in three languages; voice listens in Hindi only when Hindi is the chosen language, and buttons stay in English.
    - Reports second, then the new `TestsSoon` section ("Coming soon: Blood tests through D-Human"), then a closing "Start with your next meal".
    - Title "D-Human | Calorie tracking for Indian meals"; mode-aware description and footer.
    - Waitlist mode checked identical, by DOM and pixels.
    - The landing's Devanagari uses the phone's own font: Anek Devanagari's Devanagari part is 726 KB.
  - **First-run tour (crew designer):**
    - `components/platform/Tour.tsx` and `tour-stops.ts`, mounted in the app layout in its own Suspense boundary.
    - 6 stops, Fuel first, each spotlighting the real nav item, with Skip tour, Back, Next, Esc and arrow keys, in a native `<dialog>`.
    - Shown once per person: `profiles.tour_done_at` (migration `0006` adds it and backfills already-onboarded people, only on the run that adds the column), `POST /api/profile/tour`, a local-storage backup, and "Replay the app tour" in Settings.
    - Onboarding's finish now leads with "Log your first meal".
    - Dev session: demo people count as toured; `&tour=1` replays the tour; `?as=fresh&new=1` gives a brand-new person.
    - `@source not "../video"` in `globals.css`, because Turbopack crashed scanning an unreadable video file in `video/assets`.
  - **Coming soon:** "Blood tests through D-Human" on the landing page, the upload page and the tour's upload stop. The landing's "Test" step says tests through D-Human are coming soon, which also squares the loop video's booked-test screen.
  - **Checked:** typecheck, lint, 140 tests, the production build, the new section and tour stop at 390 px, and no overflow.
- **Home stuck on its skeleton (Mayank, after sign-in), pushed in `93c7b23`:**
  - **Measured locally:** sign-in to dashboard took 0.5 to 0.9 s in dev, and the production build gave 0.35 to 0.47 s for a full load and 0.33 s for a client navigation. Not reproducible locally, so the cause is production-only.
  - **Found:** every deployed function shipped 65 MB, 62 MB of it PGlite, which production never uses. Cold starts paid for all of it. `outputFileTracingExcludes` now leaves out PGlite and `.data`, so functions are about 3 MB.
  - **Postgres:** idle connections now last 120 s instead of 20, so a reader tapping on after a pause doesn't reconnect every time. Connecting gives up after 10 s instead of 30.
  - **Navigation:** sign-in, sign-out and account deletion do a full page load. Report upload and delete do one `router.push` instead of push plus refresh (two server renders).
  - **Loading screen:** home's loading screen now shows "Log a meal" and "Upload a report" at once, a loading line, and after 6 s "This is taking longer than usual" with Reload (`components/platform/Stall.tsx`).
  - **Errors:** `app/(platform)/(app)/error.tsx` catches failures with "Try again".
  - **Logs:** a home load over 1.5 s logs `[home] slow load` with where the time went.
  - **Live baseline before this deploy:** a function's first response was 1.15 s, then 0.22 to 0.26 s warm.
- **Push `de4d9fe`, Vercel Web Analytics:** Mayank enabled it in Vercel after `ba72a35` (its script went from 404 to 200), so `@vercel/analytics` 2.0.1 joins Speed Insights in `components/Vitals.tsx`, with the same URL scrubbing. Checked: typecheck, lint, 125 tests, production build.
- **Push `ba72a35`:** everything since `f72d2ee` in one commit: the open landing page and ₹49 pass, AI-analysed-only copy, the essential panel and ratios in code, rules-built stacks, shared events, the kickoff fixes, Speed Insights, migrations 0002 to 0005. Live in about 60 s. Checked live: "Start free" and the price line on `/`, no waitlist wording, `/signin` says "Start free or sign in", the billing routes give 401 signed out, the webhook gives 503 (no secret in Vercel yet), the Speed Insights script is served, the new Permissions-Policy is live, and functions run in `bom1`. The build succeeding means Supabase took migrations 0002 to 0005.
- **Open sign-up, ₹49 pass and Speed Insights (Mayank's request):**
  - Landing: a crew agent built `lib/site-mode.ts`, `components/site/StartForm.tsx` ("Start free", which carries the email to sign-in in sessionStorage, never the URL) and `lib/signin-handoff.ts`. Header "Sign in", "Find your number" to `/signin`, mode-aware description and manifest, and a new open-mode hero line about uploading a report you already have. Waitlist mode checked pixel-identical to the old page. Sign-in now says "Start free or sign in".
  - Paywall: `lib/domain/plan.ts`, `lib/platform/plan.ts`, migration `0004_billing` (`payments`, `usage`, RLS on, backfills past reads and meals). The claim sits inside `claimReport`'s transaction, and a finished report can't be read again. Meals are claimed in `/api/food` and released on any failure.
  - Razorpay: `lib/billing/razorpay.ts` (REST), `lib/billing/signature.ts`, `lib/platform/billing.ts`, and the routes `/api/billing/order`, `/verify` and `/webhook`. The Permissions-Policy allows payment for Razorpay's frames. Paywall card, Pay button and usage lines on Upload, Fuel and Settings.
  - Speed Insights (`@vercel/speed-insights` 2.1.0).
  - QA review (crew agent) found no way to get a pass without paying; fixed what it found: meal uses now carry the meal's id (re-running 0004 double-counted meals), a failed read is marked failed and handed back in one transaction under the read lock, dead reads are settled before a plan is counted, meal AI calls give up within the route's limit, a failed capture makes the webhook answer 503, payments need the webhook secret, `reconcileOrders` (Settings and `/api/billing/sync`) catches missed webhooks, and passes record test or live mode (migration `0005`, with the drizzle snapshot that was missing). Webhooks are signed over the raw bytes.
  - Checked: typecheck, lint, all tests (new `tests/plan.test.ts` and `tests/billing.test.ts`: parallel claims, refunds, a pass granted once per order, wrong amounts, others' orders, forged webhooks), a production build with the database unreachable, and in demo mode the backfilled paywall on Upload, 5 meals then 402 on Fuel, the Settings card, and Pay failing politely with placeholder keys. No overflow at 390 px. Not checked: a real Razorpay Checkout (no test keys on this Mac).
- **Essential panel and ratios in code (cost), pushed in `ba72a35`:**
  - The catalogue (`lib/domain/markers.ts`) now holds Nue Health's 95-marker panel in 11 groups (a new "White cells" group), 12 of them worked out in code.
  - Haiku copies only the panel, plus at most 10 off-panel results the lab flags, and skips the ratios. That means less output on long Indian full-body reports (urine routine, serology, printed ratios) and fewer rows in the Sonnet read.
  - `lib/domain/derived.ts` works out non-HDL, TC/HDL, LDL/HDL, TG/HDL, ApoB/ApoA1, NLR, globulin, A/G, indirect bilirubin, BUN/creatinine (from urea when needed), HOMA-IR and FAI, after unit conversion, only when not printed. They're shown against typical ranges as "calculated from your results".
  - `differentialKey` picks a white-cell count or percentage by unit.
  - Fat loss now weighs HOMA-IR and TG/HDL; longevity weighs ApoB and Lp(a).
  - The brand cache can fail without failing the stack (brands are left out), and the stack's wait copy no longer says "a minute or two".
  - Estimate from the 2026-11-09 cost logs (not re-measured; no live key on this Mac): a first report plus stack goes from about $0.19 to about $0.03 a person, mostly because the stack's ~$0.16 is gone.
  - Checked: typecheck, lint, 99 tests, a build with the database unreachable, a demo upload (4 ratios on the report, no doctor-review wording, no overflow at 390 px) and a rules-built stack after a dev restart.
- **Research: Nue Health biomarker catalogue** (`docs/research/nuehealth-biomarkers.md`, text only; JSON copy kept in the session scratchpad). Read from nuehealth.in's shipped data module, the pre-rendered `/biomarkers` rows, its JSON-LD and the `/compare` code, all of which agree. They give 95 markers in 10 systems: Core 77, Advanced 93 for each sex, matching the published counts. Advanced adds 14 markers for both sexes, plus PSA total and free for men and progesterone and AMH for women. `/compare`'s 38 extra rows (omega-3 index, heavy metals, ANA, NMR lipids and others) are Function Health or Orange Labs only. No public page or shipped JS states reference ranges; units appear for 20 markers, mostly indirectly. Not committed.
- **AI-analysed reports, no doctor review (Mayank's decision):** every "doctor-reviewed" promise is gone: the hero line and page description ("analyses the results with AI"), the "Test first" steps and alt text, the hidden Plans list, Tests and the footer, the welcome email, and the report page ("AI-analysed report. Not a diagnosis."). The loop video was re-rendered with "Then AI analyses every result" and an "AI / analysed" stamp; stills refreshed, seam unchanged (83.4 dB). The "see a doctor" flags stay: they send people to their own doctor.
- **Stacks worked out in code (cost):**
  - `lib/domain/supplements.ts` turns markers and food gaps into a plan with conservative doses, cautions, food first and what to skip. It holds for pregnancy and kidney conditions, puts medicines into the cautions, and offers iron only once a doctor agrees. 10 tests.
  - The safety floor runs on the English plan; Hindi and Hinglish get a Haiku translation that must keep the same items, else English shows.
  - Brands come from a shared monthly cache (`brand_picks`, migration `0003`, RLS on; `lib/platform/brands.ts`), one search of at most 2 per nutrient and diet variant for everyone.
  - Stacks now work with no AI key, without brands.
  - Event searches are shared by metro area (`lib/domain/region.ts`: Navi Mumbai, Thane and Bombay share Mumbai) and refreshed every 14 days.
- **Kickoff fixes (Mayank: "go ahead fix it"), pushed in `ba72a35`:** three crew lanes in parallel plus the orchestrator; plan in `docs/team/plans/2026-11-11-kickoff-fixes.md`, findings in `docs/team/kickoff/`.
  - **Safety:**
    - `lib/domain/safety.ts` forces fixed "See a doctor before <event>." / "Show a doctor first." wording when a marker is flagged.
    - Stacks are checked in code: no item for a flagged marker, nothing at all when urgent, iron only with measured low ferritin.
    - A marker printed twice keeps its worst reading, and an unknown unit on a bounded marker blocks "go".
    - Flags now convert about 20 lab units first (`toCatalogUnit`, `unitKnown` in `markers.ts`): platelets per cumm and in lakhs, mmol/L, nmol/L, mmol/mol, µmol/L.
  - **Reads and stacks:**
    - Claimed atomically with `reports.started_at`; stale after 15 minutes, a 280 s deadline, one transaction for markers, read and status.
    - Daily caps in the database: 10 reads and 5 stacks per person.
  - **Sign-in:** atomic attempt claims, codes single-use, 5 an hour and 10 a day per email, user and profile created in one transaction.
  - **Migration `0002_integrity_and_indexes`** (needs Postgres 15+, safe to run twice):
    - `reports.started_at` and `events.query`, plus four indexes.
    - Events deduplicated with a `NULLS NOT DISTINCT` key that includes `query`.
    - `stacks.report_id` is `ON DELETE CASCADE`.
    - `scripts/db-migrate.mjs` migrates only for Vercel production builds, under a transaction-level advisory lock.
  - **Events:** a typed event's results are seen only by people who typed the same text, and the typed name is treated as data in the prompt.
  - **AI:** reads don't wait on event searches when a target exists; web-search JSON tolerates missing keys; extraction retries once on Sonnet; fitting refusal messages; cache tokens priced right.
  - **Screens:**
    - One request helper (`components/platform/net.ts`) so no button sticks, and failed deletes say so.
    - No sideways scroll.
    - Onboarding starts with consent, then language; 18+ only, enforced by the profile API too; consent names Claude by Anthropic and processing outside India.
    - Home: Today's fuel under the verdict, and a retest countdown on the bib and report.
    - Fuel ring shows going over target; stack items numbered; contour shapes and a key, drawn once per session.
    - Anek Devanagari for Hindi, not preloaded.
  - **Platform:** baseline security headers in `next.config.ts`; profile saves capped at 30 an hour and only searching events when city, sport or event change; picking someone else's private event gives 404.
  - **Checked:** typecheck, lint, 79 tests, a build with the database unreachable, the migration on the existing local data, upload to verdict in demo mode, and no overflow at 390 px.
- **The crew:** nine specialist agents in `.claude/agents/` at Mayank's request: `svp-product`, `chief-of-staff`, `staff-engineer`, `systems-data-engineer`, `ai-efficiency-lead`, `product-designer`, `ux-retention-designer`, `graphic-designer`, `qa-security-engineer`. Each carries the house rules (brand, health copy, safety floor, no commits, no secrets, never claim real credentials). Who does what and how work flows: `docs/team/CREW.md`; `CLAUDE.md` points to it. Claude Code loads project agents at session start, so this session ran the kickoff as general-purpose agents told to read their role file. Kickoff: eight reviews in parallel, findings in `docs/team/kickoff/`, the map and roadmap in `docs/team/`.
- **Push `f72d2ee`:** the Fuel facts library and the green, shared orbit (below).
- **Fuel facts and a greener orbit (Mayank's request):** a static facts library (`lib/domain/food-facts.ts`, no AI cost) picked by age, height and weight in 5-unit bands (ending on multiples of 5: 21–25 years, 166–170 cm, 61–65 kg), diet and sex, plus about 35 facts for everyone. Each height and weight band gets facts with its own computed numbers (Indian healthy-weight range at BMI 18.5–22.9, half-height waist, protein, a 5 km run in food, walking off a samosa, water). Logging a meal or a usual day now opens the orbit with these facts; the person's bands circle in the outer ring and each fact says whom it's for. When done, the result shows in the centre and the facts stay one tap away until Done. The orbit became one shared component; its progress ticks run from pale to full green, for reports too. On phones it's 150% of the screen width so the centre has room. Checked at 360 and 390 px in demo mode; 36 tests pass.
- **Local Anthropic key stopped working:** calls from this Mac got `401 invalid x-api-key` on 2026-11-11 with the key unchanged in `.env.local` since 2026-11-09, so it was revoked or deleted in the Console. The local dev server now runs in demo mode until a new key is added.

### 2026-11-09
- **Push `d63af68`:** cheaper models per job and cost logging (below). Earlier today: **push `9bec133`** (functions in Mumbai, parallel queries, faster reads).
- **Cheaper models per job (Mayank asked after Opus 5.5 ran up $0.86 on his first tries):** reading values off reports, meals, the typical day and wraps on Claude Haiku 5.5; the read, event searches and stacks on Claude Sonnet 5.5 (`MODELS` in `lib/ai/client.ts`, switchable per job with `CLAUDE_MODEL_<JOB>` or all at once with `CLAUDE_MODEL`). Meals run with thinking off. Searches carry the person's city and India as their location, and every call logs `[ai] job model in out searches ~$cost seconds`, plus each search query and the sites it returned. Measured live on this Mac with Mayank's key, on the sample report as Priya (40, runner): extraction 11.2 s ~$0.002, read 14.4 s ~$0.024 (whole read 25.7 s), event search 22 s ~$0.13 (3 searches, shared by sport, city and named event for a week), meal 4.3 s ~$0.0005 (was 11.6 s with thinking), stack 42 s ~$0.16 (4 searches). Read quality on Sonnet checked by eye: specific, food-first, careful with CK/AST, and it noticed the sample's male ranges on a woman's profile. Stacks first came back without brands; after locating searches in India and allowing brand-site or major Indian pharmacy and marketplace pages, they name 1–2 brands per item, saying when a link is only a listing page.
- **Speed (Mayank: tab switches, report reads and the dashboard were slow):** measured the live site: requests entered Vercel at Mumbai (`bom1`) but functions ran in Washington DC (`iad1`), so every Supabase query crossed the world (a 2-query call took 0.86 s against 0.27 s for a static page). Now `vercel.json` pins functions to `bom1`. The dashboard's ~12 sequential queries run in two parallel batches, events and the target come from one helper (`eventsFor`), and the upload page no longer loads the whole dashboard. Report reads: extraction at low effort, the read at medium (overridable with `CLAUDE_EXTRACT_EFFORT` / `CLAUDE_READ_EFFORT` set to `medium` / `high`), notes only for markers that matter (the report page falls back to the catalogue's sentence), and at most 8 s waiting for an event search.
- **Supabase set up (no code):** Mayank created the Supabase project "D-human" (free plan) and ran both migration files in its SQL editor, choosing "Run and enable RLS" at Supabase's prompt. The check query showed all 15 tables with RLS on. Still to do: Vercel variables and a redeploy.
- **Push `fb73a64`:** the Supabase integration fallback below, plus the push record for `99168f2`.
- **Database URL from Vercel's Supabase integration:** the app and the build-time migrations now use `POSTGRES_URL` when `DATABASE_URL` is absent (`lib/db/url.mjs`), and drop the `supa` and `pgbouncer` URL options that integration adds, which the `postgres` driver would otherwise send to Postgres as settings.
- **Push `99168f2`:** platform Phase 1, the Supabase-ready migrations and the Nue Health teardown, live in about 48 s. Checked live: landing 200 with the tagline, waitlist details 403 on a fake token (Sheets secret fine), `/signin` 200, `/home` signed out redirects to `/signin`, platform APIs 401 signed out, dev routes 404. Sending a sign-in code returns 500 until `DATABASE_URL` and `AUTH_SECRET` are set in Vercel.
- **Platform ready for Supabase:** migration `0001_row_level_security` (RLS on all 15 tables), `0000_init` made safe to run twice, Supabase steps in `docs/platform/PHASE-1.md`. Tested on fresh embedded databases: deploy then paste, paste then deploy, and a non-owner role reading nothing. Production build passes with the database unreachable, so nothing touches it at build time.
- **Platform Phase 1 built.** Email-code sign-in (`lib/auth/`), 13-step onboarding that saves as it goes, persona engine (10 activities by 4 levels, marker priorities, facts, event searches), report upload with streamed progress and the orbit screen, Claude extraction and read (structured outputs, server-side refusal fallback, high effort for the read), the safety floor, events found by Claude web search and shared by region, the dashboard (bib with animated emote, verdict, metrics that matter, pointers, contour fingerprint, events to aim at), the full report, Fuel (photo, voice through the Web Speech API, text; ICMR-NIN 2020 targets; 14-day gaps; typical day), Wraps (week, month, year cards), Stack (brands with the no-partners note, "You don't need these"), Settings with delete everything. Postgres through Drizzle with migrations in `drizzle/`; embedded PGlite locally. Checked: 26 tests (`npm test`), typecheck, lint, `next build`; every screen in demo mode at 390 px (no overflow) and 1440 px with no console errors; upload to verdict end to end; sign-in, code reuse, lockout after 5 tries, sign-out; signed-out redirects and 401s on a production build. Not checked: any live Claude call (no Anthropic key on this Mac). The REA MCP server didn't connect this session; the teardown used its CLI.
- **Research: Nue Health teardown** (`docs/research/nuehealth-teardown.md`, text only). A front-end teardown of nuehealth.in and its logged-out onboarding app, made with the REA CLI (1440 and 390 px captures) and curl. Covers stack, sections, colour and type counts from the shipped CSS, motion, flows, and how they present reports and markers. Ends with what D-Human should take and avoid. Screenshots stay in the session scratchpad and are referenced by path. Nothing was submitted or booked. Not committed.

### 2026-11-01
- **Google Form live:** Mayank pasted `Code.gs` into the Sheet's Apps Script, ran `setupForm`, did the remaining setup steps and confirmed the form works end to end on real Google. Running `setupForm` again keeps the same form and prints the share and edit links.
- **Push `67d8328`:** the Google Form code and `/api/waitlist/form`, shipped together with the 30 Oct tagline change, so the site, welcome email and share image now say "Hack your health." Live in 44 s. Checked live: the route refuses a missing or wrong secret, the follow-up route still gives 403 on a fake token, the page carries the new tagline and not the old one, and the Sheets web app still answers. The live route was not called with the real secret, because that sends a real email.
- **Google Form as a second waitlist source:** `setupForm()` in `google-apps-script/Code.gs` builds the form, links it to the Sheet, opens it to anyone with the link and adds a trigger that files answers in the `Waitlist` tab. New route `/api/waitlist/form` sends form signups the welcome email and adds them to Resend, so launch broadcasts reach both sources. `saveContact` now takes a first name, and `form-header.jpg` is the theme header. Tested: `Code.gs` against strict stand-ins for Google's services (25 cases; 20 deliberate bugs all caught), and the route on a production build with a stand-in Resend. Not yet run on real Google, which needs `setupForm` run by hand.

### 2026-10-31
- **YC demo approved and delivered:** Mayank approved the full film, and the 75 s cut for the YC application is made from the 15 marked shots. Files: `renders/D-Human-YC-demo-129s.mp4` and `renders/D-Human-YC-demo-75s.mp4` in the studio project. Both -14.1 LUFS, -1.8 dBTP or lower. One sound fix went into both after approval: "to you" in S15 was being covered, so the Booked chime and scooter moved; the approved picture is unchanged. Mayank confirmed the Ananya illustration is cleared for use.
- **YC demo, narrator fixed:** Mayank heard the D-Human voice change. The voice id was always Miles, but nine Deepgram takes had drifted from the approved sound, the worst 14 semitones high (S12 at expressivity 1). They were regenerated, matched against the Act 1 voice with the project's `tools/voice_match.py`, and the picture re-timed to the new words. Re-rendered at full quality.
- **YC demo, full film built (Acts 3 to 10):** all 30 shots now play in the studio project, reviewed as `renders/D-Human-YC-demo-draft.mp4`; final render and the 75 s cut wait for approval. New: the upload path, a booking flow with India's towns running behind the phone, the report and gauges, care team, the white capsule wall, budget, a box that lands between Ananya and the phone, the retest, her return visit, connected apps, voice, and an end card that reveals the contour figure from S02. "D-Human" is now voiced as two words (TTS spelling "D. Human"). Mix -14.0 LUFS, -1.6 dBTP via `tools/master.py`. Calls that override the sheet are in the project's `DECISIONS.md`, results in `REVIEW.md`.
- **YC demo, Acts 1 and 2:** Mayank's illustrated girl became Ananya, cut off her paper and given a face rig that animates the original art, with lip sync from the voice. ElevenLabs upgraded to Starter, so music is composed and audio is no longer draft-only. From S03 the film plays as a two-shot: Ananya on the left, the phone on the right.
- **YC product demo started:** a 129.6 s film in the studio at `~/Projects/studio/projects/d-human-yc-demo`, built from the Google Sheet "D-Human YC Demo: Production Script". Decisions that override the sheet are in the project's `DECISIONS.md`. Voices generated (Miles and Priya via Deepgram), Act 1 built for review. Music waits on an ElevenLabs upgrade.

### 2026-10-30
- **Launch film:** a 52.8 s film in 16:9 and 9:16, made in the studio, not this repo: `~/Projects/studio/projects/d-human-launch` and `d-human-launch-reel`, brand file `~/Projects/studio/brands/d-human.md`. Music and effects only; colour appears only when a sound strikes. ElevenLabs audio is on the free plan, so draft use only until regenerated on a paid plan.
- **Tagline changed** from "Hear it. Use it. Own it." to "Hack your health." ("Your body speaks data." stays): the hero line, the welcome email (HTML and plain text), the share image (`app/opengraph-image.png`, re-rendered from the site's shader with the same layout) and its alt text, README. Checked at 1440 and 320 px (one line, no overflow) and in `/api/email-preview`. Pushed in `67d8328`.

### 2026-10-28
- **Voice test:** generated "D-Human. Train smarter, live stronger — dhuman.fit" with the VoiceStudio MCP, without a `profile_id`, to test the claude-code voice binding (output mode `files`, 4.78 s). Copied to `promo/audio/vo-test.wav` (24 kHz mono WAV). The reply doesn't say which voice was used. Not committed.
- **Push `eb3fb4e`:** the phone loop, the chart's per-person profiles, the unnamed source, the trimmed page and headline fix, and both video projects (`video/intro`, `video/loop`), shipped together.
- **"Test first" phone and a livelier chart:** the sample report and its explanation now play inside a phone. A new HyperFrames clip (`video/loop/`, 20 s, 600 x 1296) runs tests → doctor-reviewed report → vitamin D in plain words → two answers → the stack with the clean-label bar → retest, with an in-app tab bar that mirrors the steps. On the page (`components/site/LoopPhone.tsx`) the four steps follow the clip and jump to their chapter on tap; it plays only in view, has Pause, and shows stills for reduced motion and Data Saver. The 76 of 100 chart's picker now opens each person's five-marker panel and resulting stack (or "nothing to add"), and any square can be tapped. "Tata 1mg Labs" is no longer named; the figure is attributed as research across 2.2 lakh lab tests in 27 cities. Verified in Chrome at 1440 and 390 px and with reduced motion; mobile Lighthouse on a production build 93–95, the rest 100.
- **Landing page trimmed to three sections:** hero, "Most people buy supplements blind" (the 76 of 100 chart) and "Test first. Supplement second." (ending on the sample report). What we test, Three plans and the closing waitlist section are commented out in `app/page.tsx`, components kept. The `#join` anchor moved to the hero form, so the header button and "Find your number" scroll there. The footer stays for its wellness disclaimer. Also fixed the headline reading as "Your bodyspeaks data." to screen readers and search (missing space between its two lines).

### 2026-10-27
- **Product intro video** (`video/intro/`, HyperFrames, 13 s, 1920 x 1080, silent): the report is in, its three out-of-range rows carry into a phone, two taps on "What do you train for?", then the stack ("Only what your markers point to") and the white end card "For the human", "Join the waitlist at dhuman.fit". Built on the site's own contour shader, wordmark and Archivo; the app screens reuse the launch page's components and copy, and the report is labelled illustrative. Committed in `eb3fb4e`.

### 2026-10-25
- **Mobile web app pass:** home-screen manifest, 192 and 512 px icons, Apple web-app and format-detection tags; hover styles limited to devices that hover, with pressed feedback for touch; all tap targets at least 44 px (header button and logo, answer chips, skip link); "Send" on the email keyboard; no text inflation on rotation. Audited at 320, 375 and 430 px.
- **Performance fix:** mobile Lighthouse Performance went from 39 to 94–95 (blocking time 6,480 ms to 40–60 ms, LCP 6.4 s to 2.9 s). Root cause, found by tracing: synchronous WebGL setup blocking the main thread. The field now renders in a Web Worker on an OffscreenCanvas, starts after load and idle, only near the screen, at 30 fps, with a still frame on software rendering.
- **Silk threads on the Join buttons** (`components/waitlist/useSilkTether.ts`): near the cursor, 15 rope-physics strands run from the facing edge of the button to the pointer. The button leans up to 10 px toward the cursor and the cursor becomes a grab hand. Moving away or clicking snaps the strands. Off on touch and with reduced motion. Inspired by a "let's collaborate" button the user shared. Verified with real mouse moves in Chrome and on an emulated touch phone.
- **Project memory:** added `MEMORY.md` and `CLAUDE.md`, which imports it.
- **Push `0c8d079`:** the silk threads, mobile web app pass, worker-rendered field and project memory, shipped together.

### 2026-10-23
- **Push `498a4cb`:** branded welcome email (black page, white card, contour band, the four steps, WhatsApp share), the dev-only `/api/email-preview`, the sender on `hello@dhuman.fit`, and `lib/site-url.ts` with Vercel's production domain as fallback. Verified live: email artwork 200, preview 404, Sheets check 403.
- **Fix (no code):** the live site couldn't save signups because Vercel lacked the Sheets variables. The user added them and redeployed; the check went from 500 to 403.
- **Push `7b59b8a`:** the landing page. Hero with the contour field; the vitamin D section with an animated chart and picker; the loop with a sample report; the 17 tests; the three plans; closing form; footer. The waitlist APIs, Apps Script with `setup()`, Resend welcome email, traced logo, icons and share image. Includes the dev-mode WebGL fix and the hero type tuning (width 118, weight 760, line height 1; tagline on one line).
- **Research:** inspected illumelabs.ai with REA. A full-bleed `hero.mp4` with grain and grade overlays and a centred serif headline; used as motion inspiration only.

### 2026-10-22
- **Thread:** used REA to investigate VS Code 1.123.0's Command Palette (prefix-based provider routing, the `f1` command menu, word and TF-IDF matching, recently-used ordering) and outlined how to build one in Next.js. No code in this repo.
