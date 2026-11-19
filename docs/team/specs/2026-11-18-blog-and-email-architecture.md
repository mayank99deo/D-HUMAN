# Backend architecture: the blog and lifecycle emails

- **Date:** 2026-11-18
- **Author:** `systems-data-engineer` (an AI agent in that role)
- **Status:** decided by Mayank on 2026-11-18 (section 8); lane 0 built (section 7).
- **Mayank's decisions (2026-11-18):** authoring at `/write` with this design, the SEO lead's URLs, 404 for removed posts. Weekly wrap and feedback emails on by default, with a clear consent line and one-tap stop. The weekly wrap goes on **Sunday evening, about 19:30 IST**, for Monday to Sunday so far. **Stay on Vercel Hobby and Resend's free plan until revenue starts.** The Sheet gets a respondent code unless the person ticks contact. No blood markers or verdicts in emails. English only.
- **Builds on:** `docs/team/specs/2026-11-18-blog.md` (product designer), `docs/team/specs/2026-11-18-lifecycle-emails.md` (UX and retention designer), `docs/team/seo/2026-11-18-blog-and-search.md` (SEO lead). Where they disagree, section 2.1 and section 8 say so.

## In one minute

**Blog**

1. **Authoring:** the in-app editor at `/write` (the product designer's option A). Posts live in Postgres as structured blocks (JSON checked against a schema), with a draft copy and a live copy. No stored HTML, so there is nothing to sanitise and no `dangerouslySetInnerHTML`.
2. **Photos:** stored in Postgres for v1 (`blog_image_files`), resized in the browser to 3 widths of WebP, and served from `/blog/img/<id>/<file>` with year-long, never-changing cache headers, so Vercel's CDN serves almost every view. We skip Next's image optimiser: Hobby includes 5,000 transformations a month, and past that new images show only their alt text. Crops are CSS around a focal point; black and white is CSS `grayscale`. The storage sits behind one small module, so moving to Vercel Blob later is a one-file change.
3. **Pages:** static, through Cache Components (`'use cache'`, `cacheLife('max')`, `cacheTag`). Publish, update and take-down call `revalidateTag(tag, { expire: 0 })`. One registry module reads live posts; the sitemap, RSS, topic hubs, related lists and structured data read only from it (the SEO lead's "can't drift" rule).
4. **Access:** a `blog_authors` table. Every `/write` request checks the signed-in email against it on the server. Owners (who can add authors) come from `BLOG_OWNER_EMAILS`.

**Lifecycle emails**

5. **Scheduling:** Vercel Cron on Hobby runs a job at most once a day, anywhere in the chosen hour, with no retries, and may fire twice. So: two daily crons into one job (`GET /api/cron/daily`), at about 10:30 IST (welcomes, feedback, Monday's weekly overflow) and about 19:30 IST (the Sunday weekly email). The job sends whatever is due and inside each person's 8:00 to 21:30. The welcome sends from the onboarding save; the job is its catch-up.
6. **No double sends:** an `email_sends` ledger with a unique (person, kind, dedupe key), claimed before Resend is called, plus Resend's own 24-hour idempotency key. Up to 100 emails per Resend batch call.
7. **Stopping:** `email_prefs` per person, signed links that never expire, and an RFC 8058 one-click endpoint for the mail app's Unsubscribe button. A Resend webhook records hard bounces and spam reports in `email_suppressions` (hashed addresses).
8. **Feedback:** answers are saved in Postgres first, then copied to a new "Feedback" tab by the existing Apps Script, through a new `feedback` action. A daily retry covers failed copies. Replies go to a Google Workspace group now; a Gmail Apps Script copies them into a "Replies" tab once there are about 20 a week. Not Resend inbound.
9. **Resend plan (staying free):** the free plan's 100 emails a day are shared with sign-in codes. Code caps lifecycle email at 70 a day (`EMAIL_DAILY_CAP`), keeps 30 for codes, rolls overflow to the next run, and emails the founders once a week when the Sunday list reaches 80% of the cap.
10. **Vercel plan (staying on Hobby until revenue):** Vercel says Hobby is for non-commercial personal use, and D-Human takes payments; Pro ($20 a month) is the plan the terms point to, and allows hourly crons. Mayank chose to stay on Hobby for now, so daily crons only.

## 0. What I checked

**Verified (read, ran or measured):**

- Read: my role file, `MEMORY.md`, `lib/db/schema.ts`, `drizzle/` and its journal, `scripts/db-migrate.mjs`, `vercel.json`, `next.config.ts`, `google-apps-script/Code.gs`, `lib/waitlist/*`, `lib/auth/*`, `app/api/waitlist/*`, `app/api/auth/*`, `app/api/profile/route.ts`, `app/api/account/delete/route.ts`, `app/api/billing/webhook/route.ts`, `lib/platform/wraps.ts`, `lib/domain/periods.ts`, `app/sitemap.ts`, `app/robots.ts`, `lib/seo.ts`, `lib/site-url.ts`, `tests/migrations.test.ts`, the three specs above.
- Read Next 16's own docs in `node_modules/next/dist/docs/`: revalidating, `revalidateTag` (profiles, `{ expire: 0 }`), `updateTag` (Server Actions only), `generateStaticParams` (must return at least one param with Cache Components), dynamic routes with Cache Components, ISR with Cache Components, `use cache` runtime caching (per instance on serverless), `ensureStatic`, Image `localPatterns`.
- Resend SDK 6.34.1 in `node_modules` ships `resend.webhooks.verify()` (it bundles `standardwebhooks`) and the batch API. No new package is needed for email.
- DNS today, with `dig` (section 3.11).
- **Migration 0009 (Appendix A), on a scratch embedded Postgres** with the repo's PGlite and drizzle migrator: deploy then paste twice; paste then deploy twice; today's production (0000–0008 by the migrator), then 0009 pasted, then the deploy. Every order gave the same 30 tables, all with row-level security on, 25 indexes and 8 foreign keys on the new tables. Also checked: a second featured post is refused; an author with posts can't be deleted; deleting a post keeps its old slugs (with no post, so they can answer "gone"); deleting an account removes its email settings, sends and feedback; `sha256()` exists.
- **The weekly "who's active" query** (section 3.3), exactly as printed, on the new schema: of 6 test people it picks only the eligible one (the others: weekly off, paused, suppressed under a capitalised address, not onboarded, another time zone), and nobody once the send is recorded. An earlier version of the same query (an opt-out table in place of `email_prefs`) ran in 0.24 s on 30,000 people and 600,000 meal rows on embedded Postgres, using the existing `food_logs_user_date_idx`. No new index needed. (That seed gave each person one logged day, so it measured the scan, not a full send list.)
- Vendor limits, fetched today (sources in Appendix B).

**Inferred, not measured:** traffic, email volumes, image sizes per photo, and costs at 10x and 100x.

## 1. Limits that shape the design

| Limit | Value today | What it changes | Source |
| --- | --- | --- | --- |
| Vercel Cron, Hobby | 100 jobs a project, each at most once a day, fired anywhere within the hour (±59 min). Pro: once a minute, on the minute. | One or two daily runs; the job must be time-agnostic | [Vercel cron pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| Cron delivery | Best effort: no retry on failure, can be skipped, can fire twice. Production only. Doesn't follow redirects. `CRON_SECRET` arrives as `Authorization: Bearer …`. `x-vercel-cron-schedule` names the schedule. | Idempotent ledger, a lease, catch-up windows | [Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| Vercel Schedules (beta) | Hobby: every 15 min at best, 15-min jitter, time zones, 5,000 runs a billing period | Better for per-time-zone sends, but beta; revisit | [Schedules limits](https://vercel.com/docs/schedules/limits) |
| Functions, Hobby | 300 s max duration; 4.5 MB request body | A run's time budget; photo uploads must be shrunk first | [Function limits](https://vercel.com/docs/functions/limitations) |
| Image optimisation, Hobby | 5,000 transformations a month; past it new images return 402 and show alt text | Don't use Next's optimiser for blog photos | [Image limits](https://vercel.com/docs/image-optimization/limits-and-pricing) |
| Vercel Blob, Hobby | 1 GB stored, 10 GB transfer, 2,000 uploads (advanced ops) a month; past a limit, Blob is blocked for 30 days | Why Blob isn't v1 on Hobby | [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) |
| Vercel Hobby use | Non-commercial personal use only, per Vercel's fair use guidelines (as quoted in search results; that section didn't render when I fetched the page) | Decision for Mayank | [Fair use](https://vercel.com/docs/limits/fair-use-guidelines) |
| Supabase Free | 500 MB database, 5 GB egress, pauses after a week idle; image transforms Pro only | Photo bytes count against 500 MB; CDN caching keeps egress small | [Supabase pricing](https://supabase.com/pricing) |
| Resend Free | 3,000 a month, **100 a day**, 3 domains, 1 webhook endpoint, 30-day data. Pro $20: 50,000 a month, no daily cap. Inbound mail counts toward the quota. | Daily budget in code; when to upgrade | [Resend pricing](https://resend.com/pricing) |
| Resend API | 10 requests a second per team (all plans). Batch: up to 100 emails a call, custom headers allowed, no attachments. Idempotency keys kept 24 h, up to 256 characters; same key with a different payload gives 409. | Batch sizing; retry policy | [API intro](https://resend.com/docs/api-reference/introduction), [batch](https://resend.com/docs/api-reference/emails/send-batch-emails), [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys) |
| Resend suppressions | A hard bounce or a spam report suppresses the address for **all** mail from the account, sign-in codes included. Gmail doesn't send spam-report events. | Sign-in screen hint; mirror in our table | [Suppressions](https://resend.com/docs/dashboard/emails/email-suppressions) |
| Gmail, Yahoo bulk rules | Over about 5,000 a day to Gmail: SPF, DKIM and DMARC (`p=none` is enough) aligned; one-click unsubscribe on marketing and subscribed mail plus a visible link; act on it within 2 days; spam rate under 0.3% (aim under 0.1%). Gmail began rejecting non-compliant mail from November 2025. | We're far below 5,000 but comply now: it's cheap and spam reports count at any volume | [Gmail guidelines](https://support.google.com/a/answer/81126), [enforcement ramp](https://redsift.com/blog/gmails-enforcement-ramps-up-what-bulk-senders-need-to-know) |

## 2. The blog

### 2.1 Options, from the backend side

The product designer's table (blog spec §3.1) covers authoring comfort. This adds storage, safety and cost.

| | A. Editor at `/write` (recommended) | B. Import from Google Docs or Notion | C. Hosted CMS (Sanity) |
| --- | --- | --- | --- |
| Posts stored | Postgres, JSON blocks, draft and live copies | Postgres after import; the doc stays a second source | Sanity's cloud, as Portable Text (structured, safe) |
| HTML safety | No HTML anywhere; zod-checked blocks | Imported HTML must be converted to blocks; the converter is the risk | Portable Text renders to React; safe |
| Photos | Our table, our route, CDN cached | Must be copied at import; Notion's file links expire after 1 hour ([Notion](https://developers.notion.com/reference/file-object)); Docs exports point at Google's hosts | Sanity's image CDN with crops and transforms |
| Sign-in | Existing email code + `blog_authors` | Google or Notion account, plus a token or Apps Script with Drive access | A new Sanity login for both founders |
| Publish → live page | `revalidateTag` in the same request | Same, after import | A signed Sanity webhook to a revalidate route |
| Health checks at Publish | Same code as the app (brand list, copy rules) | Only at import | Sanity validation rules; a second copy of the rules |
| New secrets | None (`BLOG_OWNER_EMAILS` is a list, not a secret) | `NOTION_TOKEN`, or a Drive-scoped Apps Script | `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_READ_TOKEN`, `SANITY_WEBHOOK_SECRET` |
| Free tier | Our database (about 0.5 MB a photo) | Same | Free: 20 seats, 2 public datasets, 10k documents, 250k API and 1M CDN requests, 100 GB bandwidth and assets; no scheduled drafts ([Sanity](https://www.sanity.io/pricing)) |
| Effort | Highest (the editor) | Medium, and still needs A's preview and publish | Medium (schema, preview, webhook) |

**Recommendation: A.** It adds no vendor, no login and no secret; the health checks run in the same code as the app; preview is the real page; and the data stays in the Mumbai database. "Paste from Google Docs" in the editor gives back most of B's comfort without B's second source of truth. Choose C instead only if the founders want collaborative, Google-Docs-style editing with comments; the data model below maps onto it.

**Where the SEO lead's doc differs.** It proposes a code registry (`lib/blog/posts.ts` or MDX in the repo) and old-slug redirects in `next.config.ts`. An editor needs posts in the database, so:

- The "registry" becomes one module, `lib/blog/registry.ts`, that reads live posts from Postgres. Everything that lists posts (sitemap, RSS, hubs, related, JSON-LD) reads only from it. Same no-drift property.
- Old slugs live in `blog_slugs` and redirect from the post route (308), not from `next.config.ts`, which only changes on deploy.
- URLs: the designer proposed `/blog/category/…` and `/blog/authors/…`; the SEO lead proposes `/blog/topics/…` and `/team/…`. The designer's spec says the SEO doc wins on URLs, so this design uses the SEO lead's. The backend doesn't care which.

**Stage 0 (reader side first, designer §3.1).** The crew mustn't write to the production database, so the first posts can't be "loaded by the crew". Instead, build `/write` in its smallest form first: an owner-only "Import post" screen that takes a JSON post (prepared by the crew from the founder's Google Doc) plus photo uploads, then Preview and Publish. The full editor follows. No code registry, so no later migration from code to database.

### 2.2 Data model

All tables have row-level security on with no policies. Exact SQL in Appendix A.

| Table | Holds | Who can read what |
| --- | --- | --- |
| `blog_authors` | email (lowercase, unique), slug, name, role, bio, photo, links, active | Public: name, role, bio, photo, links. Email: server only, never rendered. |
| `blog_posts` | slug (unique), status `draft` / `live` / `taken_down`, topic (key into a code list), language `en` / `hi` / `hinglish`, author (FK, **restrict**: an author with posts can't be deleted), featured (at most one, enforced by a unique partial index), `draft` JSON + `draft_version`, `live` JSON + `live_version`, `published_at`, `updated_on` (the "meaningful update" date), `live_changed_at`, soft lock `editing_by` / `editing_at` | Public: `live` only, and only when status is `live`. Drafts: authors. |
| `blog_slugs` | every slug a post has been published under → post id (null once the post is deleted) | Server only; drives 308s and "gone" |
| `blog_images` | width, height, focal point (0–1), keep colour, own rights, credit, uploader | Public once used in a live post |
| `blog_image_files` | per image: named files (`w480.webp`, `w960.webp`, `w1600.webp`, JPEG fallbacks), mime, width, bytes | Public by URL |
| `blog_publishes` | each publish, update, take-down or restore: who, which draft version, checklist ticks, automatic check results, meaningful-update flag, a snapshot of `live` | Authors; it's the audit trail and future version history |
| `blog_reviews` | "Ready for a read": post, draft version, who asked, reviewer, status, note | Authors |

**Why a draft copy and a live copy, not one row edited in place.** Cache Components' cache doesn't survive a deploy (`use cache` docs: the cache key includes the build id). If an unpublished edit sat in the same columns the page reads, the next deploy would put it live. Public reads touch only `live`.

**Why `author_id` points at `blog_authors`, not `users`.** Deleting an app account cascades through `users`. A founder deleting their test account must never delete the blog.

**Alt text, caption and credit live on the block, not the image,** so one photo can be reused with different words. Focal point and keep-colour live on the image.

### 2.3 Content format and XSS

- **Blocks** (designer §2.6): paragraph, heading (h2, h3), list, photo, pull quote, note, doctor callout, key number, try-it, table. One zod schema in `lib/blog/blocks.ts`, used by the editor, the API and the renderer.
- **Inline text** is an array of spans: `{ text, bold?, italic?, href? }`. No other marks.
- **Links:** `https:` or `http:` only, or a path on our site from a fixed list (guides, other posts). Everything else is rejected on save, not just hidden on render. External links get `rel="noopener noreferrer"`.
- **Try it** stores a destination key from a code list (`fuel`, `upload`, …), never a URL. Per the SEO lead, these point at `/signin` with a `next` path rather than at robots-blocked app screens.
- **Photos** store an image id. The renderer only builds `/blog/img/…` URLs. There's no way to put a third-party image or script in a post.
- **Limits checked on save:** title ≤ 100, dek ≤ 200, search title ≤ 60 (warn) / 100 (block), description ≤ 155 (warn), ≤ 300 blocks, ≤ 5,000 characters a block, ≤ 30 sources, body JSON ≤ 200 KB.
- **Pasting from Google Docs** happens in the browser: the editor turns the clipboard's HTML into blocks with the browser's own parser, keeps headings, bold, italic, links and lists, and drops the rest. The server never parses HTML. Pasted Docs images point at Google's hosts and usually can't be fetched from our page; the editor asks the author to add the photo. (To verify in the build.)
- **Rendering** is our React components over validated blocks. No `dangerouslySetInnerHTML` in the blog. JSON-LD stays in its `<script type="application/ld+json">` built from the registry, with `<` escaped, as `lib/seo.ts` does today.

### 2.4 Photos

**Pipeline (in the author's browser, a new `components/write/resize.ts` built like `components/platform/shrink.ts`, which meals keep using unchanged):**

1. Decode with `createImageBitmap(file, { imageOrientation: "from-image" })` so phone photos aren't sideways.
2. Draw at 480, 960 and 1600 px wide (never upscaled). Encode WebP at about 0.82; if the browser can't encode WebP, JPEG.
3. Re-encoding drops all metadata, including GPS location (designer §3.5). Nothing else needed.
4. Upload all widths in one request: about 400–550 KB a photo (my estimate), well under the 4.5 MB limit.
5. HEIC: only Safari can decode it; elsewhere show the designer's "Save it as JPEG" message.

**Server (`POST /api/write/images`, authors only):** checks each file's first bytes (WebP or JPEG), size ≤ 1.5 MB each, declared widths in the expected set, height within sane bounds. The image id is random; file names include a short content hash (`w960-3fa9c1.webp`), so a URL's bytes never change.

**Serving (`GET /blog/img/[id]/[file]`):**

- Under `/blog/`, not `/api/`, because robots.txt blocks `/api/` and image search needs to crawl photos.
- Served only while a live post uses the image (or it's a writer's byline photo); signed-in writers also get drafts' photos, privately. `Cache-Control: public, max-age=3600` and `CDN-Cache-Control: public, max-age=86400`, so a take-down reaches every cached copy within a day (QA, 2026-11-19; it was a year, immutable). The function runs on a CDN miss.
- 404 for an unknown id or file. Never reads any other table.

**On the page:** a plain `<img srcset sizes width height loading decoding>` in a `BlogImage` component, not `next/image` (whose optimiser has the Hobby cap). Crops are `object-fit: cover` with `object-position` at the focal point; black and white is `filter: grayscale(1)` unless keep-colour is set. One stored photo serves every crop and both looks, and the original stays in colour if the rule changes later.

**Share images** follow the SEO lead: `opengraph-image.tsx` per post with `ImageResponse` (title on black, wordmark), plus 1200 × 675, 1200 × 900 and 1200 × 1200 versions for Article markup. Generated once and cached with the page's tags. No photo processing on the server.

**Data Saver.** The designer wants no thumbnails under the `Save-Data` header. A static page can't vary by a request header without becoming dynamic. Options for the designer: a tiny client check of `navigator.connection.saveData` that removes thumbnails, or skip it. Not a server feature.

**Storage choice and when to move.** Postgres keeps one system, one backup and no new token, and the CDN makes the database a rare origin. Move to Vercel Blob (behind `lib/blog/image-store.ts`) when any of these is true: the project moves to Vercel Pro (Blob becomes pay-as-you-go, no 30-day block); photo bytes pass 150 MB; or the database passes 60% of its plan. Report files are still the bigger threat to the 500 MB free database (kickoff finding 1).

### 2.5 Who can write

- `lib/auth/author.ts`: `requireAuthor()` = the existing session + an active `blog_authors` row for that email. Owners also match `BLOG_OWNER_EMAILS` (comma-separated). Owners manage authors; any author writes and publishes.
- Pages under `/write` show the designer's "This area is for D-Human's writers." to signed-in non-authors. API routes under `/api/write/*` answer 404 to anyone who isn't an author, so they don't reveal themselves.
- `/write` doesn't need app onboarding (designer §3.2).
- **Fresh sign-in for publishing.** Sessions last 30 days. Publish, take-down and author changes also require a session created in the last 7 days (`sessions.created_at`); otherwise "Sign in again to publish." A stolen old cookie can't deface the site.
- Mutations accept JSON only and check `Origin` against our hosts. `/write` goes into `APP_PATHS` in `lib/seo.ts` (robots-blocked), and its layout says noindex.

### 2.6 Drafts, publishing, review and conflicts

- **Autosave:** `PUT /api/write/posts/:id` with `draft_version`. The update runs `WHERE id = $1 AND draft_version = $2`; no row means someone else saved first, so answer 409 with who and when (designer §3.12).
- **Soft lock:** the editor sends a heartbeat every 60 s that sets `editing_by` and `editing_at`. Opening a post edited by someone else in the last 3 minutes shows "{Name} is editing this post".
- **Publish** (`POST …/publish` with `draft_version`, checklist ticks, acknowledged warnings), in one transaction:
  1. Re-validate the draft; run the automatic checks (designer §4.2) in code. Any blocker → 422 with the list.
  2. Whenever the words change, require a `looks_good` answer to a pending request for this exact draft version, from a writer who is neither the post's author nor the one who saved that version (every post: Mayank's default from 2026-11-19; before, health topics only). A change of address, topic or featured alone needs no read.
  3. Check the slug is free in `blog_posts` and `blog_slugs`; insert it into `blog_slugs`.
  4. Copy draft → `live`, adding what the page needs so it renders with one read: reading time, image sizes and focal points, author snapshot.
  5. Set `status = 'live'`, `published_at` on first publish, `updated_on` when "meaningful update" is on, `live_changed_at = now()`.
  6. Insert a `blog_publishes` row (who, ticks, checks, snapshot).
  7. After commit: `revalidateTag('blog', { expire: 0 })` and `revalidateTag('blog:post:<id>', { expire: 0 })`. `updateTag` would be simpler but works only in Server Actions; the app uses Route Handlers.
- **Update** is the same with the slug unchanged. **Changing a live post's slug** adds the new slug to `blog_slugs`; the old one now redirects.
- **Take down:** `status = 'taken_down'`, keep `live`, revalidate. **Restore:** back to `live`. **Delete:** drafts never published, or taken-down posts; the post row goes and its `blog_slugs` rows keep the slug with a null post id, so the address answers "gone" and is never reused.
- **Featured:** setting it clears the old one in the same transaction; the unique partial index is the backstop.
- **Review request** emails the reader a link to the preview through lane C's send path, so it goes only from production and counts toward the day's email budget (kind `review_request`, no stop link).

### 2.7 Rendering with Cache Components

- **Readers** in `lib/blog/registry.ts`, each with `'use cache'`, `cacheLife('max')` and tags: `blog` (anything that lists posts), `blog:post:<id>`, `blog:authors`.
- **Lists** (`/blog`, `/blog/page/[n]`, `/blog/topics/[topic]`, `/team/[person]`, sitemap, RSS) are prerendered at build. **That means `next build` reads the database for the first time.** Production builds already reach it (migrations run first), and Preview builds read the same database (published posts only). Rules for the registry:
  - On a Vercel production build, a database error fails the build. Never bake an empty blog into production.
  - When no Postgres URL is set (local builds), return no posts and don't open PGlite: a build opening `.data/pglite` while `next dev` has it open breaks the data folder (MEMORY gotcha).
  - The QA check "a production build passes with the database unreachable" no longer holds once the blog ships. Update that check.
- **Post pages** (`/blog/[slug]`): `generateStaticParams` must return at least one slug under Cache Components (an empty list fails the build), so it returns the live slugs, read at build. New slugs render on first visit and are then stored. So the route needs one live post before it ships; Stage 0 does that.
- **Status codes** (the SEO lead decides): unknown or taken-down slug → `notFound()` (404); a retired slug with a post → `permanentRedirect()` to the current slug (308); a slug of a deleted post → 404 by default. A true 410 needs a route handler in front of the page; worth it only if the SEO lead insists. Check in the build that a slug first requested at runtime returns a real 404, not a 200 with noindex; `ensureStatic = 'navigation'` is the documented way to make the first request wait for the full page.
- **Preview** (`/write/[id]/preview`): renders the draft with the same components, dynamically, signed in, noindex. No Next draft mode needed.

### 2.8 Sitemap, RSS and structured data

- `app/sitemap.ts` becomes async and tagged `blog`. It adds `/blog`, live posts (`lastModified` = `updated_on` or `published_at`, image = the 16:9 share image), hubs with 3 or more posts, `/team/*`, `/editorial-policy`. `tests/seo.test.ts` imports the sitemap today, so the registry needs a test seam (an injected list) to keep that test free of a database.
- `app/blog/rss.xml/route.ts`: RSS 2.0, latest 20, `'use cache'` + tag `blog`. Text fields escaped for XML. Description only, no full HTML in the feed.
- JSON-LD per the SEO lead's §4.5, built from the registry.

### 2.9 Cost and growth

- **Now:** no new spend. Pages and photos come from Vercel's CDN; the database sees a few reads per publish and a read per CDN miss.
- **10x:** unchanged. Watch photo bytes in the database.
- **100x readers (a post goes viral):** pages and photos stay CDN-served, but Hobby's 100 GB of data transfer a month is shared by the whole site. That's a reason for Pro, not a design change. Photos move to Blob when the triggers in 2.4 hit.

## 3. Lifecycle emails

### 3.1 The emails (from the UX spec), as the backend sees them

| Kind | Trigger | Dedupe key (unique with person and kind) | Setting that turns it off | List-Unsubscribe |
| --- | --- | --- | --- | --- |
| `welcome` | Onboarding finishes the first time (`justFinished`, `app/api/profile/route.ts:86`), sent in `after()`; the job catches up anything missed in 48 h | `once` | none (one-off) | No |
| `welcome_unfinished` | Job: account 24 h to 7 days old, not onboarded | `once` | none | No |
| `weekly` | Job: **Sunday from 19:00 local, for Monday to Sunday so far** (Mayank); Monday's runs take the overflow until 21:30 local | the week's Monday, e.g. `2026-11-16` | `email_prefs.weekly`, `weekly_paused_at` | Yes, weekly only |
| `feedback` | Job: day 10 after onboarding from 10:30 local, never on a Sunday, within the caps | the survey id, e.g. `fb-1` | `email_prefs.questions` | Yes, questions only |
| Blog review request | An author taps "Ask for a read" | none (internal) | n/a | No |

The brief said "welcome on first sign-in". The UX spec moved it to the end of onboarding, with a separate nudge for people who stop halfway. This design follows the UX spec. No backfill: the 48-hour and 7-day windows mean nobody who signed up long ago gets a welcome.

### 3.2 Scheduling on Hobby (Mayank: stay on Hobby; weekly on Sunday evening)

All timing constants live in `lib/email/types.ts` (`SEND_WINDOW`, `WEEKLY_TIMING`, `FEEDBACK_TIMING`, `WELCOME_UNFINISHED_TIMING`), so the jobs lane and the tests read one source.

- `vercel.json` (jobs lane) gets two crons on one path:
  - `{ "path": "/api/cron/daily", "schedule": "0 5 * * *" }`: fires 05:00–05:59 UTC, **10:30–11:29 IST**. Welcome catch-up, the "didn't finish" nudge, feedback, Monday's weekly overflow, Sheet retries, housekeeping.
  - `{ "path": "/api/cron/daily", "schedule": "0 14 * * *" }`: fires 14:00–14:59 UTC, **19:30–20:29 IST**. The weekly email on Sundays; anything else due.
- **The job is time-agnostic.** Each run sends whatever is due *now* for each person, in their own time zone (`profiles.timezone`, IST when unset):
  - inside the send window, **08:00 to 21:30 local** (the UX spec said 20:00; widened so Hobby's jitter on a 19:30 Sunday send still lands inside it);
  - **weekly:** from **Sunday 19:00 local**, covering Monday to Sunday so far (`periodRange("week", today, 0)` on the Sunday). What didn't go on Sunday (budget overflow or a missed run) goes on Monday's runs until 21:30 local, then the week is skipped. Same week key either way, so never twice;
  - **feedback:** day 10 after onboarding, from 10:30 local, never on a Sunday (the weekly email's day), within a 4-day window;
  - **welcome_unfinished:** from 24 h after the account was made, for accounts up to 7 days old.

  More runs later (Pro hourly, or Vercel Schedules with time zones) need no logic change.
- **Who that reaches on Hobby:** India and South-East Asia on both runs; the Gulf on both (09:00 and 18:00 there, so its Sunday weekly goes on Monday morning). Europe and the Americas wait for more runs or Pro; at India-first scale that's acceptable. Don't stack a cron for every hour on Hobby to get round its daily rule: Vercel's fair-use terms forbid circumventing limits.
- **Missed or doubled runs:** a missed Sunday run means the weekly goes Monday morning. Welcome catch-up looks back 48 h. A run that fires twice finds the lease taken (below) and exits.
- **Security:** compare `Authorization` with `Bearer ${CRON_SECRET}` in constant time; 401 otherwise. `?dry=1` returns who would get what (counts only) without sending. Manual runs: Vercel's Cron Jobs tab or `vercel crons`.

### 3.3 One run of the daily job

`app/api/cron/daily/route.ts` (`maxDuration = 300`) calls `runDaily()` in `lib/email/jobs.ts`:

1. **Lease.** `UPDATE job_runs SET lease_until = now() + '6 min', last_started_at = now() WHERE job = 'daily' AND (lease_until IS NULL OR lease_until < now()) RETURNING job`. No row: another run holds it; answer 200 and stop. (A transaction-held advisory lock would pin a pooled connection for minutes behind Supabase's transaction pooler; a lease row doesn't.)
2. **Time budget:** stop starting new work at 240 s.
3. **Budget for the day** (3.4). Stop sending when it's used.
4. **Retry sweep:** `failed` sends under 3 attempts and `sending` rows older than 10 min and younger than 23 h (Resend still holds their idempotency key). Older `sending` rows become `unknown` and are never resent: a missed email beats a double one.
5. **Welcome catch-up**, then **welcome_unfinished**.
6. **Weekly** (Sundays from 19:00 local, Monday overflow): pick the people (query below), apply the caps (3.5), pause anyone whose last 6 weekly emails had no tap, work out the email's numbers, optionally pre-make wraps (3.6), render, send in batches. If the list reaches 80% of the day's cap, email the founders (3.4).
7. **Feedback:** pick, cap, render, send.
8. **Feedback sheet sync retry** (3.8) and the Replies import if built.
9. **Housekeeping** (kickoff finding 6): delete login codes older than 2 days and sessions expired over 7 days ago.
10. Write counts (never addresses) to `job_runs.last_result`, set `last_ok_at`, release the lease.

**Weekly selection** (tested; one per time zone group, since each zone has its own week; `$start` and `$weekKey` are this week's Monday, `$end` its Sunday):

```sql
SELECT u.id
FROM food_logs f
JOIN users u ON u.id = f.user_id
JOIN profiles p ON p.user_id = u.id AND p.onboarded_at IS NOT NULL
               AND coalesce(p.timezone, 'Asia/Kolkata') = ANY($zones)
LEFT JOIN email_prefs ep ON ep.user_id = u.id
WHERE f.local_date BETWEEN $start AND $end
  AND coalesce(ep.weekly, true) AND ep.weekly_paused_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM email_suppressions s
                  WHERE s.email_hash = encode(sha256(convert_to(lower(u.email), 'UTF8')), 'hex'))
  AND NOT EXISTS (SELECT 1 FROM email_sends e
                  WHERE e.user_id = u.id AND e.kind = 'weekly' AND e.dedupe_key = $weekKey)
GROUP BY u.id
ORDER BY u.id
LIMIT $budget;
```

Plus people with a report read that week and no meals (a second small query on `reports.analyzed_at`). The `true` default for `ep.weekly` is decision 1 in the UX spec; flip it in one constant if Mayank picks opt-in.

**The email's numbers** (seven squares, protein days, top food, "up from") must match the wrap. Refactor `wrapStats` into a database fetch plus a pure function over logs and targets, and have it also return the per-day list the squares need (UX spec §4). The job fetches all recipients' logs for two weeks in one grouped query and runs the same pure function, instead of calling `wrapStats` per person (3–4 queries each).

### 3.4 Sending: once, and within budget

**One send** (`lib/email/send.ts`):

1. **Claim:** `INSERT INTO email_sends (id, user_id, kind, dedupe_key, variant, local_date) … ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING RETURNING id`. No row: already handled; skip.
2. **Send** with Resend's idempotency key `${kind}:${userId}:${dedupeKey}` (designer's format).
3. **Record:** `status = 'sent'`, `provider_id`, `sent_at`. On an error *response*: `failed`, `attempts + 1`, `error`. On a timeout or crash: the row stays `sending` and the sweep decides (3.3 step 4).

**One by one by default** (built 2026-11-18, follow-up): `sendLifecycleBatch` sends each email on its own, with its own key and its own budget check, at most 4 a second. An unclear answer then strands one email at most. `EMAIL_BATCH=1` switches to the batches below, worth it only on a paid plan with thousands a run.

**Batches (`EMAIL_BATCH=1`):** claim up to 100 rows with one `batch_id`, then one `resend.batch.send()` with idempotency key `batch:${batchId}`. Rebuilding a batch must give the same payload (same rows, same order, no timestamps in the body), or Resend answers 409. Map returned ids back to rows by position. A batch with no clear answer is marked `unknown` whole and never resent.

**Rate:** at most 4 requests a second from the job, leaving room in Resend's 10 a second for sign-in codes. On 429, wait the `retry-after` and retry twice, then stop the run; the next run continues.

**Only from production:** lifecycle sends and the founders' alert go only when `VERCEL_ENV=production`, or on a local run with `EMAIL_SEND_LOCAL=1`. Preview deployments and ordinary local runs log a line and send nothing (`not_configured`, reason `not_production`), even with a key and a real database.

**Daily budget** (Mayank: stay on Resend's free plan, 100 a day shared with sign-in codes, until revenue starts). Constants in `EMAIL_BUDGET` (`lib/email/types.ts`):

- Lifecycle sends allowed right now: `min(EMAIL_DAILY_CAP or 70 − lifecycle today, (100 − 30) − (codes today + lifecycle today + other email today))`, read again under the budget lock before every send. Codes today come from `login_codes.created_at`; lifecycle sends from `email_sends.sent_at`; other email (the waitlist welcome and the founders' alert) from `email_daily_counts` (migration `0010`). So a lifecycle email goes only while at least 30 of the day's 100 are still free for codes, counting the codes already sent.
- **The edge that remains:** lifecycle email can't see codes that haven't been asked for yet. A run can fill the day up to 70; if more than 30 codes are asked for after it, the ones past 100 bounce off Resend's limit. On a quiet day that needs 31+ codes in the hours after a run; a launch push or a busy sign-up day is the real risk, and the answer then is Resend Pro (section 3.12). Also not counted: anything sent by hand from Resend's dashboard.
- **Overflow rolls to the next run.** Order when it's short: welcome, welcome_unfinished, weekly, feedback. The Sunday 19:30 run and Monday's 10:30 run fall on different UTC days, so a Sunday list still goes out by Monday morning up to about two days' room (each day's room is 70 minus that day's codes and other email); past that, those people skip that week.
- An onboarding-time welcome that finds the budget used up writes no row; the next run's welcome catch-up sees it as not yet sent and picks it up.
- **Alert:** when a Sunday weekly list reaches 80% of the cap (56 people at 70), the job emails the founders once that week (marker `alert:weekly-cap:<week>` in `job_runs`; recipients `ALERT_EMAILS`, or `BLOG_OWNER_EMAILS` when unset): how many are due, how many fit, and that Resend Pro ($20 a month) removes the daily limit. A second line when it overflowed.
- When Resend is upgraded: raise `EMAIL_DAILY_CAP` and `EMAIL_BUDGET.resendDailyLimit` together; nothing else changes.

**Every lifecycle email carries:** `List-Unsubscribe: <https://www.d-human.fit/api/email/unsubscribe?t=…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (weekly and feedback only), Resend tags `kind` and `send_id` (ids only, no personal data), the From in `RESEND_FROM`, and the Reply-To in `RESEND_REPLY_TO` (feedback may use `FEEDBACK_REPLY_TO`).

### 3.5 Caps (UX spec §6), in code

Per person, checked in SQL for the batch:

- No other lifecycle send with the same `local_date` (their calendar day).
- Fewer than 2 lifecycle sends in the last 7 days.
- Weekly and feedback: the welcome went out more than 3 days ago.
- Feedback: none in 90 days, fewer than 3 in 365 days, and not 2 unanswered asks in a row (sends of kind `feedback` with no `feedback_answers` row for that survey).
- Weekly pause: the last 6 `weekly` sends have no `first_tap_at` → set `weekly_paused_at` and send nothing.

Each check uses the `email_sends_dedupe_idx` prefix (`user_id`), a person's rows being a few dozen a year. Constants: `CAPS` and `KIND_PRIORITY` in `lib/email/types.ts`. With the weekly email on Sunday and feedback never on Sunday, the two can't collide on one day.

### 3.6 Pre-made wraps

The UX spec pre-makes each recipient's wrap (Haiku, about $0.0004 each) so the button opens instantly. On Hobby a run has 300 s, and a wrap takes a few seconds, so:

- Pre-make with 6 at a time, within 150 s of the run (about 150–250 wraps, my estimate). Past that, send anyway; the link makes the wrap on open.
- `makeWrap` is idempotent per (person, week) through `wraps_unique_idx`, so a retried run doesn't pay twice.
- The `ai-efficiency-lead` signs off (UX decision 5). The "evening snack called breakfast" open item must be fixed first (UX §4).
- **Sunday evening caveat:** a wrap pre-made at about 19:30 misses meals logged later that Sunday. The email's seven squares say what was logged by send time; the wrap viewer's "Update with latest" refreshes it. Owner of that copy: UX lane.
- At larger scale, pre-making moves to its own invocations (the job calls itself with a cursor) or to Vercel Queues on Pro.

### 3.7 Preferences, stop links and the one-click endpoint

**Tokens** (`lib/email/tokens.ts`): `v1.<payload>.<sig>`, base64url JSON and HMAC-SHA-256. Key derived from `EMAIL_LINK_SECRET` with a purpose label, as `lib/waitlist/token.ts` derives its key. Payloads:

| Purpose | Payload | Expires | Can do |
| --- | --- | --- | --- |
| `stop` | person id, kind | never (old emails must keep working) | change that person's email settings |
| `fb` | person id, survey id | 30 days | save and change that person's answers to that survey |

The purpose is inside the signed payload, so a stop token can't be used as a feedback token. Person ids, never email addresses, go in links. Rotating `EMAIL_LINK_SECRET` breaks every old stop link, so keep it stable. The UX spec suggests deriving the key from an existing secret; a separate one is safer here, because `AUTH_SECRET` is the secret to rotate after a sign-in incident, and that would silently break every stop link ever sent.

**Endpoints:**

| Route | Auth | Does |
| --- | --- | --- |
| `POST /api/email/unsubscribe?t=…` | stop token | RFC 8058 one-click: turns that kind off, answers 200 with an empty body, no cookies, no redirect. Body `List-Unsubscribe=One-Click` accepted and not required. |
| `GET /api/email/unsubscribe?t=…` | none | 303 to `/email/stop?t=…` (a GET must never unsubscribe) |
| `/email/stop?t=…` | stop token | The designer's page. Opening it changes nothing: the kind stops only when the person taps "Stop weekly wraps" (a POST), because some work mail scanners open every link and run its JavaScript too. Every button is a real form, so it works without JavaScript. Undo and the other toggle on the same page. (Changed 2026-11-18 from stopping automatically on load.) |
| `GET/POST /api/email/prefs` | session **or** stop token | Read or change `weekly`, `questions`; turning weekly back on clears `weekly_paused_at` |
| `POST /api/email/tap` | session | `{ e }`: sets `first_tap_at` on that send if it belongs to the signed-in person and isn't set yet |

`/email/` and `/feedback` go into `APP_PATHS` (robots-blocked) with noindex and `Referrer-Policy: no-referrer`. Changes take effect at once, well inside Gmail and Yahoo's 2 days.

**The `next` return path and `e` taps** (UX §7.3 and §7.4) are owned by the staff engineer: `/signin?next=/wraps?week=…` must accept only a path starting with a single `/` and on a short allow-list of app prefixes; onboarding still comes first.

### 3.8 Feedback answers and the Sheet

**Storage first.** `POST /api/feedback` (`{ t, question, answer, path?, contact_ok? }`, or the session for the Settings route) upserts `feedback_answers` on (person, survey, question). Answers are checked against the survey's options in code; text ≤ 1,000 characters, control characters stripped.

**Link scanners** (UX §5): opening the link records nothing; the page POSTs after it loads. If a different answer to the same question arrives within 10 s of the last, the row's answer is cleared and `conflict_until` set; only a later single answer counts.

**Then the Sheet.** In `after()`, `appendFeedback()` in `lib/waitlist/sheets.ts` calls the Apps Script web app with a new `feedback` action; on success it sets `sheet_synced_at`. Any change clears it, so the daily job resends rows with `sheet_synced_at IS NULL` (partial index `feedback_answers_unsynced_idx`). The Sheet is a mirror; Postgres is the record.

**Row sent:** Answer ID (our row id, for upserts), Received at, Survey, Respondent (`r_` + 12 hex of an HMAC of the person id, never the email; 12, not 10, because `forget` deletes by this code and a collision would delete someone else's rows), Path, Question, Answer, Plan (free or pass), Days since onboarding, Days with meals logged, Language, Source, Email (only when `contact_ok`). No health data beyond what someone types.

**Apps Script changes** (Mayank pastes; plumbing lane writes):

- `doPost`: dispatch on `action` before touching the Waitlist tab. Today it checks `email` and reads the Waitlist sheet for every action. Each action validates its own fields.
- `action: 'feedback'`: under the script lock, find the row by Answer ID in a **Feedback** tab and update it, or append. `clean_(value, max)` gains a length so typed answers keep 1,000 characters; it keeps its formula escaping.
- `action: 'forget'`: delete every Feedback and Replies row for a respondent code. `app/api/account/delete/route.ts` calls it in `after()`, so deleting an account clears the Sheet too (UX spec: rows with an email; this does all of them, which is simpler and kinder under DPDP).
- `setupFeedback()`: builds and formats the Feedback and Replies tabs, like `setup()`. Safe to run again.
- Same `WEBHOOK_SECRET`; same web app URL after "Manage deployments → Edit → New version".

### 3.9 Replies to the feedback email

| | Reply-To a Workspace group | Gmail Apps Script into the Sheet | Resend inbound |
| --- | --- | --- | --- |
| Setup | A group `feedback@dhuman.fit` with both founders | A time trigger every 15 min in the account that receives the group's mail; labels processed threads; strips quoted text; matches the sender to a respondent code | MX on a new subdomain (never the root: `dhuman.fit`'s MX is Google Workspace), a webhook (free plan: 1 endpoint, shared with bounces), our route fetches the body |
| Founders read replies in | Gmail | Gmail and the Sheet | Our database or the Sheet; Gmail only if we forward (more quota) |
| Cost | none | none | each reply counts toward Resend's quota |
| Privacy | stays in Workspace | stays in Google | a copy at Resend for 30 days |

**Recommendation:** the group now (set `FEEDBACK_REPLY_TO`); the Gmail script once replies pass about 20 a week. Resend inbound only if D-Human leaves Google Workspace or wants replies inside the app.

### 3.10 Bounces and spam reports

`POST /api/email/webhook`, verified with `resend.webhooks.verify({ payload: rawBody, headers: { id, timestamp, signature }, webhookSecret: RESEND_WEBHOOK_SECRET })` over the raw body, as the Razorpay webhook does. 401 on a bad signature.

| Event | We do |
| --- | --- |
| `email.bounced` | Mark the send `bounced`; a `Permanent` bounce also upserts `email_suppressions` (SHA-256 of the lowercase address, `bounce`). A `Transient` or `Undetermined` one doesn't, since Resend doesn't suppress those |
| `email.complained` | Suppression (`complaint`); turn off weekly and questions for that person (`updated_via = 'complaint'`); mark the send |
| `email.suppressed` | Mark the send `suppressed`; upsert the suppression |
| `email.failed` | Mark the send `failed` with the reason |
| `suppression.added` | Upsert the suppression (`bounce`, `complaint`, or `resend` for one added by hand) |
| `suppression.removed` | Delete our copy, so an address Mayank takes off Resend's list in its dashboard is mailed again here too |
| anything else | 200, ignore |

Every write is an upsert or a guarded update, so Resend's retries (same `svix-id`) are harmless and a late event can't undo a stronger one; no event table needed. Answer 500 only on a database error, so Resend tries again.

**Sign-in after a spam report.** Resend suppresses *all* mail to a suppressed address, including sign-in codes. When `/api/auth/code` gets an address in `email_suppressions`, it still sends the code (our copy may be out of date) and answers `{ status: "sent", notice: "suppressed", message }`; the sign-in screen shows `message`: "Emails to this address bounced or were marked as spam, so your code may not arrive. Write to hello@dhuman.fit and we'll sort it out." Mayank removes the address in Resend's dashboard; `suppression.removed` then clears ours. Rare, but otherwise a silent lockout.

### 3.11 Domain and DNS (checked with `dig` today)

| Record | Today | Needed |
| --- | --- | --- |
| `dhuman.fit` MX | Google Workspace | keep |
| `resend._domainkey.dhuman.fit` | DKIM key present | keep (Resend's DKIM, aligned with `dhuman.fit`) |
| `send.dhuman.fit` | CNAME to `send.forge.rmta.net`, which carries SPF and a feedback MX (my reading: Resend's return path; confirm in Resend's Domains page) | keep |
| `_dmarc.dhuman.fit` | **missing** | `v=DMARC1; p=none; rua=mailto:dmarc@dhuman.fit` now; `p=quarantine` after 2–4 clean weeks of reports |
| `dhuman.fit` SPF (root TXT) | **missing** (only a Google site-verification TXT) | `v=spf1 include:_spf.google.com ~all`, for the founders' own Workspace mail |
| `google._domainkey.dhuman.fit` | **missing** | Google Workspace DKIM: Admin console → Gmail → Authenticate email |
| `_dmarc.d-human.fit` | `p=quarantine`, reports to GoDaddy's address (registrar default) | fine: nothing sends from `d-human.fit` |

Resend's mail already aligns (DKIM `d=dhuman.fit`; return path on `send.dhuman.fit`), so adding DMARC doesn't break it. The founders' own Workspace mail currently has neither SPF nor DKIM. Their replies to users can land in spam today, and would fail DMARC once it moves past `p=none`. Fix both before tightening.

**Sending domain:** keep `hello@dhuman.fit` (Mayank's decision of 2026-11-13). Once lifecycle mail passes about 1,000 a day, send it from a subdomain such as `updates.dhuman.fit` (a second verified domain; the free plan allows 3), so its reputation is kept apart from sign-in codes. Resend's quota and suppression list stay shared either way.

**Also:** turn off Resend's open and click tracking for `dhuman.fit` (UX rule 9; click tracking would also rewrite our signed links). Register `dhuman.fit` in Google Postmaster Tools to watch the spam rate.

### 3.12 Resend plan by people

My estimate: about 6 emails per weekly-active person a month (4–5 weekly, 1–2 sign-in codes, a share of feedback), plus about 2.5 per new sign-up (welcome and codes).

| Weekly-active people | Plan | Why |
| --- | --- | --- |
| Up to about 56 | Free (Mayank's choice until revenue) | Sunday's list fits the 70-a-day lifecycle cap with codes' 30 kept |
| About 56–140 | Free, with Sunday's list overflowing to Monday morning | The founders get the weekly alert from 56 |
| 150 to about 7,000 | **Pro, $20 a month** (50,000) | No daily cap |
| About 7,000–15,000 | Scale, $90 (100,000) | |
| About 80,000 | Scale, $350 (500,000) | |

Upgrade before any launch push even if the lifecycle emails aren't on: a busy sign-up day can use up 100 sign-in codes by itself. On free, the budget formula (3.4) shrinks lifecycle email on such a day so codes still go, up to 100 codes.

### 3.13 Privacy: who sees what

| Data | Where | Who can read |
| --- | --- | --- |
| Email settings, sends, taps | Postgres | the server; deleted with the account |
| Feedback answers (may include typed health details) | Postgres; Sheet copy | the server; the founders in the Sheet; both deleted with the account (`forget`) |
| Suppressions | Postgres, hashed | the server; kept after account deletion to honour "don't email me", and not reversible to an address |
| Email bodies | Resend (US) for 30 days; the person's inbox | Resend, the person. So: no marker values, flags, verdicts, calories or weight in any email (UX rules 4, 7, 8). Counts of days and meals only. |
| Logs | Vercel (1 hour on Hobby) | log ids and counts, never addresses |

The privacy policy should name Resend as a processor outside India, as onboarding consent already names Anthropic. Consent copy is UX decision 1.

### 3.14 At 10x and 100x

- **10x (about 1,500 weekly-active):** Resend Pro. One run sends 15 batches in seconds. Selection is under a second. Nothing else changes.
- **100x (about 15,000–50,000 weekly-active):** Resend Scale. Weekly is 150–500 batch calls, about 40–130 s at 4 a second, inside 300 s but close with pre-made wraps, so split the run (the job calls itself with a cursor) or move to Vercel Queues on Pro. `email_sends` grows by about 2.5M rows a year: delete rows older than 180 days in housekeeping (every rule looks back at most 365 days, so keep `feedback` rows a year). Add an index on `users (created_at)` for the welcome windows. Send lifecycle mail from its own subdomain.
- **Global users:** Pro's hourly cron, or Vercel Schedules once it leaves beta, so everyone gets 8 am in their own zone.

## 4. Migration `0009_blog_and_email`

- **One migration for both features,** written first by one lane, so no two lanes race for the next journal number or edit `lib/db/schema.ts` at once.
- 12 new tables, 1 new column (`wraps.finished_at`, for "reached the last card"), all safe to run twice. SQL in Appendix A, tested in three orders (section 0).
- **Steps:** edit `lib/db/schema.ts` (every table with `.enableRLS()`; partial indexes with `.where(sql\`…\`)`; reuse the existing `bytea` custom type), run `npm run db:generate` to get the snapshot and journal entry, then replace the generated SQL with Appendix A's. Its journal `when` is the generation time, which is later than 0008's `1794927340536`; `tests/migrations.test.ts` checks the order.
- **Extend `tests/migrations.test.ts`:** `assertCurrentShape` checks the new tables, `blog_posts_one_featured_idx`, `email_sends_dedupe_idx`, `feedback_answers_question_idx` and `wraps.finished_at`. The existing "every table keeps row-level security" check covers RLS.
- **No new index on `food_logs`:** the existing `(user_id, local_date)` index serves the weekly query (section 0).
- **Then `0010_email_daily_counts`** (2026-11-18, follow-up): one small table, `email_daily_counts (day, stream, sent)`, keyed by UTC day and stream, RLS on, safe to run twice. It counts the email that uses Resend's 100 a day outside the send ledger and sign-in codes (the waitlist welcome, the founders' alert), so the budget sees it. Counts only, no addresses; one row per stream a day. Tested: deploy then paste, paste then deploy, and 0010 pasted onto a database at 0009 before the deploy.

## 5. Environment variables (names only)

| Name | Where | What |
| --- | --- | --- |
| `CRON_SECRET` | Vercel, Production | Vercel sends it to the cron route as a bearer token |
| `EMAIL_LINK_SECRET` | Vercel, Production (and `.env.local`) | Signs stop and feedback links; keep it stable |
| `RESEND_WEBHOOK_SECRET` | Vercel, Production | The signing secret of the Resend webhook |
| `BLOG_OWNER_EMAILS` | Vercel, Production | Comma-separated owners of `/write` |
| `EMAIL_DAILY_CAP` | Vercel, optional | Lifecycle sends a day; 70 when unset (30 kept for sign-in codes on Resend's free 100); raise on Resend Pro |
| `ALERT_EMAILS` | Vercel, optional | Who gets the "weekly list nearing the cap" alert; falls back to `BLOG_OWNER_EMAILS` |
| `FEEDBACK_REPLY_TO` | Vercel, optional | Reply-To for feedback emails; falls back to `RESEND_REPLY_TO` |
| `EMAIL_BATCH` | Vercel, optional | `1` sends lifecycle email in Resend batches of up to 100; unset sends one by one (the default, safer on the free plan) |
| `EMAIL_WEEKLY_LIVE` | Vercel, optional | `1` sends the weekly email; unset, the Sunday run is a dry run (counts in `job_runs`, nothing sent) |
| `EMAIL_LIFECYCLE_LIVE` | Vercel, optional | `1` sends the welcome, "didn't finish" and feedback emails; unset, dry runs |
| `EMAIL_POSTAL_ADDRESS` | Vercel, optional | The address line in every email's footer; unset leaves the line out |
| `EMAIL_SEND_LOCAL` | `.env.local` only, optional | `1` lets a local run send lifecycle email (or log it, without a key). Ignored on Vercel, where only `VERCEL_ENV=production` sends |
| Already set, reused | | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `GOOGLE_SHEETS_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_SECRET`, `AUTH_SECRET`, `DATABASE_URL` / `POSTGRES_URL` |

Lifecycle email and the founders' alert go only from production (section 3.4). A local run sends nothing unless `EMAIL_SEND_LOCAL=1`; then, with `RESEND_API_KEY` empty, sends log a line instead (as sign-in codes do). `/api/email-preview?kind=…` renders each email (404 in production).

## 6. Tests

| File | Covers |
| --- | --- |
| `tests/migrations.test.ts` | 0009 and 0010 in all three orders; new shape checks |
| `tests/blog-blocks.test.ts` | The block schema refuses `javascript:`, `data:` and `vbscript:` links, unknown block types, oversize text, an image id that doesn't exist, more than one level of list. The renderer never outputs raw HTML. |
| `tests/blog-store.test.ts` (PGlite) | Publish copies draft to live; drafts never appear in registry reads; version conflict gives 409; slug change keeps a redirect; deleted slugs are never reused; one featured post; a non-author is refused; a stale session can't publish |
| `tests/blog-images.test.ts` | First-byte checks, size and width rules, immutable headers, 404 for unknown files |
| `tests/email-tokens.test.ts` | Round trip, tampering, purpose separation, expiry for `fb`, none for `stop` |
| `tests/email-send.test.ts` (PGlite, fake Resend) | Two parallel claims send once; error vs timeout policy; batch rebuild gives the same payload; budget order and limits |
| `tests/email-jobs.test.ts` (PGlite) | Weekly selection (active, settings, paused, suppressed, already sent, time zones), caps, feedback cadence, the lease, `dry=1` |
| `tests/email-unsubscribe.test.ts` | One-click POST without cookies gives 200 and turns off only that kind; GET never unsubscribes; bad token 400; repeat is harmless |
| `tests/resend-webhook.test.ts` | A signed sample event (standardwebhooks format) passes, a changed byte fails; bounce and complaint effects; replays harmless |
| `tests/feedback.test.ts` | GET records nothing; POST saves and overwrites; the 10-second conflict rule; sync marks rows; `forget` is called on account delete |
| `tests/email-templates.test.ts` | Every kind and variant has a plain-text part, the footer and stop link where required, escapes names, stays under 100 KB, and has no marker or calorie words (the UX copy checklist, in code) |
| `tests/seo.test.ts` | Sitemap and robots with an injected post list; `/write`, `/email/`, `/feedback` blocked |

Apps Script: the 2026-11-01 stand-in tests for `Code.gs` weren't committed. Adding them under `tests/` would let QA test the `feedback` and `forget` actions without Google.

## 7. Build order and lanes

**Lane 0: built 2026-11-18** (systems-data-engineer). Not committed.

- `lib/db/schema.ts`: 12 tables (`blog_authors`, `blog_posts`, `blog_slugs`, `blog_images`, `blog_image_files`, `blog_publishes`, `blog_reviews`, `email_prefs`, `email_sends`, `email_suppressions`, `feedback_answers`, `job_runs`) and `wraps.finished_at`, all with RLS on; row types exported.
- `drizzle/0009_blog_and_email.sql` (safe to run twice; Appendix A plus `DESC NULLS LAST` on `blog_posts_live_idx` to match drizzle), `drizzle/meta/0009_snapshot.json`, journal entry after 0008. `drizzle-kit generate` reports no further changes.
- `tests/migrations.test.ts`: the new shape checks, "0009 pasted onto production, then the deploy", and the new keys (one featured post, authors restricted, slugs retired, account data cascades, one send per key).
- `lib/blog/types.ts`: statuses, topics, English only, slug rule, limits, blocks and spans, draft and live shapes, photo widths and paths, `PostSummary`, `LivePost`, `PostLookup`, the `BlogRegistry` and `RenderBlocks` contracts, `BLOG_TAGS`, checklist items, review statuses, fresh-session and soft-lock times.
- `lib/email/types.ts`: kinds and switches (on by default), send statuses, dedupe and idempotency keys, timing (`SEND_WINDOW`, Sunday `WEEKLY_TIMING`, `FEEDBACK_TIMING`), `CAPS`, `KIND_PRIORITY`, `EMAIL_BUDGET` (70 + 30 of 100, alert at 80%), token payloads, the template contract (`EmailTemplate`, `EmailFrame`, per-kind data with no marker, calorie or weight fields), feedback questions and answers.
- `tests/blog-email-contracts.test.ts`: the constants agree with each other and with the schema's defaults.
- Typecheck, lint and all 336 tests pass. No packages added.

Then these run in parallel. Each lane owns its files; no file appears in two lanes.

| Lane | Owner | Files it owns | Waits for |
| --- | --- | --- | --- |
| **A. Blog writing** | staff-engineer (+ product designer) | `lib/auth/author.ts`, `lib/blog/store.ts`, `lib/blog/checks.ts`, `lib/blog/image-store.ts`, `app/(write)/write/**`, `app/api/write/**`, `components/write/**`, blog tests for these | Lane 0. Uses B's renderer for preview (stub until it lands). |
| **B. Blog reading and search** | staff-engineer + seo-lead + graphic designer | `lib/blog/blocks.ts`, `lib/blog/registry.ts`, `components/blog/**`, `app/(blog)/blog/**` (index, pages, topics, `[slug]`, `img/[id]/[file]`, `rss.xml`, OG images), `app/(blog)/team/**`, `app/(blog)/editorial-policy/**`, `app/sitemap.ts`, `lib/seo.ts` (including `/write`, `/email/` and `/feedback` in `APP_PATHS` for every lane), `tests/seo.test.ts`, footer and header links | Lane 0 |
| **C. Email core** | systems-data-engineer | `lib/email/client.ts`, `tokens.ts`, `send.ts`, `prefs.ts`, `suppress.ts`, `budget.ts`; `app/api/email/{unsubscribe,webhook,prefs,tap}/**`; `app/(email)/email/stop/**`; `app/api/auth/code/route.ts` (suppressed-address message) | Lane 0 |
| **D. Email templates** | graphic designer + staff-engineer | `lib/email/templates/**`, `app/api/email-preview/route.ts`, bib and pictogram stills in `public/email/` | Lane 0's template contract |
| **E. Jobs and triggers** | systems-data-engineer | `lib/email/jobs.ts`, `app/api/cron/daily/route.ts`, `vercel.json` (crons `0 5 * * *` and `0 14 * * *`), `app/api/profile/route.ts` (welcome in `after()`), `lib/platform/wraps.ts` (pure stats function and per-day list), the founders' cap alert | C's send API and D's templates (stubs until then) |
| **F. Feedback and the Sheet** | staff-engineer; Mayank pastes the script | `app/(email)/feedback/**`, `app/api/feedback/**`, `lib/email/feedback.ts`, `lib/waitlist/sheets.ts`, `google-apps-script/Code.gs`, `app/api/account/delete/route.ts` (`forget`) | C's tokens |
| **G. In-app pieces** | ux-retention-designer + staff-engineer | Settings → Emails (`app/(platform)/(app)/settings/**`), the onboarding consent line, `/wraps?week=` opening the story, `wraps.finished_at` from the viewer, the `e` tap recorder in the app layout, `/signin?next=` (`app/api/auth/verify/route.ts`, sign-in page) | C's `/api/email/prefs` and `/api/email/tap` |

**Then:** `qa-security-engineer` attacks tokens, the one-click endpoint, the webhook signature, `next` redirects, `/write` access and uploads, block validation and link scanners. `ai-efficiency-lead` signs off pre-made wraps. The orchestrator updates `docs/platform/PHASE-1.md` and `MEMORY.md`.

**Order to ship:** blog Stage 0 (A's import screen + B) behind no footer link until the first post is live; then email C + D + E with the weekly email off (`dry=1` runs for a week); then F and G; then switch the weekly email on.

## 8. Decisions

**Made by Mayank, 2026-11-18:**

1. Blog authoring in the app at `/write`, with this design.
2. The SEO lead's URLs (`/blog/topics/…`, `/team/…`).
3. 404 for removed posts (taken down or deleted).
4. Weekly wrap and feedback emails on by default, with a clear consent line and one-tap stop (`DEFAULT_EMAIL_PREFS`).
5. The weekly wrap on Sunday evening, about 19:30 IST, for Monday to Sunday so far (`WEEKLY_TIMING`).
6. Stay on Vercel Hobby and Resend's free plan until revenue starts: daily crons only; 70 lifecycle emails a day, 30 kept for sign-in codes; overflow to the next run; an alert to the founders when the weekly list nears the cap.
7. The Sheet gets a respondent code unless the person ticks contact.
8. No blood markers or verdicts in emails; English only.

**Still open:**

- **Vercel's terms:** Hobby is for non-commercial use and D-Human takes payments. Staying on Hobby until revenue is Mayank's call; revisit when the first payments come in.
- **Replies:** create the `feedback@dhuman.fit` group (or say which inbox), then set `FEEDBACK_REPLY_TO`.
- **Account deletion and the Sheet:** this design deletes all of a person's Sheet rows (`forget`); the UX spec asked only for rows with an email. Recommended: all.
- **The UX spec's remaining ones** (pre-made wraps, the review rule, the "build next" options, who signs the feedback email) don't change this backend beyond one constant each.

## 9. Setup Mayank has to do

**DNS for `dhuman.fit` (at its registrar, Namecheap's name servers):**

1. TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:dmarc@dhuman.fit` (create that address or group first).
2. Root TXT `v=spf1 include:_spf.google.com ~all`.
3. Google Workspace DKIM: Admin console → Apps → Google Workspace → Gmail → Authenticate email → Generate, add the TXT `google._domainkey`, then Start authentication.
4. Optional: Google Postmaster Tools for `dhuman.fit`.

**Google Workspace:** groups `feedback@dhuman.fit` (both founders) and `dmarc@dhuman.fit`.

**Resend:**

1. Webhooks → Add endpoint `https://www.d-human.fit/api/email/webhook` with six events: `email.bounced`, `email.complained`, `email.suppressed`, `email.failed`, `suppression.added` and `suppression.removed` (the last two keep our suppression list in step with Resend's dashboard). Copy its signing secret into `RESEND_WEBHOOK_SECRET`.
2. Domains → `dhuman.fit` → open and click tracking off.
3. Stay on the free plan for now (Mayank). Upgrade to Pro when revenue starts or the weekly cap alert arrives, then raise `EMAIL_DAILY_CAP`.

**Vercel (Production), then Redeploy:** `CRON_SECRET` (`openssl rand -hex 32`; letters and numbers only), `EMAIL_LINK_SECRET` (same way), `RESEND_WEBHOOK_SECRET`, `BLOG_OWNER_EMAILS`, optionally `EMAIL_DAILY_CAP`, `ALERT_EMAILS` and `FEEDBACK_REPLY_TO`. After the deploy, Settings → Cron Jobs should list `/api/cron/daily` twice (`0 5 * * *` and `0 14 * * *`).

**Apps Script (Sheet → Extensions → Apps Script):** paste the new `Code.gs`, run `setupFeedback`, then Deploy → Manage deployments → Edit → New version. Without the new version the live URL keeps running the old code (gotcha in `Code.gs`).

## Appendix A: migration SQL (tested)

The file in the repo, `drizzle/0009_blog_and_email.sql`, as of lane 0. The repo file wins if they ever differ.

```sql
-- The blog (authors, posts with a draft and a live copy, old slugs, photos, publish records,
-- review requests), lifecycle email (settings, send ledger, suppressions), feedback answers,
-- a lease for scheduled jobs, and wraps.finished_at. Every new table has row-level security
-- on with no policies, like the rest. Safe to run more than once, before or after the deploy's
-- migrator (Mayank may paste it into Supabase's SQL editor). Hand-written from drizzle-kit's
-- output for the same schema; drizzle/meta/0009_snapshot.json is that output's snapshot.
CREATE TABLE IF NOT EXISTS "blog_authors" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"photo_image_id" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_authors_email_unique" UNIQUE("email"),
	CONSTRAINT "blog_authors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"topic" text,
	"language" text DEFAULT 'en' NOT NULL,
	"author_id" text NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_version" integer DEFAULT 1 NOT NULL,
	"draft_updated_by" text,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"live" jsonb,
	"live_version" integer,
	"published_at" timestamp with time zone,
	"updated_on" timestamp with time zone,
	"live_changed_at" timestamp with time zone,
	"editing_by" text,
	"editing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_blog_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."blog_authors"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_posts_live_idx" ON "blog_posts" USING btree ("published_at" DESC NULLS LAST) WHERE "status" = 'live';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_one_featured_idx" ON "blog_posts" USING btree ("featured") WHERE "featured";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_slugs" ADD CONSTRAINT "blog_slugs_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_images" (
	"id" text PRIMARY KEY NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"focal_x" real DEFAULT 0.5 NOT NULL,
	"focal_y" real DEFAULT 0.5 NOT NULL,
	"keep_colour" boolean DEFAULT false NOT NULL,
	"own_rights" boolean DEFAULT true NOT NULL,
	"credit" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_image_files" (
	"image_id" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"bytes" bytea NOT NULL,
	CONSTRAINT "blog_image_files_image_id_name_pk" PRIMARY KEY("image_id","name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_image_files" ADD CONSTRAINT "blog_image_files_image_id_blog_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."blog_images"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_publishes" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"action" text NOT NULL,
	"draft_version" integer NOT NULL,
	"by_author" text NOT NULL,
	"checklist" jsonb,
	"checks" jsonb,
	"meaningful" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_publishes" ADD CONSTRAINT "blog_publishes_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_publishes_post_idx" ON "blog_publishes" USING btree ("post_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"draft_version" integer NOT NULL,
	"requested_by" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_reviews" ADD CONSTRAINT "blog_reviews_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_reviews_post_idx" ON "blog_reviews" USING btree ("post_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"weekly" boolean DEFAULT true NOT NULL,
	"questions" boolean DEFAULT true NOT NULL,
	"weekly_paused_at" timestamp with time zone,
	"updated_via" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_prefs" ADD CONSTRAINT "email_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"variant" text,
	"local_date" date NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"batch_id" text,
	"provider_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"first_tap_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_sends_dedupe_idx" ON "email_sends" USING btree ("user_id","kind","dedupe_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_sends_provider_idx" ON "email_sends" USING btree ("provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_sent_idx" ON "email_sends" USING btree ("sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_open_idx" ON "email_sends" USING btree ("created_at") WHERE "status" IN ('sending', 'failed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_suppressions" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"survey" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"path" text,
	"source" text NOT NULL,
	"contact_ok" boolean DEFAULT false NOT NULL,
	"conflict_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sheet_synced_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_answers" ADD CONSTRAINT "feedback_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_answers_question_idx" ON "feedback_answers" USING btree ("user_id","survey","question");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_answers_unsynced_idx" ON "feedback_answers" USING btree ("updated_at") WHERE "sheet_synced_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_runs" (
	"job" text PRIMARY KEY NOT NULL,
	"lease_until" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_result" jsonb
);
--> statement-breakpoint
ALTER TABLE "wraps" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "blog_authors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_posts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_slugs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_images" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_image_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_publishes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_prefs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_sends" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "feedback_answers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_runs" ENABLE ROW LEVEL SECURITY;
```

## Appendix B: sources (fetched 2026-11-18)

- Vercel: [cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) · [managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) · [Schedules limits](https://vercel.com/docs/schedules/limits) · [function limits](https://vercel.com/docs/functions/limitations) · [Hobby plan](https://vercel.com/docs/plans/hobby) · [fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines) · [image optimisation limits](https://vercel.com/docs/image-optimization/limits-and-pricing) · [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- Resend: [pricing](https://resend.com/pricing) · [API rate limit](https://resend.com/docs/api-reference/introduction) · [batch send](https://resend.com/docs/api-reference/emails/send-batch-emails) · [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) · [webhook events](https://resend.com/docs/dashboard/webhooks/event-types) · [verifying webhooks](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests) · [suppressions](https://resend.com/docs/dashboard/emails/email-suppressions) · [unsubscribe headers](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails) · [receiving](https://resend.com/docs/dashboard/receiving/introduction)
- Mailbox providers: [Gmail sender guidelines](https://support.google.com/a/answer/81126) · [Gmail enforcement from Nov 2025 (Red Sift)](https://redsift.com/blog/gmails-enforcement-ramps-up-what-bulk-senders-need-to-know) · [Gmail Nov 2025 updates (Suped)](https://www.suped.com/blog/new-gmail-bulk-sender-compliance-updates-november-2025) · [Yahoo bulk sender rules (Palisade)](https://www.palisade.email/learning/yahoo-bulk-sender-requirements.md) · [Microsoft bulk sender requirements](https://learn.microsoft.com/dynamics365/customer-insights/journeys/requirements-for-bulk-senders) · [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058)
- Others: [Supabase pricing](https://supabase.com/pricing) · [Sanity pricing](https://www.sanity.io/pricing) · [Notion file objects](https://developers.notion.com/reference/file-object)
- Next 16, local: `node_modules/next/dist/docs/01-app/01-getting-started/09-revalidating.md`, `03-api-reference/04-functions/revalidateTag.md`, `generate-static-params.md`, `03-api-reference/03-file-conventions/dynamic-routes.md`, `02-guides/incremental-static-regeneration-cache-components.md`, `03-api-reference/01-directives/use-cache.md`, `03-api-reference/03-file-conventions/02-route-segment-config/ensureStatic.md`

The Gmail enforcement date, the Yahoo two-day rule and Microsoft's May 2025 rules come from vendor summaries, not the providers' own pages; Resend's unsubscribe doc separately says to stop within 48 hours.
