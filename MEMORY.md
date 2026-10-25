# D-Human project memory

The running record of this project: where things stand, why they are the way they are, what bit us, and every update and push. Read it before starting work. Add to the log after every change, and record the commit hash after every push. Never write secret values here; variable names only.

## Snapshot

- **What:** the D-Human waitlist landing page. Tagline: "Your body speaks data. Hear it. Use it. Own it." D-Human tests first (blood, gut, body), has a doctor review the results, recommends supplements only where markers point, and retests.
- **Live:** https://d-human.vercel.app. Vercel personal account `mayank-f847`. Every push to `main` auto-deploys in about 20 seconds. The claude.ai Vercel connector is signed into a different account and cannot see this project.
- **Repo:** https://github.com/mayank99deo/D-HUMAN, branch `main`.
- **Stack:** Next.js 16.4.2 (App Router, Cache Components on), React 19.3, Tailwind CSS 4, Motion 14.6, zod 4, resend 6.34. Node 24 via fnm.
- **Signups:** browser → `/api/waitlist` → Google Apps Script web app (`google-apps-script/Code.gs`) → the `Waitlist` tab of the Google Sheet (13 columns). The optional follow-up answers go to `/api/waitlist/details` with an HMAC token.
- **Email:** Resend. `dhuman.fit` is verified there (DKIM, plus MX and SPF on `send.dhuman.fit`; no DMARC yet). The sender defaults to `D-Human <hello@dhuman.fit>`. The welcome email template is `lib/waitlist/welcome-email.ts`; preview it in dev at `/api/email-preview`.
- **Domains:** `dhuman.fit` has no A or CNAME record, so the website is not served there; mail for `@dhuman.fit` runs on Google Workspace. Links and images use `lib/site-url.ts` (`NEXT_PUBLIC_SITE_URL`, else Vercel's production domain).
- **Environment variables (names only):** `GOOGLE_SHEETS_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_SECRET` (must equal `WEBHOOK_SECRET` in Apps Script), `RESEND_API_KEY` (full access), `RESEND_FROM`, `RESEND_REPLY_TO`, `RESEND_SEGMENT_ID`, `NEXT_PUBLIC_SITE_URL` (optional). Local values live in `.env.local`, which is git-ignored.
- **Local dev:** port 3000 belongs to the Pepvoga project on this Mac, so run `npm run dev -- -p 3001`.
- **Mobile:** installable as a home-screen web app (`app/manifest.ts`, icons in `public/icons`, Apple web-app tags). Lighthouse mobile on 2026-10-25: Performance 94–95, Accessibility, Best Practices and SEO 100; blocking time 40–60 ms, LCP 2.9 s, CLS 0. No overflow and no tap target under 44 px at 320, 375 or 430 px.

## Decisions

- **Brand:** monochrome only, true `#000` and `#fff` ("white pack, black ink"). Archivo with its width axis, set wide to echo the logo. The primary button's cut top-left corner borrows the notch in the logo's D. No accent colour; errors are marked with a "!" glyph.
- **Copy:** taken from the pitch deck. No disease claims; use "screening", "markers" and "risk". Only sourced numbers (Tata 1mg Labs, 2023: 76% of 2.2 lakh people tested were vitamin D deficient). No plan prices until partner pricing is confirmed.
- **Motion:** the hero's hand-written WebGL contour field (inspired by illumelabs.ai's cinematic hero, not copied); the vitamin D chart's fill and random-pick interaction (Motion); silk threads on the Join buttons. All respect reduced motion; the silk threads are also off on touch screens.
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
- **Git identity:** not configured on this Mac, so commits are authored `Mayank Narayan <mayanknarayan@Mayanks-MacBook.local>`, which GitHub doesn't link to the account.

## Open items

- [ ] Add DMARC: TXT on `_dmarc.dhuman.fit` with `v=DMARC1; p=none;`
- [ ] Serve the site at `dhuman.fit` (Vercel → Settings → Domains), then unset or update `NEXT_PUBLIC_SITE_URL`
- [ ] Set the git name and email so commits link to the GitHub account
- [ ] Optional: a Resend segment "Waitlist" and `RESEND_SEGMENT_ID`
- [ ] Later: reverse-engineer the architecture of other sites and platforms

## Log

Newest first. One entry per change; pushes carry their commit hash.

### 2026-10-25
- **Mobile web app pass:** home-screen manifest, 192 and 512 px icons, Apple web-app and format-detection tags; hover styles limited to devices that hover, with pressed feedback for touch; all tap targets at least 44 px (header button and logo, answer chips, skip link); "Send" on the email keyboard; no text inflation on rotation. Audited at 320, 375 and 430 px.
- **Performance fix:** mobile Lighthouse Performance went from 39 to 94–95 (blocking time 6,480 ms to 40–60 ms, LCP 6.4 s to 2.9 s). Root cause, found by tracing: synchronous WebGL setup blocking the main thread. The field now renders in a Web Worker on an OffscreenCanvas, starts after load and idle, only near the screen, at 30 fps, with a still frame on software rendering.
- **Silk threads on the Join buttons** (`components/waitlist/useSilkTether.ts`): near the cursor, 15 rope-physics strands run from the facing edge of the button to the pointer. The button leans up to 10 px toward the cursor and the cursor becomes a grab hand. Moving away or clicking snaps the strands. Off on touch and with reduced motion. Inspired by a "let's collaborate" button the user shared. Verified with real mouse moves in Chrome and on an emulated touch phone.
- **Project memory:** added `MEMORY.md` and `CLAUDE.md`, which imports it.
- **Push:** the entries above ship together; commit hash recorded below once pushed.

### 2026-10-23
- **Push `498a4cb`:** branded welcome email (black page, white card, contour band, the four steps, WhatsApp share), the dev-only `/api/email-preview`, the sender on `hello@dhuman.fit`, and `lib/site-url.ts` with Vercel's production domain as fallback. Verified live: email artwork 200, preview 404, Sheets check 403.
- **Fix (no code):** the live site couldn't save signups because Vercel lacked the Sheets variables. The user added them and redeployed; the check went from 500 to 403.
- **Push `7b59b8a`:** the landing page. Hero with the contour field; the vitamin D section with an animated chart and picker; the loop with a sample report; the 17 tests; the three plans; closing form; footer. The waitlist APIs, Apps Script with `setup()`, Resend welcome email, traced logo, icons and share image. Includes the dev-mode WebGL fix and the hero type tuning (width 118, weight 760, line height 1; tagline on one line).
- **Research:** inspected illumelabs.ai with REA. A full-bleed `hero.mp4` with grain and grade overlays and a centred serif headline; used as motion inspiration only.

### 2026-10-22
- **Thread:** used REA to investigate VS Code 1.123.0's Command Palette (prefix-based provider routing, the `f1` command menu, word and TF-IDF matching, recently-used ordering) and outlined how to build one in Next.js. No code in this repo.
