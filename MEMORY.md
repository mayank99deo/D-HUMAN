# D-Human project memory

The running record of this project: where things stand, why they are the way they are, what bit us, and every update and push. Read it before starting work. Add to the log after every change, and record the commit hash after every push. Never write secret values here; variable names only.

## Snapshot

- **What:** the D-Human waitlist landing page. Tagline: "Your body speaks data. Hear it. Use it. Own it." D-Human tests first (blood, gut, body), has a doctor review the results, recommends supplements only where markers point, and retests.
- **Live:** https://www.dhuman.fit (`dhuman.fit` redirects there) and https://d-human.vercel.app. Vercel personal account `mayank-f847`. Every push to `main` auto-deploys in about 20 seconds. The claude.ai Vercel connector is signed into a different account and cannot see this project.
- **Repo:** https://github.com/mayank99deo/D-HUMAN, branch `main`.
- **Stack:** Next.js 16.4.2 (App Router, Cache Components on), React 19.3, Tailwind CSS 4, Motion 14.6, zod 4, resend 6.34. Node 24 via fnm.
- **Signups:** browser → `/api/waitlist` → Google Apps Script web app (`google-apps-script/Code.gs`) → the `Waitlist` tab of the Google Sheet (13 columns). The optional follow-up answers go to `/api/waitlist/details` with an HMAC token.
- **Email:** Resend. `dhuman.fit` is verified there (DKIM, plus MX and SPF on `send.dhuman.fit`; no DMARC yet). The sender defaults to `D-Human <hello@dhuman.fit>`. The welcome email template is `lib/waitlist/welcome-email.ts`; preview it in dev at `/api/email-preview`.
- **Domains:** as of 2026-10-27 `dhuman.fit` points at Vercel and 308-redirects to `www.dhuman.fit`, which serves the site. Mail for `@dhuman.fit` runs on Google Workspace. Links and images use `lib/site-url.ts` (`NEXT_PUBLIC_SITE_URL`, else Vercel's production domain); share previews still point at `d-human.vercel.app` (see Open items).
- **Video:** two HyperFrames projects, each with `SPEC.md` and `REVIEW.md`. `video/intro/` is the 13 s product intro. `video/loop/` is the 20 s phone-screen loop (600 x 1296) that plays in the "Test first" section; its web copy and stills live in `public/media/loop/` (re-encode steps in its `REVIEW.md`). Preview with the plugin CLI's `preview`, render with `render`; caches and `renders/` are git-ignored.
- **Environment variables (names only):** `GOOGLE_SHEETS_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_SECRET` (must equal `WEBHOOK_SECRET` in Apps Script), `RESEND_API_KEY` (full access), `RESEND_FROM`, `RESEND_REPLY_TO`, `RESEND_SEGMENT_ID`, `NEXT_PUBLIC_SITE_URL` (optional). Local values live in `.env.local`, which is git-ignored.
- **Local dev:** port 3000 belongs to the Pepvoga project on this Mac, so run `npm run dev -- -p 3001`.
- **Mobile:** installable as a home-screen web app (`app/manifest.ts`, icons in `public/icons`, Apple web-app tags). Lighthouse mobile on 2026-10-28 (with the phone loop): Performance 93–95, Accessibility, Best Practices and SEO 100; blocking time 50–70 ms, LCP 2.9 s, CLS 0, 347 KiB on load (the video loads only near the screen). No overflow and no tap target under 44 px at 320, 375 or 430 px.

## Decisions

- **Brand:** monochrome only, true `#000` and `#fff` ("white pack, black ink"). Archivo with its width axis, set wide to echo the logo. The primary button's cut top-left corner borrows the notch in the logo's D. No accent colour; errors are marked with a "!" glyph.
- **Page scope (2026-10-28):** the live page shows only the hero, the vitamin D section and the test-first loop. Tests, Plans and Closing are hidden in `app/page.tsx` until the user brings them back.
- **Copy:** taken from the pitch deck. No disease claims; use "screening", "markers" and "risk". Only sourced numbers: 76% vitamin D deficient across 2.2 lakh lab tests in 27 Indian cities, 2023 (source in the pitch deck). Never name lab or supplement brands on the site; attribute as "research across…". Anything else shown as data is labelled illustrative. No plan prices until partner pricing is confirmed.
- **Motion:** the hero's hand-written WebGL contour field (inspired by illumelabs.ai's cinematic hero, not copied); the vitamin D chart's fill and picker (Motion); silk threads on the Join buttons; the "Test first" phone loop (a HyperFrames render, played only in view, with the four steps as chapter controls and a Pause button). All respect reduced motion: the phone shows chapter stills instead, as it does for Data Saver. The silk threads are also off on touch screens.
- **Chart picker:** each of the 100 squares is a fixed person (seeded, so the same on server and browser) with five markers: vitamin D follows the chart, the others (B12, ferritin, magnesium, hsCRP) are illustrative, and the flagged ones become their stack. Squares can be tapped; keyboards use the button.
- **Contour field architecture:** drawn in a Web Worker on an OffscreenCanvas (`renderer.ts` + `field.worker.ts`), started only after load, at idle, and when near the screen; 30 fps cap; a still frame on software rendering or reduced motion. Falls back to the main thread where workers can't run WebGL (e.g. Safari 16.4).
- **Touch:** hover styles only under `(hover: hover)`, pressed (`:active`) feedback instead, tap targets of at least 44 px, email keyboard shows "Send".
- **Waitlist:** email only up front, then optional questions. Bots are caught by a honeypot field and a best-effort limit of 5 attempts a minute per IP (kept in memory, so per server instance).
- **Apps Script:** escapes values that could run as formulas or lose leading zeros; `setup()` builds and formats the tab and never deletes data.

## Gotchas

- **Stale CSS in dev:** Turbopack's dev cache once served CSS missing a new `@utility`. Stop the server, delete `.next/dev`, restart.
- **WebGL in dev:** React Strict Mode runs effects twice. Never call `WEBGL_lose_context().loseContext()` in cleanup, or the reused canvas stays dead (a white hero).
- **Vercel variables:** changes only apply after a Redeploy. Enter values without quotes. Duplicate keys in one "Add" dialog fail with "already exists".
- **Testing Apps Script with curl:** `curl -X POST -L` keeps POST on the redirect and gets "Page not found". `fetch`, which the app uses, works.
- **WebGL blocks the page while it starts:** creating a context is synchronous; it measured about 0.4 s on this Mac's GPU and about 2 s on a cold software renderer (what Lighthouse uses), on top of waiting behind the GPU process while it paints the page. That took mobile Performance down to 39. Keep WebGL setup in the worker.
- **Measuring performance:** run Lighthouse against a production build (`next build` + `next start`), not `next dev`. Command: `npx -y lighthouse@12.8.2 <url> --form-factor=mobile --screenEmulation.mobile --chrome-flags="--headless=new --enable-unsafe-swiftshader --use-angle=swiftshader"`.
- **Safe live check:** POST `/api/waitlist/details` with a fake token. 403 means the Sheets secret is configured; 500 means it is missing. Writes nothing.
- **Reduced motion in render:** Motion's `useReducedMotion()` reads the media query on the client's first render, so using it to choose markup causes a hydration mismatch. Use `useSyncExternalStore` with a server snapshot of `false` (as `LoopPhone.tsx` does).
- **WebP from ffmpeg:** Homebrew's ffmpeg has no WebP encoder. Export PNG frames and convert with `sharp` from `node_modules` (`node --input-type=module`, `import sharp from "sharp"`).
- **Git identity:** not configured on this Mac, so commits are authored `Mayank Narayan <mayanknarayan@Mayanks-MacBook.local>`, which GitHub doesn't link to the account.

## Open items

- [ ] Add DMARC: TXT on `_dmarc.dhuman.fit` with `v=DMARC1; p=none;`
- [ ] Share previews: set `NEXT_PUBLIC_SITE_URL` to `https://www.dhuman.fit` in Vercel (or delete it so the production domain is used) and redeploy; the og:image still points at `d-human.vercel.app`
- [ ] Set the git name and email so commits link to the GitHub account
- [ ] Optional: a Resend segment "Waitlist" and `RESEND_SEGMENT_ID`
- [ ] Later: reverse-engineer the architecture of other sites and platforms

## Log

Newest first. One entry per change; pushes carry their commit hash.

### 2026-10-28
- **"Test first" phone and a livelier chart:** the sample report and its explanation now play inside a phone. A new HyperFrames clip (`video/loop/`, 20 s, 600 x 1296) runs tests → doctor-reviewed report → vitamin D in plain words → two answers → the stack with the clean-label bar → retest, with an in-app tab bar that mirrors the steps. On the page (`components/site/LoopPhone.tsx`) the four steps follow the clip and jump to their chapter on tap; it plays only in view, has Pause, and shows stills for reduced motion and Data Saver. The 76 of 100 chart's picker now opens each person's five-marker panel and resulting stack (or "nothing to add"), and any square can be tapped. "Tata 1mg Labs" is no longer named; the figure is attributed as research across 2.2 lakh lab tests in 27 cities. Verified in Chrome at 1440 and 390 px and with reduced motion; mobile Lighthouse on a production build 93–95, the rest 100.
- **Landing page trimmed to three sections:** hero, "Most people buy supplements blind" (the 76 of 100 chart) and "Test first. Supplement second." (ending on the sample report). What we test, Three plans and the closing waitlist section are commented out in `app/page.tsx`, components kept. The `#join` anchor moved to the hero form, so the header button and "Find your number" scroll there. The footer stays for its wellness disclaimer. Also fixed the headline reading as "Your bodyspeaks data." to screen readers and search (missing space between its two lines). Not pushed yet.

### 2026-10-27
- **Product intro video** (`video/intro/`, HyperFrames, 13 s, 1920 x 1080, silent): the report is in, its three out-of-range rows carry into a phone, two taps on "What do you train for?", then the stack ("Only what your markers point to") and the white end card "For the human", "Join the waitlist at dhuman.fit". Built on the site's own contour shader, wordmark and Archivo; the app screens reuse the launch page's components and copy, and the report is labelled illustrative. Not committed yet.

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
